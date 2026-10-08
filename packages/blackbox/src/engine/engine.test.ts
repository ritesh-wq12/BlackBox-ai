import { test } from "node:test";
import { evidenceEngine } from "./engine.js";
import type { BlackBoxEvent } from "../events.js";

let _order = 0;
function mk(
  type: BlackBoxEvent["type"],
  timestamp: string,
  extra: Record<string, unknown> = {},
): BlackBoxEvent {
  return {
    type,
    timestamp,
    summary: "",
    path: "",
    project: "/tmp/p",
    sessionId: "s",
    details: {},
    id: `${type}-${_order++}`,
    order: _order,
    ...extra,
  } as BlackBoxEvent;
}

function makeBuildPassed(ts: string): BlackBoxEvent {
  return mk("BUILD_TEST", ts, {
    summary: "BUILD PASSED",
    path: "npm run build",
    details: { exitCode: 0, command: "npm run build" },
  });
}

function makeBuildFailed(
  ts: string,
  exitCode = 1,
  errorMsg = "",
): BlackBoxEvent {
  return mk("BUILD_TEST", ts, {
    summary: "BUILD FAILED",
    path: "npm run build",
    details: { exitCode, command: "npm run build", error: errorMsg },
  });
}

function makeFileChanged(ts: string, path: string): BlackBoxEvent {
  return mk("FILE", ts, {
    summary: `MODIFIED ${path.split("/").pop()}`,
    path,
    details: { changeType: "modified" },
  });
}

function makeError(ts: string, message: string): BlackBoxEvent {
  return mk("ERROR", ts, {
    summary: `ERROR ${message}`,
    path: "npm run build",
    details: { message, output: message, command: "npm run build" },
  });
}

