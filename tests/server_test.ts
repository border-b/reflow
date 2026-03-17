import { join } from "node:path";
import type { AppConfig } from "../src/config.ts";
import { CaptureDatabase } from "../src/db.ts";
import { FramePreviewStore } from "../src/media_store.ts";
import { parseFrameCaptureId, TimelineServer } from "../src/server.ts";

function assert(condition: unknown, message = "assertion failed"): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function assertEquals<T>(actual: T, expected: T): void {
  if (!Object.is(actual, expected)) {
    throw new Error(`expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

async function makeConfig(tempDir: string): Promise<AppConfig> {
  const config: AppConfig = {
    projectRoot: tempDir,
    dataDir: join(tempDir, "data"),
    staticDir: join(tempDir, "static"),
    tempDir: join(tempDir, "data", "tmp"),
    segmentsDir: join(tempDir, "data", "segments"),
    pendingSegmentsDir: join(tempDir, "data", "segments", "pending"),
    frameCacheDir: join(tempDir, "data", "frame-cache"),
    dbPath: join(tempDir, "data", "test.sqlite"),
    port: 8787,
    captureIntervalMs: 1000,
  };

  await Deno.mkdir(config.staticDir, { recursive: true });
  await Deno.mkdir(config.tempDir, { recursive: true });
  await Deno.mkdir(config.segmentsDir, { recursive: true });
  await Deno.mkdir(config.pendingSegmentsDir, { recursive: true });
  await Deno.mkdir(config.frameCacheDir, { recursive: true });

  return config;
}

Deno.test("parseFrameCaptureId accepts safe frame routes", () => {
  assertEquals(parseFrameCaptureId("/api/frame/1739800000000.jpg"), 1_739_800_000_000);
});

Deno.test("parseFrameCaptureId rejects invalid frame routes", () => {
  assertEquals(parseFrameCaptureId("/api/frame/not-a-number.jpg"), null);
  assertEquals(parseFrameCaptureId("/api/frame/1.png"), null);
  assertEquals(parseFrameCaptureId("/images/1.jpg"), null);
});

Deno.test("TimelineServer serves cached previews for segment-backed captures", async () => {
  const tempDir = await Deno.makeTempDir();
  const config = await makeConfig(tempDir);
  const db = new CaptureDatabase(config.dbPath);
  const framePreviewStore = new FramePreviewStore(config);
  const server = new TimelineServer(config, db, framePreviewStore);

  const segmentId = db.insertMediaSegment({
    path: join(config.segmentsDir, "2026", "03", "17", "1.mp4"),
    started_at_ms: 1,
    ended_at_ms: 1,
    codec: "libx264rgb",
    container: "mp4",
    fps: 1,
    gop: 10,
    width: 100,
    height: 100,
    frame_count: 1,
    bytes: 100,
    created_at_ms: 1,
  });

  const row = db.insertCapture({
    captured_at_ms: 1,
    captured_at_iso: new Date(1).toISOString(),
    segment_id: segmentId,
    segment_frame_index: 0,
    segment_pts_ms: 0,
    frontmost_app_name: null,
    frontmost_bundle_id: null,
    frontmost_pid: null,
    created_at_ms: 1,
  });

  await Deno.writeFile(join(config.frameCacheDir, `${row.id}.jpg`), new Uint8Array([1, 2, 3]));

  const handler = Reflect.get(server, "handleRequest") as (request: Request) => Promise<Response>;
  const response = await handler.call(server, new Request(`http://localhost:${config.port}${row.image_url}`));

  assertEquals(response.status, 200);
  assertEquals(response.headers.get("content-type"), "image/jpeg");
  const bytes = new Uint8Array(await response.arrayBuffer());
  assertEquals(Array.from(bytes).join(","), "1,2,3");

  db.close();
  await Deno.remove(tempDir, { recursive: true });
});
