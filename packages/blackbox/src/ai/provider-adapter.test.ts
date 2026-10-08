import { test } from "node:test";
import assert from "node:assert/strict";
import { ProviderAdapter, createAdapter } from "./adapter.js";
import { FallbackAdapter } from "./fallback.js";
import type { AiProviderConfig } from "./base.js";
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

// Helper: create a provider fetch that succeeds with a given explanation.
function succeedFetch(explanation: string): (set: EvidenceSet) => Promise<string> {
  return async () => explanation;
}

// Helper: create a provider fetch that fails with an error.
function failFetch(errorMessage: string): (set: EvidenceSet) => Promise<string> {
  return async () => {
    throw new Error(errorMessage);
  };
}

// Helper: create a provider fetch that resolves with the given delay (for timeout testing).
function delayFetch(delayMs: number, explanation: string): (set: EvidenceSet) => Promise<string> {
  return async () => {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    return explanation;
  };
}

function assertDoesNotContain(haystack: string, needles: string[]): void {
  for (const needle of needles) {
    if (haystack.includes(needle)) {
      throw new Error(`Explanation should not mention "${needle}" but contains it`);
    }
  }
}

test("ProviderAdapter: provider success returns provider explanation", async () => {
  const config: AiProviderConfig = {
    provider: "test-provider",
    providerFetch: succeedFetch("This is the AI provider's explanation for the evidence."),
  };
  const adapter = new ProviderAdapter(config);

  const evidenceSet = makeSet({
    score: 100,
    status: "LIKELY_ROOT_CAUSE",
    breakdown: [{ point: "File changed", eventId: "evt-1" }],
    chain: ["BUILD PASSED", "FILE CHANGED Login.jsx", "BUILD FAILED", "LIKELY_ROOT_CAUSE 100/100"],
    topCandidates: [{ candidate: "Login.jsx", score: 100 }],
  });

  const explanation = await adapter.explain(evidenceSet);

  assert.ok(typeof explanation === "string", "explanation is a string");
  assert.strictEqual(explanation, "This is the AI provider's explanation for the evidence.");
  // The deterministic evidence set is unchanged.
  assert.strictEqual(evidenceSet.score, 100, "original score unchanged");
  assert.strictEqual(evidenceSet.status, "LIKELY_ROOT_CAUSE", "original status unchanged");
});

test("ProviderAdapter: provider failure → fallback to deterministic explanation", async () => {
  const config: AiProviderConfig = {
    provider: "failing-provider",
    providerFetch: failFetch("Network error: provider unreachable"),
  };
  const adapter = new ProviderAdapter(config);

  const evidenceSet = makeSet({
    score: 94,
    status: "LIKELY_ROOT_CAUSE",
    breakdown: [{ point: "File changed in window: Login.jsx", eventId: "evt-1" }],
    chain: ["BUILD PASSED", "FILE CHANGED Login.jsx", "BUILD FAILED", "LIKELY_ROOT_CAUSE 94/100"],
    topCandidates: [{ candidate: "Login.jsx", score: 94 }],
    error: "Error in Login.jsx",
  });

  const explanation = await adapter.explain(evidenceSet);

  // Should fall back to deterministic explanation.
  assert.ok(explanation.includes("likely root cause"), "fallback identifies likely root cause");
  assert.ok(explanation.includes("94%"), "fallback includes correct score");
  assert.ok(explanation.includes("Login.jsx"), "fallback mentions candidate from evidence");
  assert.ok(explanation.includes("Error in Login.jsx"), "fallback includes error from evidence");
  assert.ok(
    explanation.includes("This explanation narrates the recorded evidence"),
    "fallback includes disclaimer"
  );
});

test("ProviderAdapter: provider timeout → fallback to deterministic explanation", async () => {
  const config: AiProviderConfig = {
    provider: "slow-provider",
    providerFetch: delayFetch(5000, "This should not be returned"),
    timeoutMs: 50, // Very short timeout to trigger fallback.
  };
  const adapter = new ProviderAdapter(config);

  const evidenceSet = makeSet({
    score: 25,
    status: "NO_CLEAR_ROOT_CAUSE",
    breakdown: [{ point: "File changed", eventId: "evt-1" }],
    chain: ["BUILD PASSED", "FILE CHANGED Auth.jsx", "BUILD FAILED", "NO_CLEAR_ROOT_CAUSE 25/100"],
    topCandidates: [{ candidate: "Auth.jsx", score: 25 }],
  });

  const explanation = await adapter.explain(evidenceSet);

  // Should fall back to deterministic explanation due to timeout.
  assert.ok(explanation.includes("could not identify a clear root cause"), "fallback identifies uncertainty");
  assert.ok(explanation.includes("25%"), "fallback includes correct score");
  assert.ok(explanation.includes("Auth.jsx"), "fallback mentions observed changes");
});

test("ProviderAdapter: empty/invalid provider response → fallback", async () => {
  const config: AiProviderConfig = {
    provider: "empty-provider",
    providerFetch: async () => "",
  };
  const adapter = new ProviderAdapter(config);

  const evidenceSet = makeSet({
    score: 100,
    status: "LIKELY_ROOT_CAUSE",
    breakdown: [{ point: "File changed", eventId: "evt-1" }],
    chain: ["BUILD PASSED", "FILE CHANGED Login.jsx", "BUILD FAILED", "LIKELY_ROOT_CAUSE 100/100"],
    topCandidates: [{ candidate: "Login.jsx", score: 100 }],
  });

  const explanation = await adapter.explain(evidenceSet);

  // Should fall back to deterministic explanation.
  assert.ok(explanation.includes("likely root cause"), "fallback identifies outcome");
  assert.ok(explanation.includes("100%"), "fallback includes correct score");
});

