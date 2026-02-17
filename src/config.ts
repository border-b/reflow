import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface AppConfig {
  projectRoot: string;
  dataDir: string;
  staticDir: string;
  screenshotsDir: string;
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
  const screenshotsDir = join(dataDir, "screenshots");
  const dbPath = join(dataDir, "dayflow_noai.sqlite");

  return {
    projectRoot,
    dataDir,
    staticDir,
    screenshotsDir,
    dbPath,
    port: parsePort(readPortFromEnv()),
    captureIntervalMs: DEFAULT_CAPTURE_INTERVAL_MS,
  };
}

export async function ensureRuntimeDirs(config: AppConfig): Promise<void> {
  await Deno.mkdir(config.dataDir, { recursive: true });
  await Deno.mkdir(config.screenshotsDir, { recursive: true });
}
