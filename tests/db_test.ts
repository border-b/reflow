import { join } from "node:path";
import { CaptureDatabase } from "../src/db.ts";

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

Deno.test("CaptureDatabase inserts and lists capture rows", async () => {
  const tempDir = await Deno.makeTempDir();
  const dbPath = join(tempDir, "test.sqlite");

  const db = new CaptureDatabase(dbPath);
  const segmentId = db.insertMediaSegment({
    path: join(tempDir, "segments", "1700000000000.mp4"),
    started_at_ms: 1_700_000_000_000,
    ended_at_ms: 1_700_000_000_000,
    codec: "libx264rgb",
    container: "mp4",
    fps: 1,
    gop: 10,
    width: 1440,
    height: 900,
    frame_count: 1,
    bytes: 2048,
    created_at_ms: 1_700_000_000_000,
  });

  const inserted = db.insertCapture({
    captured_at_ms: 1_700_000_000_000,
    captured_at_iso: "2023-11-14T22:13:20.000Z",
    segment_id: segmentId,
    segment_frame_index: 0,
    segment_pts_ms: 0,
    frontmost_app_name: "Terminal",
    frontmost_bundle_id: "com.apple.Terminal",
    frontmost_pid: 999,
    created_at_ms: 1_700_000_000_100,
  });

  assert(inserted.id > 0);
  assertEquals(inserted.image_url, `/api/frame/${inserted.id}.jpg`);
  assertEquals(inserted.storage_kind, "segment");

  const listed = db.listCaptures(10);
  assertEquals(listed.items.length, 1);
  assertEquals(listed.items[0].frontmost_app_name, "Terminal");
  assertEquals(listed.items[0].segment_id, segmentId);
  assertEquals(listed.next_before_id, null);

  const frame = db.getCaptureFrame(inserted.id);
  assert(frame !== null);
  assertEquals(frame.segment_path, join(tempDir, "segments", "1700000000000.mp4"));

  db.close();
  await Deno.remove(tempDir, { recursive: true });
});

Deno.test("CaptureDatabase paginates with before_id", async () => {
  const tempDir = await Deno.makeTempDir();
  const dbPath = join(tempDir, "test.sqlite");
  const db = new CaptureDatabase(dbPath);
  const segmentId = db.insertMediaSegment({
    path: join(tempDir, "segments", "1700000000000.mp4"),
    started_at_ms: 1_700_000_000_000,
    ended_at_ms: 1_700_000_000_002,
    codec: "libx264rgb",
    container: "mp4",
    fps: 1,
    gop: 10,
    width: 1440,
    height: 900,
    frame_count: 3,
    bytes: 4096,
    created_at_ms: 1_700_000_000_000,
  });

  for (let i = 0; i < 3; i += 1) {
    db.insertCapture({
      captured_at_ms: 1_700_000_000_000 + i,
      captured_at_iso: new Date(1_700_000_000_000 + i).toISOString(),
      segment_id: segmentId,
      segment_frame_index: i,
      segment_pts_ms: i * 1000,
      frontmost_app_name: null,
      frontmost_bundle_id: null,
      frontmost_pid: null,
      created_at_ms: 1_700_000_000_500 + i,
    });
  }

  const page1 = db.listCaptures(2);
  assertEquals(page1.items.length, 2);
  assert(page1.next_before_id !== null);

  const page2 = db.listCaptures(2, page1.next_before_id ?? undefined);
  assertEquals(page2.items.length, 1);

  db.close();
  await Deno.remove(tempDir, { recursive: true });
});