test("ProviderAdapter: missing providerFetch → fallback (no provider configured)", async () => {
  const config: AiProviderConfig = {
    provider: "some-provider",
    // No providerFetch — should use fallback.
  };
  const adapter = new ProviderAdapter(config);

  const evidenceSet = makeSet({
    score: 0,
    status: "NO_CAUSAL_CHANGE_DETECTED",
    breakdown: [],
    chain: ["No failure recorded yet."],
    topCandidates: [],
  });

  const explanation = await adapter.explain(evidenceSet);

  // Should fall back to deterministic explanation.
  assert.ok(explanation.includes("no causal change"), "fallback identifies no causal change");
  assert.ok(explanation.includes("0%"), "fallback includes zero score");
  assert.ok(explanation.includes("No failure recorded yet."), "fallback includes chain");
});

test("createAdapter: no config → FallbackAdapter", () => {
  const adapter = createAdapter();
  assert.ok(adapter instanceof FallbackAdapter, "returns FallbackAdapter when no provider configured");
});

test("createAdapter: with providerFetch → ProviderAdapter", () => {
  const config: AiProviderConfig = {
    providerFetch: succeedFetch("AI explanation"),
  };
  const adapter = createAdapter(config);
  assert.ok(adapter instanceof ProviderAdapter, "returns ProviderAdapter when providerFetch configured");
});

test("AI adapter never modifies the deterministic score or outcome", async () => {
  const config: AiProviderConfig = {
    providerFetch: succeedFetch("The AI provides this narrative explanation for the recorded evidence."),
  };
  const adapter = new ProviderAdapter(config);

  const evidenceSet = makeSet({
    score: 75,
    status: "LIKELY_ROOT_CAUSE",
    breakdown: [
      { point: "File changed in window: src/components/Login.jsx", eventId: "evt-1" },
      { point: "Error references src/components/Login.jsx", eventId: "evt-2" },
    ],
    chain: [
      "BUILD PASSED 10:30",
      "FILE CHANGED src/components/Login.jsx 10:31",
      "BUILD FAILED 10:32",
      "ERROR MATCH Cannot read properties of undefined (reading 'map')",
      "LIKELY_ROOT_CAUSE 75/100",
    ],
    topCandidates: [{ candidate: "src/components/Login.jsx", score: 75 }],
    error: "Cannot read properties of undefined (reading 'map')",
    diff: "diff --git a/src/components/Login.jsx b/src/components/Login.jsx",
  });

  const explanation = await adapter.explain(evidenceSet);

  // The evidence set must be completely unchanged.
  assert.strictEqual(evidenceSet.score, 75, "score unchanged");
  assert.strictEqual(evidenceSet.status, "LIKELY_ROOT_CAUSE", "status unchanged");
  assert.strictEqual(evidenceSet.breakdown.length, 2, "breakdown unchanged");
  assert.strictEqual(evidenceSet.topCandidates[0]?.candidate, "src/components/Login.jsx", "candidate unchanged");
  assert.strictEqual(evidenceSet.chain.length, 5, "chain unchanged");
  assert.strictEqual(evidenceSet.error, "Cannot read properties of undefined (reading 'map')", "error unchanged");
  assert.strictEqual(evidenceSet.diff, "diff --git a/src/components/Login.jsx b/src/components/Login.jsx", "diff unchanged");

  // The provider explanation must not invent files/errors not in evidence.
  assertDoesNotContain(explanation, ["UserProfile.jsx", "Dashboard.tsx", "api.ts", "utils.js"]);
  assertDoesNotContain(explanation, ["TypeError", "ReferenceError", "Network timeout", "OutOfMemory"]);
});

test("AI adapter: provider explanation does not override deterministic outcome", async () => {
  // Provider tries to claim a different outcome — but the deterministic score is still authoritative.
  const config: AiProviderConfig = {
    providerFetch: succeedFetch("The evidence suggests NO_CLEAR_ROOT_CAUSE with 10% confidence."),
  };
  const adapter = new ProviderAdapter(config);

  const evidenceSet = makeSet({
    score: 100,
    status: "LIKELY_ROOT_CAUSE",
    breakdown: [{ point: "File changed", eventId: "evt-1" }],
    chain: ["BUILD PASSED", "FILE CHANGED Login.jsx", "BUILD FAILED", "LIKELY_ROOT_CAUSE 100/100"],
    topCandidates: [{ candidate: "Login.jsx", score: 100 }],
  });

  const explanation = await adapter.explain(evidenceSet);

  // The evidence set is unchanged — the provider's claim of NO_CLEAR_ROOT_CAUSE is ignored.
  assert.strictEqual(evidenceSet.score, 100, "deterministic score is authoritative");
  assert.strictEqual(evidenceSet.status, "LIKELY_ROOT_CAUSE", "deterministic outcome is authoritative");
  // The provider's explanation is still returned (it's just a narrative), but it doesn't change the evidence.
  assert.strictEqual(explanation, "The evidence suggests NO_CLEAR_ROOT_CAUSE with 10% confidence.");
});

test("FallbackAdapter (deterministic) still works without any provider", () => {
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

  assert.ok(explanation.includes("likely root cause"), "identifies likely root cause");
  assert.ok(explanation.includes("100%"), "includes confidence score");
  assert.ok(explanation.includes("Login.jsx"), "mentions candidate file");
  assert.ok(explanation.includes("Error in Login.jsx"), "includes error from evidence");
  assert.ok(
    explanation.includes("This explanation narrates the recorded evidence"),
    "includes disclaimer"
  );
});
