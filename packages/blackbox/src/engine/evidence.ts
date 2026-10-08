import type { EventType } from "../storage/index.js";
import type { BlackBoxEvent } from "../events.js";

export interface Candidate {
  id: string;
  path: string;
  summary: string;
  score: number;
}

export interface EvidenceChain {
  events: BlackBoxEvent[];
  candidates: Candidate[];
  errorEvent: BlackBoxEvent | null;
  lastHealthyBuildEvent: BlackBoxEvent | null;
  failureEvent: BlackBoxEvent | null;
}





export function isBuildEvent(event: BlackBoxEvent): boolean {
  return event.type === "BUILD_TEST" || event.type === "COMMAND";
}

export function getBuildExitCode(event: BlackBoxEvent): number | null {
  if (event.type === "BUILD_TEST") {
    return (event as any).details?.exitCode ?? null;
  }
  if (event.type === "COMMAND") {
    return (event as any).details?.exitCode ?? null;
  }
  return null;
}

/** Find the most recent passing build (BUILD_TEST or COMMAND with exit 0) — the last healthy state. */
export function findLastHealthyEvent(events: BlackBoxEvent[]): BlackBoxEvent | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!;
    const code = e.type === "BUILD_TEST" || e.type === "COMMAND"
      ? (e as any).details?.exitCode ?? null
      : null;
    if (code === 0) {
      return e;
    }
  }
  return null;
}

/** Find the first BUILD_TEST/COMMAND after the last healthy event with a non-zero exit. */
export function findFirstFailureEvent(
  events: BlackBoxEvent[],
  lastHealthy: BlackBoxEvent | null
): BlackBoxEvent | null {
  const startIndex = lastHealthy ? events.indexOf(lastHealthy) + 1 : 0;
  for (let i = startIndex; i < events.length; i++) {
    const e = events[i]!;
    const code = getBuildExitCode(e);
    if (code !== null && code !== 0) {
      return e;
    }
  }
  return null;
}

/** Distinct file paths changed between two events (files that appear in the window). */
export function filesInWindow(events: BlackBoxEvent[], from: BlackBoxEvent, to: BlackBoxEvent): string[] {
  const set = new Set<string>();    for (let i = events.indexOf(from) + 1; i < events.indexOf(to); i++) {
    const e = events[i]!;
    if (e.type === "FILE" && e.path) set.add(e.path);
  }
  return Array.from(set);
}

export function findErrorEvent(events: BlackBoxEvent[]): BlackBoxEvent | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!;
    if (e.type === "ERROR" && e.details?.message) {
      return e;
    }
  }
  return null;
}

export function buildChain(
  events: BlackBoxEvent[],
  lastHealthy: BlackBoxEvent | null,
  failure: BlackBoxEvent | null
): EvidenceChain {
  const startIndex = lastHealthy ? events.indexOf(lastHealthy) + 1 : 0;
  const end = failure ? events.indexOf(failure) : events.length;
  const windowEvents = events.slice(startIndex, end);
  const candidates: Candidate[] = [];
  const set = new Set<string>();
  for (const e of windowEvents) {
    if (e.type === "FILE" && e.path && !set.has(e.path)) {
      set.add(e.path);
      candidates.push({ id: e.id, path: e.path, summary: e.summary, score: 0 });
    }
  }

  return {
    events,
    candidates,
    errorEvent: findErrorEvent(events),
    lastHealthyBuildEvent: lastHealthy,
    failureEvent: failure,
  };
}

export type { BlackBoxEvent } from "../events.js";
