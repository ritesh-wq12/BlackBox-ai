import { test } from "node:test";
import assert from "node:assert/strict";
import { FallbackAdapter } from "./fallback.js";
import type { EvidenceSet } from "../engine/index.js";

function makeSet(overrides: Partial<EvidenceSet> = {}): EvidenceSet {
  return {
    score: 0,
    status: "NO_CAUSAL_CHANGE_DETECTED",
    breakdown: [],
    topCandidates: [],
    chain: [],
    ...overrides,
  };
}

function assertDoesNotContain(haystack: string, needles: string[]): void {
  for (const needle of needles) {
    if (haystack.includes(needle)) {
      throw new Error(`Explanation should not mention "${needle}" but contains it`);
    }
  }
}

test("FallbackAdapter does not modify the deterministic score", () => {
  const adapter = new FallbackAdapter();

  const evidenceSet = makeSet({
    score: 100,
    status: "LIKELY_ROOT_CAUSE",
    breakdown: [{ point: "File changed", eventId: "evt-1" }],
    chain: ["BUILD PASSED", "FILE CHANGED Login.jsx", "BUILD FAILED", "LIKELY_ROOT_CAUSE 100/100"],
    topCandidates: [{ candidate: "Login.jsx", score: 100 }],
  });

  const explanation = adapter.explain(evidenceSet);

  // The adapter must not change the score it received.
  assert.strictEqual(evidenceSet.score, 100, "original score unchanged");
  assert.strictEqual(evidenceSet.status, "LIKELY_ROOT_CAUSE", "original status unchanged");
  assert.strictEqual(evidenceSet.breakdown.length, 1, "original breakdown unchanged");
  assert.strictEqual(evidenceSet.topCandidates[0]?.candidate, "Login.jsx", "original candidate unchanged");
});

test("FallbackAdapter works without API key (no credentials required)", () => {
  // Default constructor uses no config — no API key needed.
  const adapter = new FallbackAdapter();

  const evidenceSet = makeSet({
    score: 100,
    status: "LIKELY_ROOT_CAUSE",
    breakdown: [{ point: "File changed in window: Login.jsx", eventId: "evt-1" }],
    chain: ["BUILD PASSED 10:30", "FILE CHANGED Login.jsx 10:31", "BUILD FAILED 10:32", "LIKELY_ROOT_CAUSE 100/100"],
    topCandidates: [{ candidate: "Login.jsx", score: 100 }],
    error: "Error in Login.jsx",
  });

  const explanation = adapter.explain(evidenceSet);

  assert.ok(typeof explanation === "string", "explanation is a string");
  assert.ok(explanation.length > 0, "explanation is non-empty");
  assert.ok(
    explanation.includes("Confidence: 100%"),
    "explanation includes the confidence score"
  );
  assert.ok(
    explanation.includes("Login.jsx"),
    "explanation includes the candidate file from evidence"
  );
});

test("FallbackAdapter produces LIKELY_ROOT_CAUSE explanation", () => {
  const adapter = new FallbackAdapter();

  const evidenceSet = makeSet({
    score: 94,
    status: "LIKELY_ROOT_CAUSE",
    breakdown: [
      { point: "File changed in window: Login.jsx", eventId: "evt-1" },
      { point: "Error references Login.jsx", eventId: "evt-2" },
    ],
    chain: [
      "BUILD PASSED 2024-01-01T10:30:00.000Z",
      "FILE CHANGED Login.jsx 2024-01-01T10:31:00.000Z",
      "BUILD FAILED 2024-01-01T10:32:00.000Z",
      "ERROR MATCH Error in Login.jsx (line 42)",
      "LIKELY_ROOT_CAUSE 94/100",
    ],
    topCandidates: [
      { candidate: "Login.jsx", score: 94 },
      { candidate: "Auth.jsx", score: 25 },
    ],
    error: "Error in Login.jsx (line 42)",
  });

  const explanation = adapter.explain(evidenceSet);

  assert.ok(explanation.includes("likely root cause"), "identifies likely root cause");
  assert.ok(explanation.includes("94%"), "includes confidence score");
  assert.ok(explanation.includes("Login.jsx"), "mentions candidate file");
  assert.ok(explanation.includes("Auth.jsx"), "mentions alternative candidates");
  assert.ok(explanation.includes("Error in Login.jsx (line 42)"), "includes error from evidence");
  assert.ok(
    explanation.includes("Evidence chain"),
    "includes evidence chain section"
  );
  assert.ok(
    explanation.includes("This explanation narrates the recorded evidence"),
    "includes disclaimer that AI does not determine the score"
  );
});

