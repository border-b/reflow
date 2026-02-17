import { CaptureService } from "./capture.ts";
import { ensureRuntimeDirs, getConfig } from "./config.ts";
import { CaptureDatabase } from "./db.ts";
import { TimelineServer } from "./server.ts";

const config = getConfig();
await ensureRuntimeDirs(config);

const db = new CaptureDatabase(config.dbPath);
const server = new TimelineServer(config, db);
const capture = new CaptureService(config, db, (row) => {
  server.broadcastCapture(row);
});

server.start();
capture.start();

console.log(`[paths] db: ${config.dbPath}`);
console.log(`[paths] screenshots: ${config.screenshotsDir}`);
console.log("[mode] no-ai capture + sqlite + live timeline");

let shuttingDown = false;
let resolveDone: (() => void) | null = null;
const done = new Promise<void>((resolve) => {
  resolveDone = resolve;
});

async function shutdown(reason: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;

  console.log(`[shutdown] reason=${reason}`);

  await capture.stop();
  await server.stop();
  db.close();

  if (resolveDone) {
    resolveDone();
    resolveDone = null;
  }
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  Deno.addSignalListener(signal, () => {
    void shutdown(signal);
  });
}

await done;
