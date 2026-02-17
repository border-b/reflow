import { DatabaseSync, type StatementSync } from "node:sqlite";
import type { CaptureInsert, CaptureListResponse, CaptureRow } from "./types.ts";

interface CaptureRowRecord {
  id: number | bigint;
  captured_at_ms: number | bigint;
  captured_at_iso: string;
  image_filename: string;
  image_bytes: number | bigint;
  frontmost_app_name: string | null;
  frontmost_bundle_id: string | null;
  frontmost_pid: number | bigint | null;
}

function asNumber(value: number | bigint): number {
  return typeof value === "bigint" ? Number(value) : value;
}

function mapRow(row: CaptureRowRecord): CaptureRow {
  return {
    id: asNumber(row.id),
    captured_at_ms: asNumber(row.captured_at_ms),
    captured_at_iso: row.captured_at_iso,
    image_filename: row.image_filename,
    image_bytes: asNumber(row.image_bytes),
    frontmost_app_name: row.frontmost_app_name,
    frontmost_bundle_id: row.frontmost_bundle_id,
    frontmost_pid: row.frontmost_pid === null ? null : asNumber(row.frontmost_pid),
  };
}

export class CaptureDatabase {
  private readonly db: DatabaseSync;
  private readonly insertStmt: StatementSync;
  private readonly selectByIdStmt: StatementSync;
  private readonly listStmt: StatementSync;
  private readonly listBeforeStmt: StatementSync;

  constructor(dbPath: string) {
    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA synchronous = NORMAL;");

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS captures (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        captured_at_ms INTEGER NOT NULL,
        captured_at_iso TEXT NOT NULL,
        image_filename TEXT NOT NULL,
        image_bytes INTEGER NOT NULL,
        frontmost_app_name TEXT,
        frontmost_bundle_id TEXT,
        frontmost_pid INTEGER,
        created_at_ms INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_captures_captured_at_ms
      ON captures(captured_at_ms DESC);
    `);

    this.insertStmt = this.db.prepare(`
      INSERT INTO captures (
        captured_at_ms,
        captured_at_iso,
        image_filename,
        image_bytes,
        frontmost_app_name,
        frontmost_bundle_id,
        frontmost_pid,
        created_at_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    this.selectByIdStmt = this.db.prepare(`
      SELECT
        id,
        captured_at_ms,
        captured_at_iso,
        image_filename,
        image_bytes,
        frontmost_app_name,
        frontmost_bundle_id,
        frontmost_pid
      FROM captures
      WHERE id = ?
      LIMIT 1
    `);

    this.listStmt = this.db.prepare(`
      SELECT
        id,
        captured_at_ms,
        captured_at_iso,
        image_filename,
        image_bytes,
        frontmost_app_name,
        frontmost_bundle_id,
        frontmost_pid
      FROM captures
      ORDER BY id DESC
      LIMIT ?
    `);

    this.listBeforeStmt = this.db.prepare(`
      SELECT
        id,
        captured_at_ms,
        captured_at_iso,
        image_filename,
        image_bytes,
        frontmost_app_name,
        frontmost_bundle_id,
        frontmost_pid
      FROM captures
      WHERE id < ?
      ORDER BY id DESC
      LIMIT ?
    `);
  }

  insertCapture(payload: CaptureInsert): CaptureRow {
    const result = this.insertStmt.run(
      payload.captured_at_ms,
      payload.captured_at_iso,
      payload.image_filename,
      payload.image_bytes,
      payload.frontmost_app_name,
      payload.frontmost_bundle_id,
      payload.frontmost_pid,
      payload.created_at_ms,
    );

    const lastId = asNumber(result.lastInsertRowid);
    const row = this.selectByIdStmt.get(lastId) as CaptureRowRecord | undefined;

    if (!row) {
      throw new Error(`failed to fetch capture row ${lastId} after insert`);
    }

    return mapRow(row);
  }

  listCaptures(limit: number, beforeId?: number): CaptureListResponse {
    const safeLimit = Math.max(1, Math.min(1000, Math.trunc(limit)));

    const rows = ((beforeId && beforeId > 0
      ? this.listBeforeStmt.all(beforeId, safeLimit)
      : this.listStmt.all(safeLimit)) as unknown) as CaptureRowRecord[];

    const items = rows.map(mapRow);
    const next_before_id = items.length === safeLimit
      ? (items[items.length - 1]?.id ?? null)
      : null;

    return { items, next_before_id };
  }

  close(): void {
    this.db.close();
  }
}
