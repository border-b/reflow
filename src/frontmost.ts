import type { FrontmostAppMetadata } from "./types.ts";
import { basename } from "node:path";

interface CommandOutput {
  code: number;
  stdout: string;
  stderr: string;
}

async function runCommand(command: string, args: string[]): Promise<CommandOutput> {
  const output = await new Deno.Command(command, {
    args,
    stdout: "piped",
    stderr: "piped",
  }).output();

  return {
    code: output.code,
    stdout: new TextDecoder().decode(output.stdout).trim(),
    stderr: new TextDecoder().decode(output.stderr).trim(),
  };
}

export function extractAsn(frontOutput: string): string | null {
  const text = frontOutput.trim();
  if (!text || /\[\s*NULL\s*\]/i.test(text)) {
    return null;
  }

  const asnMatch = text.match(/ASN:[0-9A-Fa-fx:-]+/);
  if (asnMatch) {
    return asnMatch[0];
  }

  if (text.startsWith("ASN:")) {
    return text.split(/\s+/)[0];
  }

  return null;
}

function normalizeNullish(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  if (
    /^(\[\s*NULL\s*\]|NULL|null|\(null\)|<null>)$/i.test(trimmed)
  ) {
    return null;
  }

  return trimmed;
}

function stripQuotesAndPunctuation(value: string): string {
  let out = value.trim().replace(/[;,]\s*$/, "").trim();
  if (
    out.startsWith('"') && out.endsWith('"') &&
    out.length >= 2
  ) {
    out = out.slice(1, -1);
  }
  if (
    out.startsWith("'") && out.endsWith("'") &&
    out.length >= 2
  ) {
    out = out.slice(1, -1);
  }
  return out.trim();
}

function canonicalKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function parseLsappinfoValues(text: string): Map<string, string> {
  const values = new Map<string, string>();

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Accept formats like:
    //   "name"="Safari"
    //   bundleID = com.apple.Safari;
    //   pid: 123
    const match = trimmed.match(/^"?([^"=:]+)"?\s*(?:=|:)\s*(.+)$/);
    if (!match) continue;

    const key = canonicalKey(match[1]);
    const rawValue = stripQuotesAndPunctuation(match[2]);
    const value = normalizeNullish(rawValue);

    if (value !== null) {
      values.set(key, value);
    }
  }

  return values;
}

function pickFirst(values: Map<string, string>, keys: string[]): string | null {
  for (const key of keys) {
    const v = normalizeNullish(values.get(canonicalKey(key)) ?? null);
    if (v !== null) return v;
  }
  return null;
}

function parsePidValue(value: string | null): number | null {
  if (value === null) return null;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }
  return parsed;
}

function extractPidFromText(text: string): number | null {
  const pidMatch = text.match(/\bpid\b\s*[:=]\s*(\d+)/i) ??
    text.match(/\blspidkey\b\s*[:=]\s*(\d+)/i);
  if (!pidMatch) return null;
  return parsePidValue(pidMatch[1]);
}

interface DerivedProcessInfo {
  name: string | null;
  bundlePath: string | null;
}

async function deriveProcessInfoFromPid(pid: number): Promise<DerivedProcessInfo> {
  const proc = await runCommand("ps", ["-p", String(pid), "-o", "comm="]);
  if (proc.code !== 0) {
    return { name: null, bundlePath: null };
  }

  const commandPath = proc.stdout.trim();
  if (!commandPath) {
    return { name: null, bundlePath: null };
  }

  const bundlePathMatch = commandPath.match(/(.+?\.app)(?:\/|$)/i);
  if (bundlePathMatch?.[1]) {
    return {
      name: basename(bundlePathMatch[1]).replace(/\.app$/i, ""),
      bundlePath: bundlePathMatch[1],
    };
  }

  return {
    name: basename(commandPath),
    bundlePath: null,
  };
}

async function readBundleIdFromBundlePath(bundlePath: string): Promise<string | null> {
  const lookup = await runCommand("mdls", [
    "-name",
    "kMDItemCFBundleIdentifier",
    "-raw",
    bundlePath,
  ]);

  if (lookup.code !== 0) return null;
  return normalizeNullish(stripQuotesAndPunctuation(lookup.stdout));
}

function extractBundlePath(values: Map<string, string>): string | null {
  return pickFirst(values, ["bundlepath", "kLSBundlePathKey"]);
}

