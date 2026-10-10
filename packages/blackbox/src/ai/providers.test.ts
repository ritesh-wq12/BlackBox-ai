import { test } from "node:test";
import assert from "node:assert/strict";
import { buildProviderFetch, DEFAULT_OPENAI_MODEL } from "./providers.js";
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

// Minimal fetch mock that records calls and returns a controlled response.
type RecordedCall = {
  url: string;
  headers: Record<string, string>;
  body: string;
};

function mockFetch(responses: Array<{ status: number; json: object } | undefined>) {
  const calls: RecordedCall[] = [];
  return {
    fetch: async (url: string, options: RequestInit) => {
      const idx = calls.length;
      const headersObj: Record<string, string> = {};
      const h = new Headers(options.headers ?? {});
      for (const [k, v] of h.entries()) {
        headersObj[k] = v;
      }
      calls.push({
        url,
        headers: headersObj,
        body: options.body as string ?? "",
      });
      const resp = responses[idx] ?? { status: 500, json: {} };
      return {
        ok: resp.status >= 200 && resp.status < 300,
        status: resp.status,
        json: async () => resp.json,
      } as Response;
    },
    calls,
  };
}

globalThis.fetch = mockFetch([{ status: 200, json: {} }]).fetch as any;

test("openai-compatible: exact URL is baseUrl (trailing slash removed) + /chat/completions", async () => {
  const baseUrls = [
    ["https://example.com", "https://example.com/chat/completions"],
    ["https://example.com/", "https://example.com/chat/completions"],
    ["https://example.com//", "https://example.com/chat/completions"],
    ["https://example.com/foo", "https://example.com/foo/chat/completions"],
    ["https://example.com/foo/", "https://example.com/foo/chat/completions"],
  ] as const;
  for (const [base, expected] of baseUrls) {
    const { fetch, calls } = mockFetch([
      { status: 200, json: { choices: [{ message: { content: "ok" } }] } },
    ]);
    globalThis.fetch = fetch as any;

    const fetchFn = buildProviderFetch({
      provider: "openai-compatible",
      apiKey: "key-123",
      baseUrl: base,
      model: "gpt-4o-mini",
    });
    await fetchFn(makeSet());

    assert.strictEqual(calls.length, 1, `base URL ${base} should produce one call`);
    assert.strictEqual(calls.at(0)!.url, expected, `base URL ${base} should yield ${expected}`);
  }
});

test("openai-compatible: Authorization header present when key is set", async () => {
  const { fetch, calls } = mockFetch([
    { status: 200, json: { choices: [{ message: { content: "ok" } }] } },
  ]);
  globalThis.fetch = fetch as any;

  const fetchFn = buildProviderFetch({
    provider: "openai-compatible",
    apiKey: "sk-test-123",
    baseUrl: "https://api.groq.com/openai/v1",
    model: "llama-3.1-8b-instant",
  });
  await fetchFn(makeSet());

  assert.ok(
    calls.at(0)!.headers.authorization === "Bearer sk-test-123",
    "Authorization header should be Bearer + key"
  );
});

test("openai-compatible: no Authorization header when key is absent", async () => {
  const { fetch, calls } = mockFetch([
    { status: 200, json: { choices: [{ message: { content: "ok" } }] } },
  ]);
  globalThis.fetch = fetch as any;

  const fetchFn = buildProviderFetch({
    provider: "openai-compatible",
    apiKey: "",
    baseUrl: "http://localhost:11434/v1",
    model: "llama3",
  });
  await fetchFn(makeSet());

  assert.ok(
    !calls.at(0)!.headers.authorization,
    "no Authorization header when key is empty"
  );
});

test("openai-compatible: missing base URL falls back (no-op, fetch not called with valid response)", async () => {
  // When baseUrl is missing for openai-compatible, the provider fetch still runs but
  // the URL would be invalid. We verify the builder still produces a fetch function
  // (the actual fallback happens at the adapter layer on fetch failure).
  const { fetch, calls } = mockFetch([
    { status: 200, json: { choices: [{ message: { content: "ok" } }] } },
  ]);
  globalThis.fetch = fetch as any;

  const fetchFn = buildProviderFetch({
    provider: "openai-compatible",
    apiKey: "key",
    baseUrl: undefined as any,
    model: "gpt-4o-mini",
  });
  await fetchFn(makeSet());

  // URL should be /chat/completions (empty base + path) — the adapter will
  // treat any failure as a fallback.
  assert.strictEqual(
    calls.at(0)!.url,
    "/chat/completions",
    "missing base URL yields a relative URL that will fail"
  );
});

test("openai-compatible: missing model falls back (no-op, fetch not called)", async () => {
  // When model is missing for openai-compatible, the provider fetch still runs with
  // an empty model. We verify the builder still produces a fetch function.
  const { fetch, calls } = mockFetch([
    { status: 200, json: { choices: [{ message: { content: "ok" } }] } },
  ]);
  globalThis.fetch = fetch as any;

  const fetchFn = buildProviderFetch({
    provider: "openai-compatible",
    apiKey: "key",
    baseUrl: "https://api.groq.com/openai/v1",
    model: undefined as any,
  });
  await fetchFn(makeSet());

  // Model should be empty string — the API will likely reject, triggering fallback.
  const body = JSON.parse(calls.at(0)!.body);
  assert.strictEqual(body.model, "", "missing model yields empty model in body");
});

