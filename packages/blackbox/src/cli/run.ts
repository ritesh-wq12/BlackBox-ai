import { spawn } from "node:child_process";
import { join } from "node:path";
import { getStorage } from "../storage/index.js";
import { createCommandEvent, createErrorEvent, isBuildFailed } from "../events.js";

const DEFAULT_PORT = 8888;

function promptPort(): number | undefined {
  // Check environment variable first (set by start or manually).
  const p = process.env.BLACKBOX_PORT;
  if (p) {
    const n = Number(p);
    if (Number.isFinite(n) && n > 0 && n < 65536) return n;
  }
  // Fall back to port file written by `blackbox start`.
  try {
    const { readFileSync } = require("node:fs");
    const portFile = join(process.cwd(), ".blackbox", "port.txt");
    const content = readFileSync(portFile, "utf-8").trim();
    const n = Number(content);
    if (Number.isFinite(n) && n > 0 && n < 65536) return n;
  } catch { /* port file not available */ }
  return undefined;
}

function postToServer(port: number, events: Record<string, unknown>[]): boolean {
  try {
    const body = JSON.stringify(events);
    const http = require("node:http");
    const req = http.request(
      {
        hostname: "localhost",
        port,
        path: "/api/events",
        method: "POST",
        headers: { "Content-Type": "application/json" },
      },
      () => { /* ignore response */ }
    );
    req.write(body);
    req.end();
    return true;
  } catch {
    return false;
  }
}

export class RunCommand {
  private storage: ReturnType<typeof getStorage> | null = null;
  private readonly port: number | undefined;
  private readonly dbPath: string;

  constructor(private projectDir: string) {
    this.dbPath = join(this.projectDir, ".blackbox", "blackbox.db");
    this.port = promptPort() ?? DEFAULT_PORT;
  }

  private getStorage(): ReturnType<typeof getStorage> {
    if (!this.storage) {
      this.storage = getStorage({ filepath: this.dbPath });
    }
    return this.storage;
  }

  private recordEvents(events: BlackBoxEvent[]): void {
    const storage = this.getStorage();
    for (const ev of events) {
      storage.insertEvent(ev);
    }
  }

  run(args: string[]): void {
    const command = args.join(" ");
    if (!command) {
      console.error("blackbox run: no command specified. Usage: blackbox run <command...>");
      process.exitCode = 1;
      return;
    }

    console.log(`\n$ ${command}\n`);

    const start = Date.now();
    const child = spawn(command, {
      cwd: this.projectDir,
      stdio: ["ignore", "pipe", "pipe"],
      shell: true,
      windowsHide: process.platform === "win32",
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      process.stdout.write(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
      process.stderr.write(chunk);
    });

    child.on("error", (error) => {
      const end = Date.now();
      const commandEvent = createCommandEvent(
        this.projectDir,
        this.getSessionId(),
        command,
        new Date(start).toISOString(),
        new Date(end).toISOString(),
        -1,
        stdout,
        stderr ?? ""
      );
      const errorEvent = createErrorEvent(
        this.projectDir,
        this.getSessionId(),
        error.message,
        "",
        command,
        new Date().toISOString()
      );
      const events = [commandEvent, errorEvent];
      if (this.port && !postToServer(this.port, events.map((e) => ({ ...e })) as Record<string, unknown>[])) {
        this.recordEvents(events);
      }
      console.log(`\n✕ Black Box recorded: BUILD FAILED`);
      process.exitCode = 1;
    });

    child.on("close", (code) => {
      const end = Date.now();
      const exitCode = code !== undefined && code !== null ? code : 1;

      const commandEvent = createCommandEvent(
        this.projectDir,
        this.getSessionId(),
        command,
        new Date(start).toISOString(),
        new Date(end).toISOString(),
        exitCode,
        stdout,
        stderr ?? ""
      );
      // Attach error reference to details so the evidence engine can match it.
      if (exitCode !== 0 && stderr) {
        (commandEvent.details as Record<string, unknown>).error = stderr;
      }

      const events: BlackBoxEvent[] = [commandEvent];
      if (exitCode !== 0) {
        const errorEvent = createErrorEvent(
          this.projectDir,
          this.getSessionId(),
          stderr ?? `Command failed with exit code ${exitCode}`,
          stderr ?? "",
          command,
          new Date().toISOString()
        );
        events.push(errorEvent);
      }

      // Try to post events to the running server via HTTP first.
      // This avoids concurrent SQLite writes on Windows when `start` and `run`
      // are separate processes sharing the same database file.
      if (this.port && !postToServer(this.port, events.map((e) => ({ ...e })) as Record<string, unknown>[])) {
        this.recordEvents(events);
      }

      if (isBuildFailed(commandEvent)) {
        console.log(`\n✕ Black Box recorded: BUILD FAILED`);
        process.exitCode = 1;
      } else {
        console.log(`\n✓ Black Box recorded: BUILD PASSED`);
      }
    });
  }

  private getSessionId(): string {
    return `session-${Date.now()}-${process.pid}`;
  }
}

type BlackBoxEvent = ReturnType<typeof createCommandEvent> | ReturnType<typeof createErrorEvent>;
