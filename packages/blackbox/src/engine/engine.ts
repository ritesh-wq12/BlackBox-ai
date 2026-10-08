import { execSync } from "node:child_process";
import {
  findLastHealthyEvent,
  findFirstFailureEvent,
  filesInWindow,
  findErrorEvent,
  buildChain,
  BlackBoxEvent,
  type BlackBoxEvent as BlackBoxEventType,
} from "./evidence.js";
import { scoreCandidates, outcomeFor, formatScore, POINTS_PER_SIGNAL } from "./scoring.js";
import type { Candidate, EvidenceChain } from "./evidence.js";

export interface EvidenceSet {
  score: number;
  status: "LIKELY_ROOT_CAUSE" | "NO_CLEAR_ROOT_CAUSE" | "NO_CAUSAL_CHANGE_DETECTED";
  breakdown: { point: string; eventId: string }[];
  topCandidates: { candidate: string; score: number }[];
  chain: string[];
  diff?: string;
  error?: string;
  message?: string;
}

export class EvidenceEngine {
  /**
   * Analyze recorded events and produce an EvidenceSet.
   * The score is pure function of the recorded events — the AI never sees or
   * modifies it; the UI renders the breakdown next to the score.
   */
  analyze(events: BlackBoxEvent[]): EvidenceSet {
    const lastHealthy = findLastHealthyEvent(events);
    const failure = findFirstFailureEvent(events, lastHealthy);

    if (!failure) {
      // No failure recorded yet, or nothing to investigate.
      return this.noCandidateSet(events);
    }

    const chain = buildChain(events, lastHealthy, failure);
    const scored = scoreCandidates(chain);

    if (scored.length === 0 || scored[0]?.score === 0) {
      return this.noCandidateSet(events);
    }

    const top = scored[0]!;
    const status = outcomeFor(top.score);

    // Build the breakdown by re-checking each signal for the top candidate.
    // This mirrors scoreCandidates() so the breakdown always matches the score.
    const breakdown: { point: string; eventId: string }[] = [];
    const fileEvent = chain.events.find((e) => e.type === "FILE" && e.path === top.path);
    const fileEventIndex = fileEvent ? chain.events.indexOf(fileEvent) : -1;
    const failureIndex = chain.failureEvent ? chain.events.indexOf(chain.failureEvent) : (chain.events.length - 1);
    const errorEvent = chain.errorEvent;

    // Signal 1: file changed in window.
    if (fileEventIndex >= 0) {
      breakdown.push({ point: `File changed in window: ${top.path}`, eventId: fileEvent!.id });
    }

    // Signal 2: build/test error output references the candidate path.
    const builds = chain.events.filter(
      (e) => (e.type === "BUILD_TEST" || e.type === "COMMAND") && (e.details as any)?.error?.includes(top.path)
    );
    if (builds.length > 0) {
      breakdown.push({ point: `Build/test output references ${top.path}`, eventId: builds[0]!.id });
    }

    // Signal 3: error event message references the candidate path.
    if (errorEvent && ((errorEvent.details as any)?.message ?? "").includes(top.path)) {
      breakdown.push({ point: `Error references ${top.path}`, eventId: errorEvent.id });
    }

    // Signal 4: file change within 30s of the failure.
    if (fileEventIndex >= 0 && failureIndex >= 0) {
      const delta = Math.abs(
        new Date((chain.events[failureIndex] as any).timestamp).getTime() -
        new Date((chain.events[fileEventIndex] as any).timestamp).getTime()
      );
      if (delta <= 30_000) {
        breakdown.push({ point: `File changed within 30s of failure`, eventId: fileEvent!.id });
      }
    }

    // Build the evidence chain.
    const chainLines: string[] = [];
    if (lastHealthy) {
      chainLines.push(`BUILD PASSED ${lastHealthy.timestamp}`);
    }
    const fileChanges = chain.events.filter((e) => e.type === "FILE" && e.path === top.path);
    for (const fe of fileChanges) {
      chainLines.push(`FILE CHANGED ${fe.path} ${fe.timestamp}`);
    }
    if (chain.failureEvent) {
      chainLines.push(`BUILD FAILED ${chain.failureEvent.timestamp}`);
    }
    if (chain.errorEvent) {
      chainLines.push(`ERROR MATCH ${(chain.errorEvent.details as any)?.message ?? ""}`);
    }
    chainLines.push(`${status} ${top.score}/100`);

    // Try to capture a git diff for the candidate file if available.
    let diff: string | undefined;
    if (top.path) {
      try {
        diff = this.captureGitDiff(chain.events, top.path);
      } catch {
        // git not available; leave diff undefined.
      }
    }

    return {
      score: top.score,
      status,
      breakdown,
      topCandidates: scored.slice(0, 3).map((c) => ({ candidate: c.path, score: c.score })),
      chain: chainLines,
      diff,
      error: (chain.errorEvent?.details as any)?.message,
    };
  }

  private noCandidateSet(events: BlackBoxEvent[]): EvidenceSet {
    const lastHealthy = findLastHealthyEvent(events);
    const failure = findFirstFailureEvent(events, lastHealthy);

    if (!failure) {
      return {
        score: 0,
        status: "NO_CAUSAL_CHANGE_DETECTED",
        breakdown: [],
        topCandidates: [],
        chain: lastHealthy
          ? [`BUILD PASSED ${lastHealthy.timestamp} — now a failure is reported, but no change in the window.`]
          : [`No failure recorded yet.`],
        diff: undefined,
        error: undefined,
        message: "No causal change detected.",
      };
    }

    const lastHealthyMsg = lastHealthy
      ? `BUILD PASSED ${lastHealthy.timestamp}`
      : "No last healthy state.";
    return {
      score: 0,
      status: "NO_CAUSAL_CHANGE_DETECTED",
      breakdown: [],
      topCandidates: [],
      chain: [lastHealthyMsg, "FAILURE REPORTED", `NO_CAUSAL_CHANGE_DETECTED 0/100`],
      diff: undefined,
      error: undefined,
      message: "No causal change detected.",
    };
  }

  /**
   * Attempt to capture a git diff for a specific file.
   * Returns undefined if git is unavailable or the file has no diff.
   */
  private captureGitDiff(events: BlackBoxEvent[], filePath: string): string | undefined {
    try {
      const projectDir = events[0]?.project;
      if (!projectDir) return undefined;
      const quotedPath = JSON.stringify(filePath);
      const diff = execSync(`git diff -- ${quotedPath}`, {
        cwd: projectDir,
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 5000,
      });
      const trimmed = diff.trim();
      return trimmed.length > 0 ? trimmed : undefined;
    } catch {
      return undefined;
    }
  }
}

export const evidenceEngine = new EvidenceEngine();