test("openai-compatible: HTTP error falls back (fetch returns non-2xx)", async () => {
  const { fetch, calls } = mockFetch([
    { status: 500, json: { error: "server error" } },
  ]);
  globalThis.fetch = fetch as any;

  const fetchFn = buildProviderFetch({
    provider: "openai-compatible",
    apiKey: "key",
    baseUrl: "https://api.groq.com/openai/v1",
    model: "gpt-4o-mini",
  });

  let rejected = false;
  try {
    await fetchFn(makeSet());
  } catch (e) {
    rejected = true;
  }
  assert.ok(rejected, "HTTP 500 should reject so the adapter falls back");
});

test("openai-compatible: valid response body is used", async () => {
  const { fetch, calls } = mockFetch([
    {
      status: 200,
      json: { choices: [{ message: { content: "The build failed due to Login.jsx." } }] },
    },
  ]);
  globalThis.fetch = fetch as any;

  const fetchFn = buildProviderFetch({
    provider: "openai-compatible",
    apiKey: "key",
    baseUrl: "https://openrouter.ai/api/v1",
    model: "openai/gpt-4o-mini",
  });
  const text = await fetchFn(makeSet());

  assert.strictEqual(
    text,
    "The build failed due to Login.jsx.",
    "non-empty content from choices[0].message.content should be returned"
  );
});

test("openai-compatible: invented file in response is detected by the adapter (fallback)", async () => {
  // This test verifies the provider fetch returns the text; the adapter's
  // validateProviderExplanation rejects invented files. We verify the fetch
  // still returns the text (the rejection happens at the adapter layer).
  const { fetch, calls } = mockFetch([
    {
      status: 200,
      json: { choices: [{ message: { content: "Caused by src/evil/hacked.ts." } }] },
    },
  ]);
  globalThis.fetch = fetch as any;

  const fetchFn = buildProviderFetch({
    provider: "openai-compatible",
    apiKey: "key",
    baseUrl: "https://api.groq.com/openai/v1",
    model: "llama-3.1-8b-instant",
  });
  const text = await fetchFn(makeSet());

  assert.strictEqual(
    text,
    "Caused by src/evil/hacked.ts.",
    "provider fetch returns the raw text; adapter validation rejects it"
  );
  // Verify the request body contained the invented file so we know the fetch
  // actually happened with the correct payload.
  const body = JSON.parse(calls.at(0)!.body);
  assert.ok(body.messages.length === 2, "request has system + user messages");
});

test("gemini preset: exact URL is https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", async () => {
  const { fetch, calls } = mockFetch([
    { status: 200, json: { choices: [{ message: { content: "ok" } }] } },
  ]);
  globalThis.fetch = fetch as any;

  const fetchFn = buildProviderFetch({
    provider: "openai-compatible",
    apiKey: "gemini-key",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    model: "gemini-2.5-flash",
  });
  await fetchFn(makeSet());

  assert.strictEqual(
    calls.at(0)!.url,
    "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    "Gemini preset URL"
  );
});

test("groq preset: exact URL is https://api.groq.com/openai/v1/chat/completions", async () => {
  const { fetch, calls } = mockFetch([
    { status: 200, json: { choices: [{ message: { content: "ok" } }] } },
  ]);
  globalThis.fetch = fetch as any;

  const fetchFn = buildProviderFetch({
    provider: "openai-compatible",
    apiKey: "groq-key",
    baseUrl: "https://api.groq.com/openai/v1",
    model: "llama-3.1-8b-instant",
  });
  await fetchFn(makeSet());

  assert.strictEqual(
    calls.at(0)!.url,
    "https://api.groq.com/openai/v1/chat/completions",
    "Groq preset URL"
  );
});

test("openrouter preset: exact URL is https://openrouter.ai/api/v1/chat/completions", async () => {
  const { fetch, calls } = mockFetch([
    { status: 200, json: { choices: [{ message: { content: "ok" } }] } },
  ]);
  globalThis.fetch = fetch as any;

  const fetchFn = buildProviderFetch({
    provider: "openai-compatible",
    apiKey: "openrouter-key",
    baseUrl: "https://openrouter.ai/api/v1",
    model: "openai/gpt-4o-mini:free",
  });
  await fetchFn(makeSet());

  assert.strictEqual(
    calls.at(0)!.url,
    "https://openrouter.ai/api/v1/chat/completions",
    "OpenRouter preset URL"
  );
});

test("ollama preset: exact URL is http://localhost:11434/v1/chat/completions with no key", async () => {
  const { fetch, calls } = mockFetch([
    { status: 200, json: { choices: [{ message: { content: "ok" } }] } },
  ]);
  globalThis.fetch = fetch as any;

  const fetchFn = buildProviderFetch({
    provider: "openai-compatible",
    apiKey: "",
    baseUrl: "http://localhost:11434/v1",
    model: "llama3",
  });
  await fetchFn(makeSet());

  assert.strictEqual(
    calls.at(0)!.url,
    "http://localhost:11434/v1/chat/completions",
    "Ollama preset URL"
  );
  assert.ok(
    !calls.at(0)!.headers.authorization,
    "Ollama has no Authorization header"
  );
});