function assertEq(actual: unknown, expected: unknown, msg: string): void {
  if (actual !== expected) {
    throw new Error(`${msg}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

test("strong evidence: BUILD PASSED -> FILE changed (within 30s) -> BUILD FAILED -> ERROR referencing file yields LIKELY_ROOT_CAUSE", () => {
  const events: BlackBoxEvent[] = [
    makeBuildPassed("2024-01-01T10:30:00.000Z"),
    makeFileChanged("2024-01-01T10:31:00.000Z", "Login.jsx"),
    makeBuildFailed("2024-01-01T10:31:30.000Z", 1, "Error in Login.jsx"),
    makeError("2024-01-01T10:31:31.000Z", "Error in Login.jsx (line 42)"),
  ];

  const result = evidenceEngine.analyze(events);

  if (result.score < 70) throw new Error(`expected score >= 70, got ${result.score}`);
  assertEq(result.status, "LIKELY_ROOT_CAUSE", "status");
  if (result.chain.length === 0) throw new Error("expected non-empty chain");
  if (result.topCandidates.length === 0) throw new Error("expected at least one candidate");
  if ((result.topCandidates[0]?.score ?? 0) <= 0) throw new Error("expected top candidate to have score > 0");
});

test("strong evidence: all 4 signals fire for score 100", () => {
  const events: BlackBoxEvent[] = [
    makeBuildPassed("2024-01-01T10:30:00.000Z"),
    makeFileChanged("2024-01-01T10:31:00.000Z", "Login.jsx"),
    makeBuildFailed("2024-01-01T10:31:30.000Z", 1, "Error in Login.jsx"),
    makeError("2024-01-01T10:31:31.000Z", "Error in Login.jsx (line 42)"),
  ];

  const result = evidenceEngine.analyze(events);

  // All 4 signals should fire: file change + build ref + error ref + temporal
  assertEq(result.score, 100, "expected score 100 with all 4 signals");
  assertEq(result.breakdown.length, 4, "expected 4 breakdown points");
  assertEq(result.status, "LIKELY_ROOT_CAUSE", "status");
});

test("breakdown points sum matches score", () => {
  const events: BlackBoxEvent[] = [
    makeBuildPassed("2024-01-01T10:30:00.000Z"),
    makeFileChanged("2024-01-01T10:31:00.000Z", "Login.jsx"),
    makeBuildFailed("2024-01-01T10:31:30.000Z", 1, "Error in Login.jsx"),
    makeError("2024-01-01T10:31:31.000Z", "Error in Login.jsx (line 42)"),
  ];

  const result = evidenceEngine.analyze(events);

  // Each breakdown point represents +25 points.
  // Score should equal breakdown.length * 25 (capped at 100).
  const expectedScore = Math.min(100, result.breakdown.length * 25);
  assertEq(result.score, expectedScore, "score should equal breakdown points sum");
});

test("breakdown explains the score: no points without evidence", () => {
  // Failure with no file changes: score 0, no breakdown points.
  const events: BlackBoxEvent[] = [
    makeBuildPassed("2024-01-01T10:30:00.000Z"),
    makeBuildFailed("2024-01-01T10:32:00.000Z", 1, "Network timeout"),
  ];

  const result = evidenceEngine.analyze(events);

  assertEq(result.score, 0, "score");
  assertEq(result.breakdown.length, 0, "no breakdown points for no-evidence case");
  assertEq(result.status, "NO_CAUSAL_CHANGE_DETECTED", "status");
  // Verify no candidate is claimed as root cause.
  if (result.topCandidates.length > 0) {
    throw new Error("should not claim candidates without evidence");
  }
});

test("chain contains expected elements for strong evidence", () => {
  const events: BlackBoxEvent[] = [
    makeBuildPassed("2024-01-01T10:30:00.000Z"),
    makeFileChanged("2024-01-01T10:31:00.000Z", "Login.jsx"),
    makeBuildFailed("2024-01-01T10:31:30.000Z", 1, "Error in Login.jsx"),
    makeError("2024-01-01T10:31:31.000Z", "Error in Login.jsx (line 42)"),
  ];

  const result = evidenceEngine.analyze(events);

  const chainText = result.chain.join("\n");
  if (!chainText.includes("BUILD PASSED")) throw new Error("chain should include BUILD PASSED");
  if (!chainText.includes("FILE CHANGED")) throw new Error("chain should include FILE CHANGED");
  if (!chainText.includes("BUILD FAILED")) throw new Error("chain should include BUILD FAILED");
  if (!chainText.includes("ERROR MATCH")) throw new Error("chain should include ERROR MATCH");
  if (!chainText.includes("LIKELY_ROOT_CAUSE")) throw new Error("chain should include outcome");
  if (!chainText.includes("100/100")) throw new Error("chain should include score");
});

test("ambiguous: multiple file changes with no error match yields NO_CLEAR_ROOT_CAUSE", () => {
  const events: BlackBoxEvent[] = [
    makeBuildPassed("2024-01-01T10:30:00.000Z"),
    makeFileChanged("2024-01-01T10:31:00.000Z", "Auth.jsx"),
    makeFileChanged("2024-01-01T10:31:30.000Z", "Styles.css"),
    makeBuildFailed("2024-01-01T10:32:00.000Z", 1, "Unknown module"),
  ];

  const result = evidenceEngine.analyze(events);

  if ((result.score ?? 0) <= 0) throw new Error("expected some score from file changes");
  assertEq(result.status, "NO_CLEAR_ROOT_CAUSE", "status");
  if ((result.topCandidates?.length ?? 0) === 0) throw new Error("expected candidates listed");
  // Should not claim a definitive root cause (score < 70).
  if (result.score >= 70) throw new Error("ambiguous case should not score >= 70");
});

test("no events yields NO_CAUSAL_CHANGE_DETECTED", () => {
  const result = evidenceEngine.analyze([]);

  assertEq(result.score, 0, "score");
  assertEq(result.status, "NO_CAUSAL_CHANGE_DETECTED", "status");
  assertEq(result.breakdown.length, 0, "breakdown length");
  if (result.chain.length === 0) throw new Error("expected non-empty chain with message");
  if (result.chain[0] !== "No failure recorded yet.") throw new Error("expected 'No failure recorded yet.' message");
});

test("only passing builds yields NO_CAUSAL_CHANGE_DETECTED", () => {
  const events: BlackBoxEvent[] = [
    makeBuildPassed("2024-01-01T10:30:00.000Z"),
    makeFileChanged("2024-01-01T10:31:00.000Z", "Login.jsx"),
    makeBuildPassed("2024-01-01T10:32:00.000Z"),
  ];

  const result = evidenceEngine.analyze(events);

  assertEq(result.score, 0, "score");
  assertEq(result.status, "NO_CAUSAL_CHANGE_DETECTED", "status");
});

test("score breakdown includes event IDs for each point", () => {
  const events: BlackBoxEvent[] = [
    makeBuildPassed("2024-01-01T10:30:00.000Z"),
    makeFileChanged("2024-01-01T10:31:00.000Z", "Login.jsx"),
    makeBuildFailed("2024-01-01T10:31:30.000Z", 1, "Error in Login.jsx"),
    makeError("2024-01-01T10:31:31.000Z", "Error in Login.jsx"),
  ];

  const result = evidenceEngine.analyze(events);

  for (const point of result.breakdown) {
    if (!point.eventId) throw new Error("each breakdown point should have an eventId");
  }
});
