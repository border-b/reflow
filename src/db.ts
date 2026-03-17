import { DatabaseSync, type StatementSync } from "node:sqlite";
import type {
  CaptureFrameRecord,
  CaptureInsert,
  CaptureListResponse,
  CaptureRow,
  MediaSegmentInsert,
  MediaSegmentUpdate,
} from "./types.ts";

interface CaptureRowRecord {
  id: number | bigint;
  captured_at_ms: number | bigint;
  captured_at_iso: string;
  image_url: string;
  storage_kind: "segment";
  segment_id: number | bigint;
  segment_frame_index: number | bigint;
  segment_pts_ms: number | bigint;
  frontmost_app_name: string | null;
  frontmost_bundle_id: string | null;
  frontmost_pid: number | bigint | null;
}

interface CaptureFrameRowRecord extends CaptureRowRecord {
  segment_path: string;
}

function asNumber(value: number | bigint): number {
  return typeof value === "bigint" ? Number(value) : value;
}

function mapRow(row: CaptureRowRecord): CaptureRow {
  return {
    id: asNumber(row.id),
    captured_at_ms: asNumber(row.captured_at_ms),
    captured_at_iso: row.captured_at_iso,
    image_url: row.image_url,
    storage_kind: row.storage_kind,
    segment_id: asNumber(row.segment_id),
    segment_frame_index: asNumber(row.segment_frame_index),
    segment_pts_ms: asNumber(row.segment_pts_ms),
    frontmost_app_name: row.frontmost_app_name,
    frontmost_bundle_id: row.frontmost_bundle_id,
    frontmost_pid: row.frontmost_pid === null ? null : asNumber(row.frontmost_pid),
  };
}

function mapFrameRow(row: CaptureFrameRowRecord): CaptureFrameRecord {
  return {
    ...mapRow(row),
    segment_path: row.segment_path,
  };
}

export class CaptureDatabase {
  private readonly db: DatabaseSync;
  private readonly insertSegmentStmt: StatementSync;
  private readonly updateSegmentProgressStmt: StatementSync;
  private readonly finalizeSegmentStmt: StatementSync;
  private readonly deleteSegmentStmt: StatementSync;
  private readonly insertCaptureStmt: StatementSync;
  private readonly updateCaptureImageUrlStmt: StatementSync;
  private readonly selectByIdStmt: StatementSync;
  private readonly selectFrameByIdStmt: StatementSync;
  private readonly listStmt: StatementSync;
  private readonly listBeforeStmt: StatementSync;

