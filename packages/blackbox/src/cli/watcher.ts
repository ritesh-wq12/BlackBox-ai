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
        // Skip internal directories so recording stays focused on project source.
        if (this.isExcludedPath(filePath, folder)) return;
        // Store the path relative to the project root so it can be matched
        // against build/test error output (which references files by relative path).
        const relativePath = filePath.startsWith(folder + "/") || filePath.startsWith(folder + "\\")
          ? filePath.slice(folder.length + 1)
          : filePath;
        const ext = basename(filePath).split(".").pop()?.toLowerCase();
        // Ignore cache/intermediate files.
        if (["map", "js", "map", "tsbuildinfo", "log"].includes(ext ?? "")) return;
        const changeType: "created" | "modified" | "deleted" = eventType === "change"
          ? "modified"
          : eventType === "rename"
            ? "deleted"
            : "created";
        // Debounce rapid writes.
        const key = relativePath;
        if (this.debounceTimers.has(key)) clearTimeout(this.debounceTimers.get(key));
        this.debounceTimers.set(key, setTimeout(() => {
          this.debounceTimers.delete(key);
          this.options.onFileChange(relativePath, changeType);
        }, 150));
      });
    } catch (error) {
      console.warn(`⚠ blackbox: could not start fs.watch for ${this.project}: ${(error as Error).message}`);
    }
  }

  private startGitPolling(): void {
    // Remember the last observed state so we only fire when something actually changes.
    let lastBranch: string | null = null;
    let lastCommitCount = 0;
    let lastChangedPaths = "";

    this.gitInterval = setInterval(async () => {
      const { branch, commits, changedPaths } = await this.detectGitActivity().catch(() => {
        // git not available; not a failure, just skip.
        return { branch: null, commits: [], changedPaths: [] };
      });

      const currentBranch = branch ?? null;
      const currentCommitCount = commits?.length ?? 0;
      const currentChangedPaths = (changedPaths ?? []).join("\n");

      // Only notify when something meaningful changed since the last poll.
      if (
        currentBranch !== lastBranch ||
        currentCommitCount !== lastCommitCount ||
        currentChangedPaths !== lastChangedPaths
      ) {
        lastBranch = currentBranch;
        lastCommitCount = currentCommitCount;
        lastChangedPaths = currentChangedPaths;
        this.options.onGitActivity(currentBranch, commits ?? [], changedPaths ?? []);
      }
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

  /**
   * Returns true if the path should be ignored by the file watcher.
   * Excludes .git/ (all of it), .blackbox/ and its database, and the
   * watcher's own internal state — but keeps meaningful project files
   * and any other part of the working tree visible.
   */
  private isExcludedPath(filePath: string, root: string): boolean {
    const normalized = filePath.replace(/\\/g, "/");
    const rootNorm = root.replace(/\\/g, "/");
    // Build a relative path so we can check path segments.
    const relative = normalized.startsWith(rootNorm)
      ? normalized.slice(rootNorm.length).replace(/^\//, "")
      : normalized;
    const segments = relative.split("/");
    // Exclude .git itself and everything under it.
    if (segments[0] === ".git" || segments.includes(".git")) return true;
    // Exclude .blackbox itself and everything under it (including the DB).
    if (segments[0] === ".blackbox" || segments.includes(".blackbox")) return true;
    return false;
  }

  private debounceTimers = new Map<string, NodeJS.Timeout>();
}