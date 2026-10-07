import http from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getStorage } from "../storage/index.js";
import { isBuildPassed, isBuildFailed } from "../events.js";
import { evidenceEngine, type EvidenceSet } from "../engine/index.js";
import type { BlackBoxEvent } from "../events.js";

const __filename = fileURLToPath(import.meta.url);
const _here = dirname(__filename);
const __dirname = resolve(_here, "..", "..");

function dirname(fileURL: string): string {
  return fileURL.split(/[/\\]/).slice(0, -1).join("/");
}

interface ServerOptions {
  port: number;
  projectDir: string;
  sessionId: string;
  storage: ReturnType<typeof getStorage>;
}

export class Server {
  private options: Required<ServerOptions>;
  private server: http.Server | null = null;

  constructor(options: ServerOptions) {
    this.options = { ...options };
  }

  start(): void {
    this.server = http.createServer((req, res) => this.handle(req, res));
    this.server.listen(this.options.port, () => {
      console.log(`\n✓ Black Box server listening on http://localhost:${this.options.port}`);
    });
  }

  stop(): void {
    if (this.server) {
      this.server.close();
    }
  }

  private handle(req: http.IncomingMessage, res: http.ServerResponse): void {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const pathname = url.pathname;

    if (pathname === "/" || pathname === "/index.html") {
      this.serveDashboard(res);
      return;
    }

    if (pathname === "/api/state" || pathname === "/api/events") {
      this.json(res, 200, this.buildState());
      return;
    }

    if (pathname === "/api/investigate") {
      // Read the (optional) request body so callers may POST events directly;
      // otherwise the stored events for the project are used.
      let body: unknown = null;
      if (req.method === "POST" && req.headers["content-type"]?.startsWith("application/json")) {
        const chunks: Buffer[] = [];
        let accumulated = 0;
        for (let i = 0; i < 1000; i++) {
          const chunk = req.read();
          if (chunk === null) break;
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          accumulated += chunk.length;
          if (accumulated >= 1024 * 1024) break; // cap at 1 MiB
        }
        body = chunks.length > 0 ? JSON.parse(chunks.join("")) : null;
      }
      const events = Array.isArray((body as { events?: unknown })?.events)
        ? (body as { events: BlackBoxEvent[] }).events
        : this.options.storage.listEvents(this.options.projectDir) as BlackBoxEvent[];
      const result = evidenceEngine.analyze(events) as EvidenceSet;
      this.json(res, 200, { ok: true, ...result });
      return;
    }

    const assetPath = resolve(this.options.projectDir, "dashboard", "dist", pathname);
    if (pathname.startsWith("/assets/") && existsSync(assetPath)) {
      this.sendFile(res, assetPath);
      return;
    }

    res.writeHead(404).end("Not found");
  }

