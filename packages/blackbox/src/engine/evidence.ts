
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
  if (event.type === "BUILD_TEST" || event.type === "COMMAND") {
    return (event as any).details?.exitCode ?? null;
  }

  return null;
}

/** Find the most recent passing build or command. */
export function findLastHealthyEvent(
  events: BlackBoxEvent[]
): BlackBoxEvent | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i]!;
    const code = getBuildExitCode(event);

    if (code === 0) {
      return event;
    }
  }

  return null;
}

/** Find the first failed build or command after the last healthy event. */
export function findFirstFailureEvent(
  events: BlackBoxEvent[],
  lastHealthy: BlackBoxEvent | null
): BlackBoxEvent | null {
  const startIndex = lastHealthy
    ? events.indexOf(lastHealthy) + 1
    : 0;

  for (let i = startIndex; i < events.length; i++) {
    const event = events[i]!;
    const code = getBuildExitCode(event);

    if (code !== null && code !== 0) {
      return event;
    }
  }

  return null;
}

/** Find distinct file paths changed between two events. */
export function filesInWindow(
  events: BlackBoxEvent[],
  from: BlackBoxEvent,
  to: BlackBoxEvent
): string[] {
  const paths = new Set<string>();
  const startIndex = events.indexOf(from) + 1;
  const endIndex = events.indexOf(to);

  for (let i = startIndex; i < endIndex; i++) {
    const event = events[i]!;

    if (event.type === "FILE" && event.path) {
      paths.add(event.path);
    }
  }

  return Array.from(paths);
}

/**
 * Find the ERROR event associated with a specific failed command.
 * Matching uses event order, project, session, and command when available.
 */
export function findErrorEvent(
  events: BlackBoxEvent[],
  failure?: BlackBoxEvent | null
): BlackBoxEvent | null {
  if (!failure) {
    return null;
  }

  const failureIndex = events.indexOf(failure);

  if (failureIndex < 0) {
    return null;
  }

  const failureCommand = (failure.details as any)?.command;

  // The CLI records the failed command, followed by its ERROR event.
  for (let i = failureIndex + 1; i < events.length; i++) {
    const event = events[i]!;

    // Do not associate an error with a different command result.
    if (isBuildEvent(event)) {
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

    if (
      failureCommand &&
      errorDetails.command &&
      failureCommand !== errorDetails.command
    ) {
      continue;
    }

    if (errorDetails.message || errorDetails.output) {
      return event;
    }
  }

  return null;
}

/** Build the evidence chain for the selected failure. */
export function buildChain(
  events: BlackBoxEvent[],
  lastHealthy: BlackBoxEvent | null,
  failure: BlackBoxEvent | null
): EvidenceChain {
  const startIndex = lastHealthy
    ? events.indexOf(lastHealthy) + 1
    : 0;

  const endIndex = failure
    ? events.indexOf(failure)
    : events.length;

  const windowEvents = events.slice(startIndex, endIndex);
  const candidates: Candidate[] = [];
  const seenPaths = new Set<string>();

  for (const event of windowEvents) {
    if (
      event.type === "FILE" &&
      event.path &&
      !seenPaths.has(event.path)
    ) {
      seenPaths.add(event.path);

      candidates.push({
        id: event.id,
        path: event.path,
        summary: event.summary,
        score: 0,
      });
    }
  }

  return {
    events,
    candidates,
    errorEvent: findErrorEvent(events, failure),
    lastHealthyBuildEvent: lastHealthy,
    failureEvent: failure,
  };
}

export type { BlackBoxEvent } from "../events.js";