async function getFrontmostViaJxa(): Promise<FrontmostAppMetadata | null> {
  const script = [
    'ObjC.import("AppKit");',
    "const app = $.NSWorkspace.sharedWorkspace.frontmostApplication;",
    "if (!app) { console.log('{}'); }",
    "else {",
    "  const payload = {",
    "    name: ObjC.unwrap(app.localizedName) || null,",
    "    bundleId: ObjC.unwrap(app.bundleIdentifier) || null,",
    "    pid: Number(app.processIdentifier) || null",
    "  };",
    "  console.log(JSON.stringify(payload));",
    "}",
  ].join(" ");

  const out = await runCommand("osascript", ["-l", "JavaScript", "-e", script]);
  if (out.code !== 0 || !out.stdout.trim()) {
    return null;
  }

  const firstLine = out.stdout.split(/\r?\n/).find((line) => line.trim().startsWith("{"));
  if (!firstLine) return null;

  try {
    const parsed = JSON.parse(firstLine) as {
      name?: unknown;
      bundleId?: unknown;
      pid?: unknown;
    };

    const name = normalizeNullish(typeof parsed.name === "string" ? parsed.name : null);
    const bundleId = normalizeNullish(typeof parsed.bundleId === "string" ? parsed.bundleId : null);
    const pid = typeof parsed.pid === "number" && Number.isFinite(parsed.pid) && parsed.pid >= 0
      ? parsed.pid
      : null;

    if (!name && !bundleId && pid === null) return null;
    return { name, bundleId, pid };
  } catch {
    return null;
  }
}

export function parseLsappinfoInfo(infoOutput: string): FrontmostAppMetadata | null {
  const values = parseLsappinfoValues(infoOutput);
  const name = pickFirst(values, [
    "displayname",
    "name",
    "bundlename",
    "bundlelastcomponent",
    "kCFBundleNameKey",
    "kLSDisplayNameKey",
  ]);
  const bundleId = pickFirst(values, [
    "bundleid",
    "bundleidentifier",
    "kLSBundleIdentifierLowerCaseKey",
    "kCFBundleIdentifierKey",
  ]);
  const pid = parsePidValue(
    pickFirst(values, ["pid", "kLSPIDKey", "kLSOriginalPIDKey"]),
  );

  if (!name && !bundleId && pid === null) {
    return null;
  }

  return { name, bundleId, pid };
}

export async function getFrontmostAppMetadata(): Promise<FrontmostAppMetadata | null> {
  const front = await runCommand("lsappinfo", ["front"]);
  if (front.code !== 0) {
    if (front.stderr) {
      console.warn(`[frontmost] lsappinfo front failed: ${front.stderr}`);
    }
    return null;
  }

  const asn = extractAsn(front.stdout);
  const frontPid = extractPidFromText(front.stdout);
  const appSpecifier = asn ?? (frontPid !== null ? `#${frontPid}` : null);

  let metadata: FrontmostAppMetadata | null = null;
  let parsedValues = new Map<string, string>();

  if (appSpecifier) {
    const info = await runCommand("lsappinfo", [
      "info",
      "-only",
      "displayname",
      "-only",
      "name",
      "-only",
      "bundleid",
      "-only",
      "bundlepath",
      "-only",
      "pid",
      appSpecifier,
    ]);

    if (info.code === 0) {
      metadata = parseLsappinfoInfo(info.stdout);
      parsedValues = parseLsappinfoValues(info.stdout);
    } else if (info.stderr) {
      console.warn(`[frontmost] lsappinfo info failed: ${info.stderr}`);
    }
  }

  if (!metadata && front.stdout) {
    metadata = parseLsappinfoInfo(front.stdout);
  }

  if (!metadata) {
    metadata = { name: null, bundleId: null, pid: frontPid };
  }

  // Fallback: derive app name and bundle path from process command path.
  if ((!metadata.name || !metadata.bundleId) && metadata.pid !== null) {
    const processInfo = await deriveProcessInfoFromPid(metadata.pid);
    metadata.name = metadata.name ?? processInfo.name;

    if (!metadata.bundleId && processInfo.bundlePath) {
      metadata.bundleId = await readBundleIdFromBundlePath(processInfo.bundlePath);
    }
  }

  // Fallback: derive bundle ID from lsappinfo bundle path if available.
  if (!metadata.bundleId) {
    const parsedBundlePath = extractBundlePath(parsedValues);
    if (parsedBundlePath) {
      metadata.bundleId = await readBundleIdFromBundlePath(parsedBundlePath);
    }
  }

  // Last fallback for missing fields: query NSWorkspace frontmost application via JXA.
  if (!metadata.name || !metadata.bundleId) {
    const jxa = await getFrontmostViaJxa();
    if (jxa) {
      const sameProcess = metadata.pid === null || jxa.pid === null || metadata.pid === jxa.pid;
      if (sameProcess) {
        metadata.name = metadata.name ?? jxa.name;
        metadata.bundleId = metadata.bundleId ?? jxa.bundleId;
        metadata.pid = metadata.pid ?? jxa.pid;
      }
    }
  }

  if (!metadata.name && !metadata.bundleId && metadata.pid === null) {
    return null;
  }

  return metadata;
}
