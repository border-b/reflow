export interface CaptureRow {
  id: number;
  captured_at_ms: number;
  captured_at_iso: string;
  image_filename: string;
  image_bytes: number;
  frontmost_app_name: string | null;
  frontmost_bundle_id: string | null;
  frontmost_pid: number | null;
}

export interface CaptureInsert {
  captured_at_ms: number;
  captured_at_iso: string;
  image_filename: string;
  image_bytes: number;
  frontmost_app_name: string | null;
  frontmost_bundle_id: string | null;
  frontmost_pid: number | null;
  created_at_ms: number;
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