test("FallbackAdapter produces NO_CLEAR_ROOT_CAUSE explanation", () => {
  const adapter = new FallbackAdapter();

  const evidenceSet = makeSet({
    score: 25,
    status: "NO_CLEAR_ROOT_CAUSE",
    breakdown: [{ point: "File changed in window: Auth.jsx", eventId: "evt-1" }],
    chain: [
      "BUILD PASSED 2024-01-01T10:30:00.000Z",
      "FILE CHANGED Auth.jsx 2024-01-01T10:31:00.000Z",
      "BUILD FAILED 2024-01-01T10:32:00.000Z",
      "NO_CLEAR_ROOT_CAUSE 25/100",
    ],
    topCandidates: [
      { candidate: "Auth.jsx", score: 25 },
      { candidate: "Styles.css", score: 25 },
    ],
  });

  const explanation = adapter.explain(evidenceSet);

  assert.ok(explanation.includes("could not identify a clear root cause"), "identifies uncertainty");
  assert.ok(explanation.includes("25%"), "includes low confidence score");
  assert.ok(explanation.includes("Auth.jsx"), "mentions observed changes");
  assert.ok(explanation.includes("Styles.css"), "mentions alternative candidates");
  assert.ok(
    explanation.includes("external dependency") || explanation.includes("environment"),
    "mentions possible external causes for ambiguity"
  );
});

test("FallbackAdapter produces NO_CAUSAL_CHANGE_DETECTED explanation", () => {
  const adapter = new FallbackAdapter();

  const evidenceSet = makeSet({
    score: 0,
    status: "NO_CAUSAL_CHANGE_DETECTED",
    breakdown: [],
    chain: [
      "No failure recorded yet.",
    ],
    topCandidates: [],
  });

  const explanation = adapter.explain(evidenceSet);

  assert.ok(explanation.includes("no causal change"), "identifies no causal change");
  assert.ok(explanation.includes("0%"), "includes zero confidence score");
  assert.ok(explanation.includes("No failure recorded yet."), "includes chain from evidence");
  assert.ok(
    explanation.includes("external dependency") || explanation.includes("environment"),
    "mentions possible external causes"
  );
});

test("FallbackAdapter does not invent files not in evidence", () => {
  const adapter = new FallbackAdapter();

  const evidenceSet = makeSet({
    score: 100,
    status: "LIKELY_ROOT_CAUSE",
    breakdown: [{ point: "File changed in window: Login.jsx", eventId: "evt-1" }],
    chain: ["BUILD PASSED", "FILE CHANGED Login.jsx", "BUILD FAILED", "LIKELY_ROOT_CAUSE 100/100"],
    topCandidates: [{ candidate: "Login.jsx", score: 100 }],
    error: "Error in Login.jsx",
  });

  const explanation = adapter.explain(evidenceSet);

  // These files were NOT in the evidence — the adapter must not mention them.
  assertDoesNotContain(explanation, ["UserProfile.jsx", "Dashboard.tsx", "api.ts", "utils.js"]);
});

test("FallbackAdapter does not invent errors not in evidence", () => {
  const adapter = new FallbackAdapter();

  const evidenceSet = makeSet({
    score: 100,
    status: "LIKELY_ROOT_CAUSE",
    breakdown: [{ point: "File changed in window: Login.jsx", eventId: "evt-1" }],
    chain: ["BUILD PASSED", "FILE CHANGED Login.jsx", "BUILD FAILED", "LIKELY_ROOT_CAUSE 100/100"],
    topCandidates: [{ candidate: "Login.jsx", score: 100 }],
    // No error field — adapter must not invent one.
  });

  const explanation = adapter.explain(evidenceSet);

  assertDoesNotContain(explanation, ["TypeError", "ReferenceError", "Cannot read", "undefined is not"]);
});

