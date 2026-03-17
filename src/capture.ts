import { join } from "node:path";
import type { AppConfig } from "./config.ts";
import { CaptureDatabase } from "./db.ts";
import { getFrontmostAppMetadata } from "./frontmost.ts";
import { FramePreviewStore, SegmentManager } from "./media_store.ts";
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
    private readonly segmentManager: SegmentManager,
    private readonly framePreviewStore: FramePreviewStore,
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

    await this.segmentManager.flush();
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
    const imagePath = join(this.config.tempDir, `${capturedAtMs}.png`);

    const output = await new Deno.Command("screencapture", {
      args: ["-x", "-m", "-t", "png", imagePath],
      stdout: "piped",
      stderr: "piped",
    }).output();

    if (output.code !== 0) {
      const stderr = new TextDecoder().decode(output.stderr).trim();
      console.warn(`[capture] screencapture failed: ${stderr || "unknown error"}`);
      return;
    }

    const frontmost = await getFrontmostAppMetadata();
    let placement:
      | { segment_id: number; segment_frame_index: number; segment_pts_ms: number }
      | null = null;

    try {
      placement = await this.segmentManager.appendFrame(imagePath, capturedAtMs);

      const row = this.db.insertCapture({
        captured_at_ms: capturedAtMs,
        captured_at_iso: new Date(capturedAtMs).toISOString(),
        segment_id: placement.segment_id,
        segment_frame_index: placement.segment_frame_index,
        segment_pts_ms: placement.segment_pts_ms,
        frontmost_app_name: frontmost?.name ?? null,
        frontmost_bundle_id: frontmost?.bundleId ?? null,
        frontmost_pid: frontmost?.pid ?? null,
        created_at_ms: Date.now(),
      });

      try {
        await this.framePreviewStore.createPreviewFromImage(row.id, imagePath);
      } catch (error) {
        console.warn(`[capture] failed to warm frame preview for ${row.id}: ${error}`);
      }

      this.onCapture(row);
    } catch (error) {
      console.error(`[capture] database insert failed: ${error}`);
      if (placement) {
        await this.segmentManager.discardFrame(placement);
      }
      await safeRemove(imagePath);
      return;
    }

    await safeRemove(imagePath);
  }
}
