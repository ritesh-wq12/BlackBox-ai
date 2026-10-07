import {
  findLastHealthyEvent,
  findFirstFailureEvent,
  // filesInWindow is not used directly in engine.ts; it lives in evidence.ts.
  // kept for completeness.
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

    const breakdown: { point: string; eventId: string }[] = [];
    // Each point is justified by an actual recorded event ID.
    let points = 0;
    const fileEvent = chain.events.find((e) => e.type === "FILE" && e.path === top.path)!;
    if (fileEvent) {
      breakdown.push({ point: `File changed in window: ${top.path}`, eventId: fileEvent.id });
      points += POINTS_PER_SIGNAL;
    }
    if (chain.errorEvent && ((chain.errorEvent.details as any)?.message ?? "").includes(top.path)) {
      breakdown.push({ point: `Error references ${top.path}`, eventId: chain.errorEvent.id });
      points += POINTS_PER_SIGNAL;
    }
    // Add the build-reference signal if present.
    const builds = chain.events.filter(
      (e) => (e.type === "BUILD_TEST" || e.type === "COMMAND") && (e.details as any)?.error?.includes(top.path)
    );
    if (builds.length > 0) {
      breakdown.push({ point: `Build/test referenced ${top.path}`, eventId: builds[0]!.id });
      points += POINTS_PER_SIGNAL;
    }

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

    return {
      score: top.score,
      status,
      breakdown,
      topCandidates: scored.slice(0, 3).map((c) => ({ candidate: c.path, score: c.score })),
      chain: chainLines,
      diff: undefined,
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
}

export const evidenceEngine = new EvidenceEngine();
