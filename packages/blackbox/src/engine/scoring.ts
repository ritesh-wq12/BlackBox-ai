import type { Candidate, EvidenceChain } from "./evidence.js";

/**
 * Deterministic scoring for root-cause candidates.
 *
 * The score is computed purely from recorded events — never from an AI model.
 * Each signal awards a fixed amount of points; the cap is 100.
 *
 *   70–100  → LIKELY_ROOT_CAUSE
 *   1–69    → NO_CLEAR_ROOT_CAUSE  (top 2–3 candidates shown)
 *   0       → NO_CAUSAL_CHANGE_DETECTED
 *
 * Signals (each +25, capped so a single candidate can't max out trivially):
 *   +25  the candidate path appears in the change window
 *   +25  a BUILD_TEST in the window references/conflicts with this path
 *   +25  the ERROR event's message or path matches the candidate
 *   +25  the failure event and the candidate's file change are temporally tight
 */
export const POINTS_PER_SIGNAL = 25;
export const MAX_SCORE = 100;
export const LIKELY_ROOT_CAUSE_MIN = 70;
export const NO_CLEAR_MIN = 1;

export function scoreCandidates(chain: EvidenceChain): Candidate[] {
  const candidates = chain.candidates.map((c) => {
    let score = 0;
    const fileEvent = chain.events.find(
      (e) => e.type === "FILE" && e.path === c.path
    );
    const fileEventIndex = fileEvent ? chain.events.indexOf(fileEvent) : -1;
    const failureIndex = chain.failureEvent ? chain.events.indexOf(chain.failureEvent) : (chain.events.length - 1);
    const errorEvent = chain.errorEvent;
    const errorIndex = errorEvent ? chain.events.indexOf(errorEvent) : -1;

    // Signal 1: file changed in window.
    if (fileEventIndex >= 0) score += POINTS_PER_SIGNAL;

    // Signal 2: build error references the candidate path.
    const allEvents = chain.events;
    const recentBuilds = allEvents.filter(
      (e) => (e.type === "BUILD_TEST" || e.type === "COMMAND") && (e.details as any)?.error?.includes(c.path)
    );
    if (recentBuilds.length > 0) score += POINTS_PER_SIGNAL;

    // Signal 3: error event references the candidate path.
    if (errorEvent && ((errorEvent.details as any)?.message ?? "").includes(c.path)) {
      score += POINTS_PER_SIGNAL;
    }

    // Signal 4: file change within 30s of the failure.
    if (fileEventIndex >= 0 && failureIndex >= 0) {
      const delta = Math.abs(
        new Date((chain.events[failureIndex] as any).timestamp).getTime() -
        new Date((chain.events[fileEventIndex] as any).timestamp).getTime()
      );
      if (delta <= 30_000) score += POINTS_PER_SIGNAL;
    }

    return { ...c, score: Math.min(MAX_SCORE, score) };
  });

  return candidates.sort((a, b) => b.score - a.score);
}

export function outcomeFor(score: number): "LIKELY_ROOT_CAUSE" | "NO_CLEAR_ROOT_CAUSE" | "NO_CAUSAL_CHANGE_DETECTED" {
  if (score >= LIKELY_ROOT_CAUSE_MIN) return "LIKELY_ROOT_CAUSE";
  if (score >= NO_CLEAR_MIN) return "NO_CLEAR_ROOT_CAUSE";
  return "NO_CAUSAL_CHANGE_DETECTED";
}

export function formatScore(score: number): string {
  return `${score}`;
}