test("FallbackAdapter does not invent timestamps not in evidence", () => {
  const adapter = new FallbackAdapter();

  const evidenceSet = makeSet({
    score: 100,
    status: "LIKELY_ROOT_CAUSE",
    breakdown: [{ point: "File changed in window: Login.jsx", eventId: "evt-1" }],
    chain: ["BUILD PASSED", "FILE CHANGED Login.jsx", "BUILD FAILED", "LIKELY_ROOT_CAUSE 100/100"],
    topCandidates: [{ candidate: "Login.jsx", score: 100 }],
  });

  const explanation = adapter.explain(evidenceSet);

  // The chain has no timestamps — the adapter must not invent specific times.
  assertDoesNotContain(explanation, ["10:30:00", "10:31:00", "10:32:00", "2024-01-01T10"]);
});

test("FallbackAdapter evidence is passed through from EvidenceSet", () => {
  const adapter = new FallbackAdapter();

  const expectedError = "Cannot read properties of undefined (reading 'map')";
  const expectedCandidate = "src/components/Login.jsx";
  const expectedBreakdownPoint = "Build/test output references src/components/Login.jsx";

  const evidenceSet = makeSet({
    score: 75,
    status: "LIKELY_ROOT_CAUSE",
    breakdown: [
      { point: "File changed in window: src/components/Login.jsx", eventId: "evt-1" },
      { point: expectedBreakdownPoint, eventId: "evt-2" },
    ],
    chain: [
      "BUILD PASSED 10:30",
      "FILE CHANGED src/components/Login.jsx 10:31",
      "BUILD FAILED 10:32",
      "ERROR MATCH Cannot read properties of undefined (reading 'map')",
      "LIKELY_ROOT_CAUSE 75/100",
    ],
    topCandidates: [{ candidate: expectedCandidate, score: 75 }],
    error: expectedError,
    diff: "diff --git a/src/components/Login.jsx b/src/components/Login.jsx",
  });

  const explanation = adapter.explain(evidenceSet);

  assert.ok(explanation.includes(expectedError), "passes through error from EvidenceSet");
  assert.ok(explanation.includes(expectedCandidate), "passes through candidate from EvidenceSet");
  assert.ok(
    explanation.includes(expectedBreakdownPoint) || explanation.includes("Build/test output references"),
    "passes through breakdown points from EvidenceSet"
  );
  assert.ok(explanation.includes("diff --git"), "passes through git diff from EvidenceSet");
});

test("FallbackAdapter with empty breakdown still explains the outcome", () => {
  const adapter = new FallbackAdapter();

  const evidenceSet = makeSet({
    score: 100,
    status: "LIKELY_ROOT_CAUSE",
    breakdown: [],
    chain: ["BUILD PASSED", "FILE CHANGED Login.jsx", "BUILD FAILED", "LIKELY_ROOT_CAUSE 100/100"],
    topCandidates: [{ candidate: "Login.jsx", score: 100 }],
  });

  const explanation = adapter.explain(evidenceSet);

  assert.ok(explanation.includes("likely root cause"), "still identifies outcome");
  assert.ok(explanation.includes("Login.jsx"), "still uses candidate from topCandidates");
});

test("FallbackAdapter respects config but works without it", () => {
  // Adapter with explicit empty config — still works.
  const adapter = new FallbackAdapter({});

  const evidenceSet = makeSet({
    score: 50,
    status: "NO_CLEAR_ROOT_CAUSE",
    breakdown: [{ point: "File changed: Auth.jsx", eventId: "evt-1" }],
    chain: ["BUILD PASSED", "FILE CHANGED Auth.jsx", "BUILD FAILED", "NO_CLEAR_ROOT_CAUSE 50/100"],
    topCandidates: [{ candidate: "Auth.jsx", score: 50 }],
  });

  const explanation = adapter.explain(evidenceSet);

  assert.ok(explanation.includes("could not identify a clear root cause"), "correct outcome");
  assert.ok(explanation.includes("50%"), "correct score");
});
