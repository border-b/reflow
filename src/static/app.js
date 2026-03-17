const timelineEl = document.getElementById("timeline");
const statusEl = document.getElementById("status");
const countEl = document.getElementById("count");
const template = document.getElementById("capture-template");

const seenIds = new Set();
let visibleCount = 0;

function formatTime(ms) {
  return new Date(ms).toLocaleString();
}

function updateCount() {
  countEl.textContent = `${visibleCount} capture${visibleCount === 1 ? "" : "s"}`;
}

function renderCapture(capture, { prepend = false } = {}) {
  if (seenIds.has(capture.id)) return;
  seenIds.add(capture.id);

  const node = template.content.firstElementChild.cloneNode(true);
  const img = node.querySelector(".thumb");
  const timeLine = node.querySelector(".time");
  const appLine = node.querySelector(".app");
  const bundleLine = node.querySelector(".bundle");
  const pidLine = node.querySelector(".pid");
  const storageLine = node.querySelector(".bytes");

  img.src = `${capture.image_url}?v=${capture.id}`;

  timeLine.textContent = `Captured: ${formatTime(capture.captured_at_ms)}`;
  appLine.textContent = `Frontmost app: ${capture.frontmost_app_name ?? "(unknown)"}`;
  bundleLine.textContent = `Bundle ID: ${capture.frontmost_bundle_id ?? "(unknown)"}`;
  pidLine.textContent = `PID: ${capture.frontmost_pid ?? "(unknown)"}`;
  storageLine.textContent =
    `Storage: ${capture.storage_kind} · segment ${capture.segment_id} frame ${capture.segment_frame_index}`;

  if (prepend) {
    timelineEl.prepend(node);
  } else {
    timelineEl.append(node);
  }

  visibleCount += 1;
  updateCount();
}

async function loadInitial() {
  statusEl.textContent = "Loading recent captures...";

  const response = await fetch("/api/captures?limit=300", { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Failed to load captures: HTTP ${response.status}`);
  }

  const payload = await response.json();
  for (const item of payload.items) {
    renderCapture(item, { prepend: false });
  }

  if (payload.items.length === 0) {
    timelineEl.innerHTML = '<p class="empty">No captures yet. Keep this page open; frames will appear live.</p>';
  }

  statusEl.textContent = "Connected";
}

function connectStream() {
  const stream = new EventSource("/api/stream");

  stream.onopen = () => {
    statusEl.textContent = "Connected (live)";
  };

  stream.onerror = () => {
    statusEl.textContent = "Disconnected, retrying...";
  };

  stream.onmessage = (event) => {
    try {
      const parsed = JSON.parse(event.data);
      if (parsed.type === "capture") {
        const emptyState = timelineEl.querySelector(".empty");
        if (emptyState) {
          emptyState.remove();
        }
        renderCapture(parsed.data, { prepend: true });
      }
    } catch (error) {
      console.error("Failed to parse stream event", error);
    }
  };
}

(async () => {
  try {
    await loadInitial();
    connectStream();
  } catch (error) {
    statusEl.textContent = "Failed to load timeline";
    console.error(error);
  }
})();
