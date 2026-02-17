import { join } from "node:path";
import type { AppConfig } from "./config.ts";
import { CaptureDatabase } from "./db.ts";
import { getFrontmostAppMetadata } from "./frontmost.ts";
import type { CaptureRow } from "./types.ts";

type CaptureCallback = (row: CaptureRow) => void;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function safeRemove(path: string): Promise<void> {
  try {
    await Deno.remove(path);
  } catch {
    // best effort cleanup
  }
}

export class CaptureService {
  private running = false;
  private loopPromise: Promise<void> | null = null;

  constructor(
    private readonly config: AppConfig,
    private readonly db: CaptureDatabase,
    private readonly onCapture: CaptureCallback,
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.loopPromise = this.runLoop();
    console.log("[capture] started (1 FPS)");
  }

  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;

    if (this.loopPromise) {
      await this.loopPromise;
      this.loopPromise = null;
    }

    console.log("[capture] stopped");
  }

  private async runLoop(): Promise<void> {
    let nextTickAt = Date.now();

    while (this.running) {
      const waitMs = nextTickAt - Date.now();
      if (waitMs > 0) {
        await sleep(waitMs);
      }

      const startedAtMs = Date.now();
      await this.captureOnce(startedAtMs);

      nextTickAt += this.config.captureIntervalMs;

      // If we're too far behind, snap to now + interval.
      if (nextTickAt < Date.now() - this.config.captureIntervalMs) {
        nextTickAt = Date.now() + this.config.captureIntervalMs;
      }
    }
  }

  private async captureOnce(capturedAtMs: number): Promise<void> {
    const filename = `${capturedAtMs}.jpg`;
    const imagePath = join(this.config.screenshotsDir, filename);

    const output = await new Deno.Command("screencapture", {
      args: ["-x", "-m", "-t", "jpg", imagePath],
      stdout: "piped",
      stderr: "piped",
    }).output();

    if (output.code !== 0) {
      const stderr = new TextDecoder().decode(output.stderr).trim();
      console.warn(`[capture] screencapture failed: ${stderr || "unknown error"}`);
      return;
    }

    let imageBytes = 0;
    try {
      const stat = await Deno.stat(imagePath);
      imageBytes = stat.size;
    } catch (error) {
      console.warn(`[capture] failed to stat image: ${error}`);
      await safeRemove(imagePath);
      return;
    }

    const frontmost = await getFrontmostAppMetadata();

    try {
      const row = this.db.insertCapture({
        captured_at_ms: capturedAtMs,
        captured_at_iso: new Date(capturedAtMs).toISOString(),
        image_filename: filename,
        image_bytes: imageBytes,
        frontmost_app_name: frontmost?.name ?? null,
        frontmost_bundle_id: frontmost?.bundleId ?? null,
        frontmost_pid: frontmost?.pid ?? null,
        created_at_ms: Date.now(),
      });

      this.onCapture(row);
    } catch (error) {
      console.error(`[capture] database insert failed: ${error}`);
      await safeRemove(imagePath);
    }
  }
}
