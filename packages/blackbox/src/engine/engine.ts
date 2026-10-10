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
import {
  scoreCandidates,
  outcomeFor,
  formatScore,
  POINTS_PER_SIGNAL,
} from "./scoring.js";
import type { Candidate, EvidenceChain } from "./evidence.js";

export interface EvidenceSet {
  score: number;
  status:
    | "LIKELY_ROOT_CAUSE"
    | "NO_CLEAR_ROOT_CAUSE"
    | "NO_CAUSAL_CHANGE_DETECTED";
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
   * The score is based on recorded evidence, not the AI's opinion.
   */
  analyze(events: BlackBoxEvent[]): EvidenceSet {
    const lastHealthy = findLastHealthyEvent(events);
    const failure = findFirstFailureEvent(events, lastHealthy);

    if (!failure) {
      return this.noCandidateSet(events);
    }

    const chain = buildChain(events, lastHealthy, failure);
    const scored = scoreCandidates(chain);

    if (scored.length === 0 || scored[0]?.score === 0) {
      return this.noCandidateSet(events);
    }

    const top = scored[0]!;
    const status = outcomeFor(top.score);

    const breakdown: { point: string; eventId: string }[] = [];
    const fileEvent = chain.events.find(
      (event) => event.type === "FILE" && event.path === top.path
    );
    const fileEventIndex = fileEvent
      ? chain.events.indexOf(fileEvent)
      : -1;
    const failureIndex = chain.failureEvent
      ? chain.events.indexOf(chain.failureEvent)
      : chain.events.length - 1;
    const errorEvent = chain.errorEvent;

    // Signal 1: A file changed in the investigation window.
    if (fileEventIndex >= 0 && fileEvent) {
      breakdown.push({
        point: `File changed in window: ${top.path}`,
        eventId: fileEvent.id,
      });
    }

    // Signal 2: Build/test error output mentions the candidate file.
    const builds = chain.events.filter(
      (event) =>
        (event.type === "BUILD_TEST" || event.type === "COMMAND") &&
        String((event.details as any)?.error ?? "").includes(top.path)
    );

    if (builds.length > 0) {
      breakdown.push({
        point: `Build/test output references ${top.path}`,
        eventId: builds[0]!.id,
      });
    }

    // Signal 3: An error event mentions the candidate file.
    const errorMessage = String(
      (errorEvent?.details as any)?.message ?? ""
    );

    if (errorEvent && errorMessage.includes(top.path)) {
      breakdown.push({
        point: `Error references ${top.path}`,
        eventId: errorEvent.id,
      });
    }

    // Signal 4: The file changed within 30 seconds of the failure.
    if (fileEventIndex >= 0 && fileEvent && failureIndex >= 0) {
      const failureTime = new Date(
        chain.events[failureIndex]!.timestamp
      ).getTime();
      const fileTime = new Date(fileEvent.timestamp).getTime();
      const delta = Math.abs(failureTime - fileTime);

      if (delta <= 30_000) {
        breakdown.push({
          point: "File changed within 30s of failure",
          eventId: fileEvent.id,
        });
      }
    }

    // Build a readable evidence chain.
    const chainLines: string[] = [];

    if (lastHealthy) {
      chainLines.push(`BUILD PASSED ${lastHealthy.timestamp}`);
    }

    const fileChanges = chain.events.filter(
      (event) => event.type === "FILE" && event.path === top.path
    );

    for (const event of fileChanges) {
      chainLines.push(`FILE CHANGED ${event.path} ${event.timestamp}`);
    }

    if (chain.failureEvent) {
      chainLines.push(`BUILD FAILED ${chain.failureEvent.timestamp}`);
    }

    if (errorEvent) {
      chainLines.push(`ERROR MATCH ${errorMessage}`);
    }

    chainLines.push(`${status} ${top.score}/100`);

    // Capture a Git diff if one is available.
    let diff: string | undefined;

    if (top.path) {
      diff = this.captureGitDiff(chain.events, top.path);
    }

    return {
      score: top.score,
      status,
      breakdown,
      topCandidates: scored.slice(0, 3).map((candidate) => ({
        candidate: candidate.path,
        score: candidate.score,
      })),
      chain: chainLines,
      diff,
      error: errorMessage || undefined,
    };
  }

  /**
   * Return a safe result when no causal file change can be established.
   * The observed error is reported separately from the causal conclusion.
   */
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
          ? [
              `BUILD PASSED ${lastHealthy.timestamp} — now a failure is reported, but no change in the window.`,
            ]
          : ["No failure recorded yet."],
        diff: undefined,
        error: undefined,
        message: "No causal change detected.",
      };
    }

    const lastHealthyMsg = lastHealthy
      ? `BUILD PASSED ${lastHealthy.timestamp}`
      : "No last healthy state.";

    const failureDetails = failure.details as {
      error?: string;
      stderr?: string;
      stdout?: string;
      message?: string;
      command?: string;
    };

    // First, use error information attached to the failed event itself.
    let recordedError =
      failureDetails.error ||
      failureDetails.stderr ||
      failureDetails.message ||
      failureDetails.stdout;

    // If the failed event has no error output, look for its related ERROR event.
    if (!recordedError) {
      const failureIndex = events.indexOf(failure);
      const failureCommand = failureDetails.command;

      for (let i = failureIndex + 1; i < events.length; i++) {
        const event = events[i]!;

        // Stop if another build/command result begins a separate result sequence.
        if (
          event.type === "BUILD_TEST" ||
          event.type === "COMMAND"
        ) {
          break;
        }

        if (event.type !== "ERROR") {
          continue;
        }

        if (
          event.project !== failure.project ||
          event.sessionId !== failure.sessionId
        ) {
          continue;
        }

        const errorDetails = event.details as {
          message?: string;
          output?: string;
          command?: string;
        };

        // If both events have a command, they must match.
        if (
          failureCommand &&
          errorDetails.command &&
          failureCommand !== errorDetails.command
        ) {
          continue;
        }

        recordedError =
          errorDetails.message || errorDetails.output;

        if (recordedError) {
          break;
        }
      }
    }

    recordedError = recordedError?.trim() || undefined;

    return {
      score: 0,
      status: "NO_CAUSAL_CHANGE_DETECTED",
      breakdown: [],
      topCandidates: [],
      chain: [
        lastHealthyMsg,
        "FAILURE REPORTED",
        "NO_CAUSAL_CHANGE_DETECTED 0/100",
      ],
      diff: undefined,
      error: recordedError,
      message: recordedError
        ? `Failure recorded, but no causal file change was established. Recorded error: ${recordedError}`
        : "Failure recorded, but no causal change detected.",
    };
  }

  /**
   * Attempt to capture a Git diff for a candidate file.
   */
  private captureGitDiff(
    events: BlackBoxEvent[],
    filePath: string
  ): string | undefined {
    try {
      const projectDir = events[0]?.project;

      if (!projectDir) {
        return undefined;
      }

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