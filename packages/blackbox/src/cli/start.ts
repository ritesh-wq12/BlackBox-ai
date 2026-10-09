import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { getStorage, resetStorage } from "../storage/index.js";
import { createFileEvent, createCommandEvent, createErrorEvent, createGitEvent } from "../events.js";
import { Server } from "./server.js";
import { Watcher } from "./watcher.js";

const __filename = fileURLToPath(import.meta.url);
const _here = dirname(__filename);
const __dirname = resolve(_here, "..", "..");

interface StartOptions {
  projectDir?: string;
  port?: number;
  noOpen?: boolean;
}

export class StartCommand {
  private options: Required<StartOptions>;
  private storage: ReturnType<typeof getStorage>;
  private server!: Server;
  private watcher!: Watcher;

  constructor(options: StartOptions = {}) {
    this.options = {
      projectDir: options.projectDir ?? process.cwd(),
      port: options.port ?? 8888,
      noOpen: options.noOpen ?? false,
    };
    const dbPath = join(this.options.projectDir, ".blackbox", "blackbox.db");
    resetStorage({ filepath: dbPath });
    this.storage = getStorage({ filepath: dbPath });
  }

  async run(portParam?: number): Promise<void> {
    if (portParam !== undefined) {
      this.options.port = portParam;
    }
    const project = this.options.projectDir;
    const sessionId = `session-${Date.now()}-${process.pid}`;

    this.server = new Server({
      port: this.options.port,
      projectDir: project,
      sessionId,
      storage: this.storage,
    });
    this.server.start();

    this.watcher = new Watcher(project, {
      onFileChange: (filePath, changeType) => {
        // Do not append events while paused or stopped.
        if (this.server.getRecordingStatus() !== "recording") return;
        const event = createFileEvent(project, sessionId, filePath, changeType);
        this.storage.insertEvent({ ...event });
      },
      onGitActivity: (branch, commits, changedPaths) => {
        // Do not append events while paused or stopped.
        if (this.server.getRecordingStatus() !== "recording") return;
        const event = createGitEvent(project, sessionId, { branch: branch as string | undefined, commits, changedPaths });
        this.storage.insertEvent({ ...event });
      },
    });
    this.watcher?.start();

    const session = {
      id: sessionId,
      startedAt: new Date().toISOString(),
      status: "running" as const,
      project: project,
      agentPid: process.pid,
    };
    this.storage.insertSession(session);

    const dashboardUrl = `http://localhost:${this.options.port}`;
    this.printBanner(project);
    this.openBrowser(dashboardUrl);

    // Persist the port so `blackbox run` can discover the server.
    try {
      const { writeFileSync } = require("node:fs");
      writeFileSync(join(project, ".blackbox", "port.txt"), String(this.options.port), "utf-8");
    } catch { /* best effort */ }

    this.keepAlive();
  }

  private printBanner(project: string): void {
    const bannerName = "Digital Black Box";
    console.log("");
    console.log(bannerName);
    console.log("✓ Recording started");
    console.log(`Project: ${project}`);
    console.log("Watching: project files, Git, builds/tests");
    console.log(`Dashboard: http://localhost:${this.options.port}`);
    console.log("");
  }

  private openBrowser(url: string): void {
    const cmd = process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "start"
        : "xdg-open";
    spawn(cmd, [url], { stdio: "ignore" }).on("error", () => {
      // Best-effort; the terminal URL is always available.
    });
  }

  private keepAlive(): void {
    const interval = setInterval(() => {
      // Heartbeat signal; the process stays alive for the duration of the session.
    }, 30_000);

    process.once("SIGINT", () => {
      clearInterval(interval);
      this.watcher?.stop();
      this.server?.stop();
      this.storage.close();
      console.log("\n✓ Recording stopped");
      process.exit(0);
    });
    process.once("SIGTERM", () => {
      clearInterval(interval);
      this.watcher?.stop();
      this.server?.stop();
      this.storage.close();
      process.exit(0);
    });
  }
}
