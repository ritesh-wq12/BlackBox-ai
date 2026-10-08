import http from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join, extname, resolve, dirname as pathDirname } from "node:path";
import { fileURLToPath } from "node:url";
import { getStorage } from "../storage/index.js";
import { isBuildPassed, isBuildFailed } from "../events.js";
import { evidenceEngine, type EvidenceSet } from "../engine/index.js";
import { createAdapter, type AiProviderConfig, type ExplainableAdapter } from "../ai/index.js";
import type { BlackBoxEvent } from "../events.js";

/**
 * AI explanation adapter — created from configuration.
 * - No provider configured → FallbackAdapter (deterministic, offline)
 * - Provider configured → ProviderAdapter (fetches from provider, falls back on failure)
 *
 * The EvidenceSet (score, outcome, evidence, root-cause candidate) is ALWAYS
 * produced by the deterministic evidence engine. The AI adapter NEVER modifies
 * these values — it only narrates the recorded evidence.
 */
let aiAdapter: ExplainableAdapter | null = null;

function getAiAdapter(): ExplainableAdapter {
  if (!aiAdapter) {
    const config: AiProviderConfig = {};
    // Provider configuration would be loaded from environment or config file.
    // For now, no provider is configured — use deterministic fallback.
    aiAdapter = createAdapter(config);
  }
  return aiAdapter;
}

const __filename = fileURLToPath(import.meta.url);
const _here = pathDirname(__filename);
const __dirname = resolve(_here, "..", "..");

/**
 * Path to the built dashboard (React + Vite production build).
 * Resolved relative to the CLI package so the server can always find it,
 * regardless of the project directory being recorded.
 */
function dashboardDistDir(): string {
  const dist = resolve(__dirname, "..", "..", "..", "packages", "blackbox-dashboard", "dist");
  return existsSync(dist) ? dist : "";
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

    if (pathname === "/api/state") {
      this.json(res, 200, this.buildState());
      return;
    }
    if (pathname === "/api/events") {
      if (req.method === "POST") {
        const chunks: Buffer[] = [];
        req.on("data", (chunk) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          if (Buffer.concat(chunks).length > 1024 * 1024) req.destroy();
        });
        req.on("end", () => {
          let body: unknown = null;
          if (chunks.length > 0) {
            try { body = JSON.parse(chunks.join("")); } catch { /* ignore */ }
          }
          if (!this.options.storage) {
            this.json(res, 200, { ok: false, error: "storage unavailable" });
            return;
          }
          const storage = this.options.storage;
          if (Array.isArray(body)) {
            for (const ev of body) {
              storage.insertEvent(ev as Parameters<typeof storage.insertEvent>[0]);
            }
          }
          this.json(res, 200, { ok: true, count: Array.isArray(body) ? body.length : 0 });
        });
        return;
      }
      this.json(res, 200, this.options.storage.listEvents(this.options.projectDir));
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
      // The AI explanation is optional and does not modify the deterministic result.
      // Without a configured provider key, the fallback adapter provides a local
      // explanation that narrates the evidence set as-is.
      const aiExplanation = getAiAdapter().explain(result);
      this.json(res, 200, { ok: true, ...result, aiExplanation });
      return;
    }

    // Serve the React dashboard's built assets.
    const dashDist = dashboardDistDir();
    if (dashDist && pathname.startsWith("/assets/")) {
      const assetPath = join(dashDist, pathname);
      if (existsSync(assetPath)) {
        this.sendFile(res, assetPath);
        return;
      }
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

    // Single backward scan: find the most recent build outcome.
    // The first build event (pass or fail) we encounter scanning backwards
    // is the most recent one and determines health.
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i]!;
      if (isBuildPassed(e)) {
        lastHealthyBuild = e.timestamp;
        break;
      }
      if (isBuildFailed(e)) {
        latestFailure = e.timestamp;
        healthStatus = "FAILURE DETECTED";
        break;
      }
    }

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

  private serveDashboard(res: http.ServerResponse): void {
    const dashDist = dashboardDistDir();
    if (dashDist && existsSync(join(dashDist, "index.html"))) {
      // Serve the built React dashboard.
      const html = readFileSync(join(dashDist, "index.html"), "utf-8");
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(html);
      return;
    }
    // Fallback: minimal inline page if the dashboard build is unavailable.
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(
      "<!doctype html><html><head><meta charset=\"utf-8\">" +
      "<title>Digital Black Box</title></head><body>" +
      "<p>Digital Black Box is recording. Open the dashboard in a browser.</p>" +
      "</body></html>"
    );
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
