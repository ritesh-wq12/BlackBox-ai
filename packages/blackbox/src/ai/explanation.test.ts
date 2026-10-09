import { test } from "node:test";
import assert from "node:assert/strict";
import { ProviderAdapter, createAdapter, validateProviderExplanation, MAX_EXPLANATION_LENGTH } from "./adapter.js";
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

/** A realistic, fully-populated evidence set used across these tests. */
function richSet(): EvidenceSet {
  return makeSet({
    score: 75,
    status: "LIKELY_ROOT_CAUSE",
    breakdown: [
      { point: "File changed in window: src/components/Login.jsx", eventId: "evt-1" },
      { point: "Error references src/components/Login.jsx", eventId: "evt-2" },
    ],
    chain: [
      "BUILD PASSED 2026-10-09T10:30:00.000Z",
      "FILE CHANGED src/components/Login.jsx 2026-10-09T10:31:00.000Z",
      "BUILD FAILED 2026-10-09T10:32:00.000Z",
      "LIKELY_ROOT_CAUSE 75/100",
    ],
    topCandidates: [{ candidate: "src/components/Login.jsx", score: 75 }],
    error: "Error in src/components/Login.jsx",
    diff: "--- a/src/components/Login.jsx\n+++ b/src/components/Login.jsx\n@@ -1 +1 @@\n-old",
  });
}

const VALID_AI_TEXT =
  "The evidence points to src/components/Login.jsx: the file changed right " +
  "before the build failed at 10:32:00. Verify by rebuilding and confirming " +
  "the error still mentions src/components/Login.jsx.";

test("validator rejects AI text containing an invented file", () => {
  const set = richSet();
  assert.equal(
    validateProviderExplanation("The real culprit was src/evil/hacked.ts, clearly.", set),
    false,
    "invented path must be rejected"
  );
  assert.equal(
    validateProviderExplanation("The cause is src/components/Login.jsx.", set),
    true,
    "path that appears in the evidence is accepted"
  );
});

test("validator rejects AI text containing an invented time", () => {
  const set = richSet();
  assert.equal(
    validateProviderExplanation("It broke at 09:41:00 according to our logs.", set),
    false,
    "invented clock time must be rejected"
  );
  assert.equal(
    validateProviderExplanation("It broke at 2026-10-09T11:11:11.000Z for sure.", set),
    false,
    "invented ISO timestamp must be rejected"
  );
  assert.equal(
    validateProviderExplanation("The build failed at 10:32:00.", set),
    true,
    "timestamp that appears in the chain is accepted"
  );
});

test("validator rejects AI text containing a command not in the evidence", () => {
  const set = richSet();
  assert.equal(
    validateProviderExplanation("Simply run npm run lint and it passes.", set),
    false,
    "command absent from the evidence must be rejected"
  );
});

test("validator rejects empty and oversized text", () => {
  const set = richSet();
  assert.equal(validateProviderExplanation("", set), false, "empty rejected");
  assert.equal(validateProviderExplanation("   \n\t  ", set), false, "whitespace rejected");
  assert.equal(
    validateProviderExplanation("word ".repeat(MAX_EXPLANATION_LENGTH), set),
    false,
    "oversized rejected"
  );
  assert.equal(validateProviderExplanation(VALID_AI_TEXT, set), true, "clean text accepted");
});

test("fallback is used when no provider is configured (source deterministic)", async () => {
  const set = richSet();
  const adapter = createAdapter(); // no providerFetch → FallbackAdapter
  assert.ok(adapter.explainDetailed, "adapter exposes explainDetailed");
  const result = await adapter.explainDetailed!(set);
  assert.equal(result.source, "deterministic", "source is deterministic");
  assert.equal(result.fallbackReason, "no-provider", "reason is no-provider");
  assert.equal(result.text, new FallbackAdapter().explain(set), "text is the fallback text");
});

test("fallback is used on timeout (source deterministic)", async () => {
  const set = richSet();
  const adapter = new ProviderAdapter({
    providerFetch: () => new Promise<string>(() => undefined), // never settles
    timeoutMs: 40,
  });
  const result = await adapter.explainDetailed(set);
  assert.equal(result.source, "deterministic");
  assert.equal(result.fallbackReason, "timeout");
  assert.equal(result.text, new FallbackAdapter().explain(set));
});

test("fallback is used on an HTTP error (source deterministic)", async () => {
  const set = richSet();
  const adapter = new ProviderAdapter({
    providerFetch: async () => {
      throw new Error("openai HTTP 500");
    },
  });
  const result = await adapter.explainDetailed(set);
  assert.equal(result.source, "deterministic");
  assert.equal(result.fallbackReason, "http-error");
  assert.equal(result.text, new FallbackAdapter().explain(set));
});

test("fallback is used on a rejected output (source deterministic)", async () => {
  const set = richSet();
  const adapter = new ProviderAdapter({
    // Invented file — validator must reject and fall back.
    providerFetch: async () => "This failure was caused by utils/secrets.ts.",
  });
  const result = await adapter.explainDetailed(set);
  assert.equal(result.source, "deterministic");
  assert.equal(result.fallbackReason, "invalid-output");
  assert.equal(result.text, new FallbackAdapter().explain(set));
});

test("valid provider output is used with source ai", async () => {
  const set = richSet();
  const adapter = new ProviderAdapter({
    providerFetch: async () => VALID_AI_TEXT,
  });
  const result = await adapter.explainDetailed(set);
  assert.equal(result.source, "ai", "source is ai for validated output");
  assert.equal(result.fallbackReason, undefined);
  assert.equal(result.text, VALID_AI_TEXT);
  // explain() still returns just the text.
  assert.equal(await adapter.explain(set), VALID_AI_TEXT);
});

test("score, status and evidence are identical with and without AI", async () => {
  const set = richSet();
  const snapshot = JSON.stringify(set);

  const withoutAi = await new FallbackAdapter().explainDetailed(set);
  const withAi = await new ProviderAdapter({
    providerFetch: async () => VALID_AI_TEXT,
  }).explainDetailed(set);

  // The evidence set is byte-identical after both paths ran.
  assert.equal(JSON.stringify(set), snapshot, "EvidenceSet unchanged by either adapter");
  assert.equal(set.score, 75, "score unchanged");
  assert.equal(set.status, "LIKELY_ROOT_CAUSE", "status unchanged");
  assert.equal(set.breakdown.length, 2, "breakdown unchanged");
  assert.equal(set.chain.length, 4, "chain unchanged");

  // Both explanations were produced from the same deterministic result —
  // neither path can alter what the engine returned.
  assert.notEqual(withAi.text, withoutAi.text, "sources produce different texts");
  assert.equal(withAi.source, "ai");
  assert.equal(withoutAi.source, "deterministic");
});
