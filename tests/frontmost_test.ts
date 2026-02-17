import { extractAsn, parseLsappinfoInfo } from "../src/frontmost.ts";

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

Deno.test("extractAsn parses standard lsappinfo front output", () => {
  const asn = extractAsn("[ ASN:0x0-0x124124 ]");
  assertEquals(asn, "ASN:0x0-0x124124");
});

Deno.test("extractAsn returns null for NULL output", () => {
  const asn = extractAsn("[ NULL ]");
  assertEquals(asn, null);
});

Deno.test("parseLsappinfoInfo parses name, bundleID and pid", () => {
  const parsed = parseLsappinfoInfo(`
    "name"="Safari"
    "bundleID"="com.apple.Safari"
    "pid"=12345
  `);

  assert(parsed !== null);
  assertEquals(parsed.name, "Safari");
  assertEquals(parsed.bundleId, "com.apple.Safari");
  assertEquals(parsed.pid, 12345);
});

Deno.test("parseLsappinfoInfo parses displayname and colon format", () => {
  const parsed = parseLsappinfoInfo(`
    displayname: Cursor
    bundleid: com.todesktop.230313mzl4w4u92
    pid: 39004
  `);

  assert(parsed !== null);
  assertEquals(parsed.name, "Cursor");
  assertEquals(parsed.bundleId, "com.todesktop.230313mzl4w4u92");
  assertEquals(parsed.pid, 39004);
});

Deno.test("parseLsappinfoInfo handles kLS key names and null markers", () => {
  const parsed = parseLsappinfoInfo(`
    kLSDisplayNameKey = "Visual Studio Code";
    kLSBundleIdentifierLowerCaseKey = "com.microsoft.VSCode";
    kLSPIDKey = 1577;
    name = [ NULL ];
  `);

  assert(parsed !== null);
  assertEquals(parsed.name, "Visual Studio Code");
  assertEquals(parsed.bundleId, "com.microsoft.VSCode");
  assertEquals(parsed.pid, 1577);
});
