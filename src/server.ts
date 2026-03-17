import type { AppConfig } from "./config.ts";
import { CaptureDatabase } from "./db.ts";
import { FramePreviewStore } from "./media_store.ts";
import type { CaptureEvent, CaptureRow } from "./types.ts";

const SSE_HEADERS = {
  "content-type": "text/event-stream; charset=utf-8",
  "cache-control": "no-cache, no-transform",
  "connection": "keep-alive",
} as const;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function parsePositiveInt(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

export function parseFrameCaptureId(pathname: string): number | null {
  const match = pathname.match(/^\/api\/frame\/([0-9]+)\.jpg$/i);
  if (!match) {
    return null;
  }

  const captureId = Number.parseInt(match[1] ?? "", 10);
  if (!Number.isFinite(captureId) || captureId <= 0) {
    return null;
  }

  return captureId;
}

export class TimelineServer {
  private readonly encoder = new TextEncoder();
  private readonly clients = new Map<number, ReadableStreamDefaultController<Uint8Array>>();
  private readonly abortController = new AbortController();
  private nextClientId = 1;
  private server: ReturnType<typeof Deno.serve> | null = null;

  constructor(
    private readonly config: AppConfig,
    private readonly db: CaptureDatabase,
    private readonly framePreviewStore: FramePreviewStore,
  ) {}

  start(): void {
    this.server = Deno.serve(
      {
        port: this.config.port,
        signal: this.abortController.signal,
      },
      (request) => this.handleRequest(request),
    );

    console.log(`[server] listening on http://localhost:${this.config.port}`);
  }

  async stop(): Promise<void> {
    this.abortController.abort();
    this.closeAllSseClients();

    if (this.server) {
      try {
        await this.server.finished;
      } catch {
        // no-op: expected on abort
      }
    }
  }

  broadcastCapture(row: CaptureRow): void {
    const event: CaptureEvent = { type: "capture", data: row };
    const payload = this.encoder.encode(`data: ${JSON.stringify(event)}\n\n`);

    const staleIds: number[] = [];
    for (const [id, controller] of this.clients.entries()) {
      try {
        controller.enqueue(payload);
      } catch {
        staleIds.push(id);
      }
    }

    for (const id of staleIds) {
      this.clients.delete(id);
    }
  }

  private closeAllSseClients(): void {
    for (const controller of this.clients.values()) {
      try {
        controller.close();
      } catch {
        // ignore already closed streams
      }
    }
    this.clients.clear();
  }

  private async handleRequest(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;

    if (request.method !== "GET") {
      return new Response("method not allowed", { status: 405 });
    }

    if (pathname === "/") {
      return this.serveStaticFile("index.html", "text/html; charset=utf-8");
    }

    if (pathname === "/app.js") {
      return this.serveStaticFile("app.js", "application/javascript; charset=utf-8");
    }

    if (pathname === "/styles.css") {
      return this.serveStaticFile("styles.css", "text/css; charset=utf-8");
    }

    if (pathname === "/healthz") {
      return jsonResponse({ ok: true, now_ms: Date.now() });
    }

    if (pathname === "/api/captures") {
      return this.handleCapturesApi(url);
    }

    if (pathname === "/api/stream") {
      return this.handleStreamApi(request);
    }

    if (pathname.startsWith("/api/frame/")) {
      return this.handleFrameRequest(pathname);
    }

    return new Response("not found", { status: 404 });
  }

  private handleCapturesApi(url: URL): Response {
    const requestedLimit = parsePositiveInt(url.searchParams.get("limit"));
    const limit = requestedLimit ? Math.min(requestedLimit, 1000) : 300;

    const beforeId = parsePositiveInt(url.searchParams.get("before_id")) ?? undefined;
    const payload = this.db.listCaptures(limit, beforeId);

    return jsonResponse(payload);
  }

  private handleStreamApi(request: Request): Response {
    const clientId = this.nextClientId++;
    let heartbeat: number | undefined;
    let controllerRef: ReadableStreamDefaultController<Uint8Array> | null = null;

    const cleanup = () => {
      if (heartbeat !== undefined) {
        clearInterval(heartbeat);
      }
      this.clients.delete(clientId);

      if (controllerRef) {
        try {
          controllerRef.close();
        } catch {
          // ignore
        }
      }
    };

    const stream = new ReadableStream<Uint8Array>({
      start: (controller) => {
        controllerRef = controller;
        this.clients.set(clientId, controller);

        controller.enqueue(
          this.encoder.encode(
            `data: ${JSON.stringify({ type: "ready", data: { client_id: clientId } })}\n\n`,
          ),
        );

        heartbeat = setInterval(() => {
          try {
            controller.enqueue(this.encoder.encode(": keepalive\n\n"));
          } catch {
            cleanup();
          }
        }, 15_000);

        request.signal.addEventListener("abort", cleanup, { once: true });
      },
      cancel: cleanup,
    });

    return new Response(stream, { headers: SSE_HEADERS });
  }

  private async serveStaticFile(filename: string, contentType: string): Promise<Response> {
    const path = `${this.config.staticDir}/${filename}`;
    try {
      const data = await Deno.readFile(path);
      return new Response(data, {
        headers: {
          "content-type": contentType,
          "cache-control": "no-store",
        },
      });
    } catch {
      return new Response("not found", { status: 404 });
    }
  }

  private async handleFrameRequest(pathname: string): Promise<Response> {
    const captureId = parseFrameCaptureId(pathname);
    if (!captureId) {
      return new Response("invalid frame path", { status: 400 });
    }

    const capture = this.db.getCaptureFrame(captureId);
    if (!capture) {
      return new Response("capture not found", { status: 404 });
    }

    const previewPath = await this.framePreviewStore.getOrCreatePreview(capture);
    if (!previewPath) {
      return new Response("frame not available", { status: 404 });
    }

    try {
      const data = await Deno.readFile(previewPath);
      return new Response(data, {
        headers: {
          "content-type": "image/jpeg",
          "cache-control": "no-store",
        },
      });
    } catch {
      return new Response("frame not found", { status: 404 });
    }
  }
}
