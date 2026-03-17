import { CaptureService } from "./capture.ts";
import { ensureRuntimeDirs, getConfig } from "./config.ts";
import { CaptureDatabase } from "./db.ts";
import { FramePreviewStore, SegmentManager } from "./media_store.ts";
import { TimelineServer } from "./server.ts";

const config = getConfig();
await ensureRuntimeDirs(config);

const db = new CaptureDatabase(config.dbPath);
const segmentManager = new SegmentManager(config, db);
const framePreviewStore = new FramePreviewStore(config);
const server = new TimelineServer(config, db, framePreviewStore);
const capture = new CaptureService(config, db, segmentManager, framePreviewStore, (row) => {
  server.broadcastCapture(row);
});

server.start();
capture.start();

console.log(`[paths] db: ${config.dbPath}`);
console.log(`[paths] segments: ${config.segmentsDir}`);
console.log(`[paths] frame-cache: ${config.frameCacheDir}`);
console.log("[mode] no-ai capture + segment storage + live timeline");

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