  constructor(dbPath: string) {
    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA synchronous = NORMAL;");
    this.db.exec("PRAGMA foreign_keys = ON;");

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS media_segments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        path TEXT NOT NULL,
        started_at_ms INTEGER NOT NULL,
        ended_at_ms INTEGER,
        codec TEXT NOT NULL,
        container TEXT NOT NULL,
        fps INTEGER NOT NULL,
        gop INTEGER NOT NULL,
        width INTEGER NOT NULL,
        height INTEGER NOT NULL,
        frame_count INTEGER NOT NULL,
        bytes INTEGER NOT NULL,
        created_at_ms INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS captures (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        captured_at_ms INTEGER NOT NULL,
        captured_at_iso TEXT NOT NULL,
        image_url TEXT NOT NULL,
        storage_kind TEXT NOT NULL CHECK (storage_kind = 'segment'),
        segment_id INTEGER NOT NULL REFERENCES media_segments(id) ON DELETE CASCADE,
        segment_frame_index INTEGER NOT NULL,
        segment_pts_ms INTEGER NOT NULL,
        frontmost_app_name TEXT,
        frontmost_bundle_id TEXT,
        frontmost_pid INTEGER,
        created_at_ms INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_captures_captured_at_ms
      ON captures(captured_at_ms DESC);

      CREATE INDEX IF NOT EXISTS idx_captures_segment_frame
      ON captures(segment_id, segment_frame_index);
    `);

    this.insertSegmentStmt = this.db.prepare(`
      INSERT INTO media_segments (
        path,
        started_at_ms,
        ended_at_ms,
        codec,
        container,
        fps,
        gop,
        width,
        height,
        frame_count,
        bytes,
        created_at_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    this.updateSegmentProgressStmt = this.db.prepare(`
      UPDATE media_segments
      SET ended_at_ms = ?,
          frame_count = ?
      WHERE id = ?
    `);

    this.finalizeSegmentStmt = this.db.prepare(`
      UPDATE media_segments
      SET ended_at_ms = ?,
          codec = ?,
          frame_count = ?,
          bytes = ?
      WHERE id = ?
    `);

    this.deleteSegmentStmt = this.db.prepare(`
      DELETE FROM media_segments
      WHERE id = ?
    `);

    this.insertCaptureStmt = this.db.prepare(`
      INSERT INTO captures (
        captured_at_ms,
        captured_at_iso,
        image_url,
        storage_kind,
        segment_id,
        segment_frame_index,
        segment_pts_ms,
        frontmost_app_name,
        frontmost_bundle_id,
        frontmost_pid,
        created_at_ms
      ) VALUES (?, ?, ?, 'segment', ?, ?, ?, ?, ?, ?, ?)
    `);

    this.updateCaptureImageUrlStmt = this.db.prepare(`
      UPDATE captures
      SET image_url = ?
      WHERE id = ?
    `);

    this.selectByIdStmt = this.db.prepare(`
      SELECT
        id,
        captured_at_ms,
        captured_at_iso,
        image_url,
        storage_kind,
        segment_id,
        segment_frame_index,
        segment_pts_ms,
        frontmost_app_name,
        frontmost_bundle_id,
        frontmost_pid
      FROM captures
      WHERE id = ?
      LIMIT 1
    `);

    this.selectFrameByIdStmt = this.db.prepare(`
      SELECT
        captures.id,
        captures.captured_at_ms,
        captures.captured_at_iso,
        captures.image_url,
        captures.storage_kind,
        captures.segment_id,
        captures.segment_frame_index,
        captures.segment_pts_ms,
        captures.frontmost_app_name,
        captures.frontmost_bundle_id,
        captures.frontmost_pid,
        media_segments.path AS segment_path
      FROM captures
      INNER JOIN media_segments
        ON media_segments.id = captures.segment_id
      WHERE captures.id = ?
      LIMIT 1
    `);

    this.listStmt = this.db.prepare(`
      SELECT
        id,
        captured_at_ms,
        captured_at_iso,
        image_url,
        storage_kind,
        segment_id,
        segment_frame_index,
        segment_pts_ms,
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
        image_url,
        storage_kind,
        segment_id,
        segment_frame_index,
        segment_pts_ms,
        frontmost_app_name,
        frontmost_bundle_id,
        frontmost_pid
      FROM captures
      WHERE id < ?
      ORDER BY id DESC
      LIMIT ?
    `);
  }

  insertMediaSegment(payload: MediaSegmentInsert): number {
    const result = this.insertSegmentStmt.run(
      payload.path,
      payload.started_at_ms,
      payload.ended_at_ms,
      payload.codec,
      payload.container,
      payload.fps,
      payload.gop,
      payload.width,
      payload.height,
      payload.frame_count,
      payload.bytes,
      payload.created_at_ms,
    );

    return asNumber(result.lastInsertRowid);
  }

  updateMediaSegmentProgress(segmentId: number, endedAtMs: number, frameCount: number): void {
    this.updateSegmentProgressStmt.run(endedAtMs, frameCount, segmentId);
  }

  finalizeMediaSegment(segmentId: number, payload: MediaSegmentUpdate): void {
    this.finalizeSegmentStmt.run(
      payload.ended_at_ms,
      payload.codec,
      payload.frame_count,
      payload.bytes,
      segmentId,
    );
  }

  deleteMediaSegment(segmentId: number): void {
    this.deleteSegmentStmt.run(segmentId);
  }

  insertCapture(payload: CaptureInsert): CaptureRow {
    const result = this.insertCaptureStmt.run(
      payload.captured_at_ms,
      payload.captured_at_iso,
      "",
      payload.segment_id,
      payload.segment_frame_index,
      payload.segment_pts_ms,
      payload.frontmost_app_name,
      payload.frontmost_bundle_id,
      payload.frontmost_pid,
      payload.created_at_ms,
    );

    const lastId = asNumber(result.lastInsertRowid);
    const imageUrl = `/api/frame/${lastId}.jpg`;
    this.updateCaptureImageUrlStmt.run(imageUrl, lastId);

    const row = this.selectByIdStmt.get(lastId) as CaptureRowRecord | undefined;
    if (!row) {
      throw new Error(`failed to fetch capture row ${lastId} after insert`);
    }

    return mapRow(row);
  }

  getCaptureFrame(captureId: number): CaptureFrameRecord | null {
    const row = this.selectFrameByIdStmt.get(captureId) as CaptureFrameRowRecord | undefined;
    return row ? mapFrameRow(row) : null;
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
