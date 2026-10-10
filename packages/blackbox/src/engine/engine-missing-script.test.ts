import { test } from "node:test";
import assert from "node:assert/strict";
import { evidenceEngine } from "./engine.js";
import { FallbackAdapter } from "../ai/fallback.js";
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

function makeCommandFailed(
  ts: string,
  exitCode = 1,
  stdout = "",
  stderr = "",
  command = "npm run blackbox-demo-fail",
): BlackBoxEvent {
  return mk("COMMAND", ts, {
    summary: `COMMAND ${command}`,
    path: command,
    details: { command, exitCode, stdout, stderr },
  });
}

test("missing-script failure records actual npm stderr as recorded error", () => {
  // Simulate: blackbox run npm run blackbox-demo-fail
  // npm exits non-zero and writes the real error to stderr.
  const events: BlackBoxEvent[] = [
    makeBuildPassed("2024-01-01T10:30:00.000Z"),
    makeCommandFailed(
      "2024-01-01T10:31:00.000Z",
      1,
      "",
      'npm error Missing script: "blackbox-demo-fail"\n',
      "npm run blackbox-demo-fail",
    ),
  ];

  const result = evidenceEngine.analyze(events);

  assert.equal(
    result.score,
    0,
    "no causal change means score stays 0",
  );
  assert.equal(
    result.status,
    "NO_CAUSAL_CHANGE_DETECTED",
    "no causal file change observed",
  );
  assert.equal(
    result.error,
    'npm error Missing script: "blackbox-demo-fail"',
    "the actual recorded stderr is preserved in EvidenceSet.error",
  );
});

test("fallback explanation includes the actual recorded missing-script error", () => {
  const adapter = new FallbackAdapter();

  const evidenceSet = evidenceEngine.analyze([
    makeBuildPassed("2024-01-01T10:30:00.000Z"),
    makeCommandFailed(
      "2024-01-01T10:31:00.000Z",
      1,
      "",
      'npm error Missing script: "blackbox-demo-fail"\n',
      "npm run blackbox-demo-fail",
    ),
  ]);

  const explanation = adapter.explain(evidenceSet);

  assert.ok(
    explanation.includes('npm error Missing script: "blackbox-demo-fail"'),
    "fallback explanation shows the actual recorded npm error",
  );
  assert.ok(
    explanation.includes("ACTUAL RECORDED FAILURE"),
    "fallback labels the observed error clearly",
  );
  assert.ok(
    explanation.includes("no causal change"),
    "fallback preserves the NO_CAUSAL_CHANGE_DETECTED outcome",
  );
  assert.ok(
    explanation.includes("0%"),
    "fallback preserves the 0 score",
  );
});

test("missing-script failure does not invent a file-change root cause", () => {
  const adapter = new FallbackAdapter();

  const evidenceSet = evidenceEngine.analyze([
    makeBuildPassed("2024-01-01T10:30:00.000Z"),
    makeCommandFailed(
      "2024-01-01T10:31:00.000Z",
      1,
      "",
      'npm error Missing script: "blackbox-demo-fail"\n',
      "npm run blackbox-demo-fail",
    ),
  ]);

  // The evidence engine must not claim a file change caused this.
  assert.equal(evidenceSet.score, 0, "score is 0");
  assert.equal(
    evidenceSet.status,
    "NO_CAUSAL_CHANGE_DETECTED",
    "status is no causal change",
  );
  assert.equal(
    evidenceSet.topCandidates.length,
    0,
    "no candidate is invented",
  );

  const explanation = adapter.explain(evidenceSet);
  assert.doesNotThrow(
    () => {
      if (explanation.includes("root cause:") && explanation.includes("Login.jsx")) {
        throw new Error("should not invent Login.jsx as root cause");
      }
    },
    "explanation does not invent a file-change root cause",
  );
});

test("recorded error reaches EvidenceSet.error even when no ERROR event exists", () => {
  // The failed COMMAND event carries its own stderr. The engine should use it
  // directly and not require a separate ERROR event.
  const events: BlackBoxEvent[] = [
    makeBuildPassed("2024-01-01T10:30:00.000Z"),
    makeCommandFailed(
      "2024-01-01T10:31:00.000Z",
      1,
      "",
      "Command failed with exit code 1",
      "node -e process.exit(1)",
    ),
  ];

  const result = evidenceEngine.analyze(events);

  assert.equal(
    result.error,
    "Command failed with exit code 1",
    "stderr from the failed command becomes EvidenceSet.error",
  );
  assert.equal(result.score, 0, "no causal change");
  assert.equal(
    result.status,
    "NO_CAUSAL_CHANGE_DETECTED",
    "no causal change",
  );
});

test("no recorded error does not produce invented error text", () => {
  const adapter = new FallbackAdapter();

  const evidenceSet = {
    score: 0,
    status: "NO_CAUSAL_CHANGE_DETECTED",
    breakdown: [],
    topCandidates: [],
    chain: ["No failure recorded yet."],
    error: undefined as unknown as string | undefined,
  };

  const explanation = adapter.explain(evidenceSet as any);

  assert.doesNotThrow(
    () => {
      if (explanation.includes("ACTUAL RECORDED FAILURE")) {
        throw new Error("should not print ACTUAL RECORDED FAILURE without an error");
      }
    },
    "no error section when error is absent",
  );
  assert.doesNotThrow(
    () => {
      if (
        explanation.includes("TypeError") ||
        explanation.includes("ReferenceError") ||
        explanation.includes("Cannot read")
      ) {
        throw new Error("should not invent error text");
      }
    },
    "no invented error text",
  );
});
