import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface AppConfig {
  projectRoot: string;
  dataDir: string;
  staticDir: string;
  tempDir: string;
  segmentsDir: string;
  pendingSegmentsDir: string;
  frameCacheDir: string;
  dbPath: string;
  port: number;
  captureIntervalMs: number;
}

const DEFAULT_PORT = 8787;
const DEFAULT_CAPTURE_INTERVAL_MS = 1000;

function parsePort(value: string | undefined): number {
  if (!value) return DEFAULT_PORT;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > 65_535) {
    return DEFAULT_PORT;
  }
  return parsed;
}

function readPortFromEnv(): string | undefined {
  try {
    return Deno.env.get("PORT");
  } catch {
    // If --allow-env is not granted, just use the default port.
    return undefined;
  }
}

export function getConfig(): AppConfig {
  const srcDir = dirname(fileURLToPath(import.meta.url));
  const projectRoot = resolve(srcDir, "..");
  const dataDir = join(projectRoot, "data");
  const staticDir = join(srcDir, "static");
  const tempDir = join(dataDir, "tmp");
  const segmentsDir = join(dataDir, "segments");
  const pendingSegmentsDir = join(segmentsDir, "pending");
  const frameCacheDir = join(dataDir, "frame-cache");
  const dbPath = join(dataDir, "reflow_segments.sqlite");

  return {
    projectRoot,
    dataDir,
    staticDir,
    tempDir,
    segmentsDir,
    pendingSegmentsDir,
    frameCacheDir,
    dbPath,
    port: parsePort(readPortFromEnv()),
    captureIntervalMs: DEFAULT_CAPTURE_INTERVAL_MS,
  };
}

export async function ensureRuntimeDirs(config: AppConfig): Promise<void> {
  await Deno.mkdir(config.dataDir, { recursive: true });
  await Deno.mkdir(config.tempDir, { recursive: true });
  await Deno.mkdir(config.segmentsDir, { recursive: true });
  await Deno.mkdir(config.pendingSegmentsDir, { recursive: true });
  await Deno.mkdir(config.frameCacheDir, { recursive: true });
}
