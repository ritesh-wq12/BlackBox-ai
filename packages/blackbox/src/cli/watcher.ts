import { watch, existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { join, basename } from "node:path";
import { promisify } from "node:util";
import { execFile as execFileAsyncImpl } from "node:child_process";

const execFileAsync = promisify(execFileAsyncImpl);

export type FileChangeHandler = (filePath: string, changeType: "created" | "modified" | "deleted") => void;
export type GitActivityHandler = (branch: string | null, commits: string[], changedPaths: string[]) => void;

export interface WatcherOptions {
  onFileChange: FileChangeHandler;
  onGitActivity: GitActivityHandler;
}

export class Watcher {
  private project: string;
  private options: WatcherOptions;
  private watching = false;
  private gitInterval: NodeJS.Timeout | null = null;
  constructor(project: string, options: WatcherOptions) {
    this.project = project;
    this.options = options;
  }

  start(): void {
    if (this.watching) return;
    if (!existsSync(this.project)) {
      console.warn(`⚠ blackbox: project folder does not exist yet: ${this.project}`);
    }
    this.watchFolder(this.project);
    this.startGitPolling();
    this.watching = true;
  }

  stop(): void {
    if (this.gitInterval) {
      clearInterval(this.gitInterval);
      this.gitInterval = null;
    }
    this.watching = false;
  }

  private watchFolder(folder: string): void {
    try {
      watch(folder, { recursive: true }, (eventType, filename) => {
        if (!filename) return;
        const filePath = join(folder, filename);
        // Skip the blackbox data directory so recording doesn't pollute the timeline.
        if (filePath.includes(".blackbox")) return;
        const ext = basename(filePath).split(".").pop()?.toLowerCase();
        // Ignore cache/intermediate files.
        if (["map", "js", "map", "tsbuildinfo", "log"].includes(ext ?? "")) return;
        const changeType: "created" | "modified" | "deleted" = eventType === "change"
          ? "modified"
          : eventType === "rename"
            ? "deleted"
            : "created";
        // Debounce rapid writes.
        const key = filePath;
        if (this.debounceTimers.has(key)) clearTimeout(this.debounceTimers.get(key));
        this.debounceTimers.set(key, setTimeout(() => {
          this.debounceTimers.delete(key);
          this.options.onFileChange(filePath, changeType);
        }, 150));
      });
    } catch (error) {
      console.warn(`⚠ blackbox: could not start fs.watch for ${this.project}: ${(error as Error).message}`);
    }
  }

  private startGitPolling(): void {
    this.gitInterval = setInterval(() => {
      this.detectGitActivity().then(({ branch, commits, changedPaths }) => {
        if (branch || commits?.length || changedPaths?.length) {
          this.options.onGitActivity(branch, commits ?? [], changedPaths ?? []);
        }
      }).catch(() => {
        // git not available; not a failure, just skip.
      });
    }, 5000);
  }

  private async detectGitActivity(): Promise<{ branch: string | null; commits: string[]; changedPaths: string[] }> {
    const project = this.project;
    let branch: string | null = null;
    let commits: string[] = [];
    let changedPaths: string[] = [];

    try {
      branch = (await execFileAsync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: project })).stdout.trim();
      const log = (await execFileAsync("git", ["log", "--oneline", "-5"], { cwd: project })).stdout.trim();
      commits = log.split("\n").filter(Boolean);
      const status = (await execFileAsync("git", ["status", "--porcelain"], { cwd: project })).stdout;
      changedPaths = status.split("\n").filter(Boolean).map((line) => line.trim().endsWith("/")
        ? line.trim().slice(0, -1)
        : line.trim());
    } catch {
      // Not a git repo or git commands unavailable.
    }
    return { branch, commits, changedPaths };
  }

  private debounceTimers = new Map<string, NodeJS.Timeout>();
}