  private buildState(): {
    project: string;
    sessionId: string;
    recording: boolean;
    eventCount: number;
    events: BlackBoxEvent[];
    health: { status: string; lastHealthyBuild: string | null; latestFailure: string | null };
    ui: { showingInvestigation: boolean; investigationOpen: boolean };
  } {
    const events = this.options.storage.listEvents(this.options.projectDir) as BlackBoxEvent[];

    let healthStatus = "HEALTHY";
    let lastHealthyBuild: string | null = null;
    let latestFailure: string | null = null;

    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i]!;
      if (isBuildPassed(e)) {
        lastHealthyBuild = e.timestamp;
        break;
      }
    }
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i]!;
      if (isBuildFailed(e)) {
        latestFailure = e.timestamp;
        break;
      }
    }
    if (latestFailure) healthStatus = "FAILURE DETECTED";

    return {
      project: this.options.projectDir,
      sessionId: this.options.sessionId,
      recording: true,
      eventCount: events.length,
      events,
      health: { status: healthStatus, lastHealthyBuild, latestFailure },
      ui: { showingInvestigation: false, investigationOpen: false },
    };
  }

  private buildDashboardHtml(): string {
    const projectName = this.options.projectDir.split(/[\\/]/).pop() ?? "project";
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${projectName} — Digital Black Box</title>
  <style>
    :root {
      --bg: #0b0d10;
      --panel: #121418;
      --border: #232730;
      --text: #e6e8eb;
      --muted: #8a9099;
      --green: #34d399;
      --red: #f87171;
      --amber: #fbbf24;
      --mono: "Courier New", monospace;
      --sans: system-ui, -apple-system, sans-serif;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--text);
      font-family: var(--sans);
      font-size: 14px;
      min-height: 100vh;
    }
    header {
      padding: 16px 20px;
      border-bottom: 1px solid var(--border);
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 12px;
    }
    header .brand { font-weight: 700; letter-spacing: 0.02em; }
    header .status {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 4px 10px;
      border-radius: 2px;
      font-family: var(--mono);
      font-size: 12px;
    }
    header .status.recording { color: var(--green); }
    .meta { margin-left: auto; display: flex; flex-wrap: wrap; gap: 12px; align-items: center; }
    main { padding: 20px; max-width: 1000px; }
    .health {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px 16px;
      border-radius: 2px;
      border: 1px solid var(--border);
      margin-bottom: 16px;
    }
    .health.healthy { border-color: var(--green); background: #0a120e; }
    .health.failure { border-color: var(--red); background: #120a0a; }
    .health .label { font-size: 12px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); }
    .health .value { font-size: 22px; font-weight: 700; }
    .health.healthy .value { color: var(--green); }
    .health.failure .value { color: var(--red); }
    .timeline { position: relative; padding-left: 20px; }
    .timeline::before {
      content: "";
      position: absolute;
      left: 6px;
      top: 0;
      bottom: 0;
      width: 2px;
      background: var(--border);
    }
    .row {
      display: flex;
      gap: 12px;
      padding: 10px 0;
      border-bottom: 1px solid var(--border);
      align-items: flex-start;
    }
    .row:last-child { border-bottom: none; }
    .row .dot {
      flex-shrink: 0;
      width: 10px;
      height: 10px;
      border-radius: 50%;
      margin-top: 6px;
    }
    .row .dot.green { background: var(--green); }
    .row .dot.red { background: var(--red); }
    .row .dot.blue { background: #60a5fa; }
    .row .mono { font-family: var(--mono); font-size: 12px; color: var(--muted); }
    .row .desc { flex: 1; }
    .failure-row { background: #1a0a0a; }
    .row .icon { flex-shrink: 0; font-size: 16px; }
    .controls { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 16px; }
    button {
      padding: 10px 16px;
      border-radius: 2px;
      border: 1px solid var(--border);
      background: var(--panel);
      color: var(--text);
      font-weight: 600;
      cursor: pointer;
    }
    button:hover { background: #1a1d24; }
    .empty { color: var(--muted); font-style: italic; padding: 24px 0; }
    .spinner { display: inline-block; width: 10px; height: 10px; border: 2px solid var(--border); border-top-color: var(--text); border-radius: 50%; animation: spin 0.8s linear infinite; margin-right: 8px; vertical-align: middle; }
    @keyframes spin { to { transform: rotate(360deg); } }

    @media (max-width: 640px) {
      .meta { width: 100%; margin-left: 0; }
    }
  </style>
</head>
<body>
  <header>
    <div class="brand">◉ Digital Black Box</div>
    <div class="status recording">● RECORDING</div>
    <div class="meta">
      <span>Project: <span class="mono" id="project-name"></span></span>
      <span>Events: <span class="mono" id="event-count">0</span></span>
      <span>Status: <span class="mono" id="health-status">HEALTHY</span></span>
    </div>
  </header>
  <main>
    <div class="health healthy">
      <span class="label">Health</span>
      <span class="value">HEALTHY</span>
      <span style="margin-left:auto;font-size:12px;color:var(--muted)" id="health-detail"></span>
    </div>
    <div class="timeline" id="timeline">
      <div class="empty">Event count 0 — events will appear as they happen.</div>
    </div>
    <div class="controls">
      <button id="pause-btn">Pause</button>
      <button id="stop-btn">Stop</button>
      <button id="investigate-btn" hidden>INVESTIGATE FAILURE</button>
    </div>
  </main>
  <script>
    const root = document.querySelector("main");
    const projectName = document.getElementById("project-name");
    const eventCount = document.getElementById("event-count");
    const healthStatus = document.getElementById("health-status");
    const healthDetail = document.getElementById("health-detail");
    const timeline = document.getElementById("timeline");
    const investigateBtn = document.getElementById("investigate-btn");
    const pauseBtn = document.getElementById("pause-btn");
    const stopBtn = document.getElementById("stop-btn");

    projectName.textContent = "PROJECT";
    let state = { events: [], eventCount: 0, health: { status: "HEALTHY" } };

    async function refresh() {
      try {
        const res = await fetch("/api/state");
        state = await res.json();
        render();
      } catch (_) { /* polling failure: keep RECORDING visible */ }
    }

    function render() {
      eventCount.textContent = String(state.eventCount ?? 0);
      healthStatus.textContent = state.health?.status ?? "HEALTHY";
      const detail = state.health?.lastHealthyBuild
        ? "Last success: " + new Date(state.health.lastHealthyBuild).toLocaleTimeString()
        : "";
      healthDetail.textContent = detail;

      if (!state.events.length) {
        timeline.innerHTML = '<div class="empty">Event count 0 — events will appear as they happen.</div>';
        investigateBtn.hidden = true;
        return;
      }

      investigateBtn.hidden = state.health?.status !== "FAILURE DETECTED";
      let html = "";
      state.events.forEach((e, i) => {
        const isFailure = state.health?.status === "FAILURE DETECTED" && i === state.events.length - 1;
        html += "<div class=\"row \">" +
          "<div class=\"dot \"></div>" +
          "<div class=\"mono\">" + new Date(e.timestamp).toLocaleTimeString() + "</div>" +
          "<div class=\"icon\">" + iconFor(e) + "</div>" +
          "<div class=\"desc\">" + escapeHtml(e.summary) + "</div>" +
          "<div class=\"mono\">" + (e.path || "") + "</div>" +
          "</div>";
      });
      timeline.innerHTML = html;
    }

    function iconFor(e) {
      switch (e.type) {
        case "BUILD_TEST": return e.details?.exitCode === 0 ? "✓" : "✕";
        case "COMMAND": return "$";
        case "FILE": return "◆";
        case "GIT": return "⬡";
        case "ERROR": return "⚠";
        default: return "•";
      }
    }

    function escapeHtml(s) {
      return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    }

    pauseBtn.addEventListener("click", () => {});
    stopBtn.addEventListener("click", () => {});
    investigateBtn.addEventListener("click", () => {});

    refresh();
    setInterval(refresh, 1000);
  </script>
</body>
</html>`;
  }

  private serveDashboard(res: http.ServerResponse): void {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(this.buildDashboardHtml());
  }

  private sendFile(res: http.ServerResponse, filePath: string): void {
    const ext = extname(filePath).toLowerCase();
    const map: Record<string, string> = {
      ".js": "text/javascript",
      ".css": "text/css",
      ".json": "application/json",
      ".svg": "image/svg+xml",
      ".png": "image/png",
      ".ico": "image/x-icon",
    };
    res.setHeader("Content-Type", map[ext] ?? "application/octet-stream");
    const data = readFileSync(filePath);
    if (data) {
      res.end(data);
    } else {
      res.writeHead(404).end("Not found");
    }
  }

  private json<T>(res: http.ServerResponse, status: number, payload: T): void {
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(payload));
  }
}
