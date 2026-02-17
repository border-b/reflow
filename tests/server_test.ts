import { sanitizeImageFilename } from "../src/server.ts";

function assertEquals<T>(actual: T, expected: T): void {
  if (!Object.is(actual, expected)) {
    throw new Error(`expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

Deno.test("sanitizeImageFilename accepts safe jpg names", () => {
  assertEquals(sanitizeImageFilename("1739800000000.jpg"), "1739800000000.jpg");
});

Deno.test("sanitizeImageFilename rejects traversal", () => {
  assertEquals(sanitizeImageFilename("../secret.jpg"), null);
  assertEquals(sanitizeImageFilename("%2E%2E%2Fsecret.jpg"), null);
});

Deno.test("sanitizeImageFilename rejects non-jpg names", () => {
  assertEquals(sanitizeImageFilename("notes.txt"), null);
});
