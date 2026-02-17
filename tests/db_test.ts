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

  const inserted = db.insertCapture({
    captured_at_ms: 1_700_000_000_000,
    captured_at_iso: "2023-11-14T22:13:20.000Z",
    image_filename: "1700000000000.jpg",
    image_bytes: 1234,
    frontmost_app_name: "Terminal",
    frontmost_bundle_id: "com.apple.Terminal",
    frontmost_pid: 999,
    created_at_ms: 1_700_000_000_100,
  });

  assert(inserted.id > 0);
  assertEquals(inserted.image_filename, "1700000000000.jpg");

  const listed = db.listCaptures(10);
  assertEquals(listed.items.length, 1);
  assertEquals(listed.items[0].frontmost_app_name, "Terminal");
  assertEquals(listed.next_before_id, null);

  db.close();
  await Deno.remove(tempDir, { recursive: true });
});

Deno.test("CaptureDatabase paginates with before_id", async () => {
  const tempDir = await Deno.makeTempDir();
  const dbPath = join(tempDir, "test.sqlite");
  const db = new CaptureDatabase(dbPath);

  for (let i = 0; i < 3; i += 1) {
    db.insertCapture({
      captured_at_ms: 1_700_000_000_000 + i,
      captured_at_iso: new Date(1_700_000_000_000 + i).toISOString(),
      image_filename: `${1_700_000_000_000 + i}.jpg`,
      image_bytes: 100 + i,
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
