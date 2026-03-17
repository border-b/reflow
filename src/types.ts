export type StorageKind = "segment";

export interface CaptureRow {
  id: number;
  captured_at_ms: number;
  captured_at_iso: string;
  image_url: string;
  storage_kind: StorageKind;
  segment_id: number;
  segment_frame_index: number;
  segment_pts_ms: number;
  frontmost_app_name: string | null;
  frontmost_bundle_id: string | null;
  frontmost_pid: number | null;
}

export interface CaptureInsert {
  captured_at_ms: number;
  captured_at_iso: string;
  segment_id: number;
  segment_frame_index: number;
  segment_pts_ms: number;
  frontmost_app_name: string | null;
  frontmost_bundle_id: string | null;
  frontmost_pid: number | null;
  created_at_ms: number;
}

export interface MediaSegmentInsert {
  path: string;
  started_at_ms: number;
  ended_at_ms: number | null;
  codec: string;
  container: string;
  fps: number;
  gop: number;
  width: number;
  height: number;
  frame_count: number;
  bytes: number;
  created_at_ms: number;
}

export interface MediaSegmentUpdate {
  ended_at_ms: number | null;
  codec: string;
  frame_count: number;
  bytes: number;
}

export interface CaptureFrameRecord extends CaptureRow {
  segment_path: string;
}

export interface FrontmostAppMetadata {
  name: string | null;
  bundleId: string | null;
  pid: number | null;
}

export interface CaptureListResponse {
  items: CaptureRow[];
  next_before_id: number | null;
}

export interface CaptureEvent {
  type: "capture";
  data: CaptureRow;
}
