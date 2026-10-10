/**
 * Real AI provider fetch implementations for the explanation layer.
 *
 * Uses only the built-in global fetch — no new dependencies. Each function
 * receives the deterministic EvidenceSet and returns the model's narrative
 * string. The API key is never logged and never included in thrown errors.
 *
 * The EvidenceSet (score/status/breakdown/chain/candidates/diff/error) is
 * sent as JSON in the user message. The raw project, event database and
 * storage are never sent.
 */
import type { EvidenceSet } from "../engine/index.js";

/** System prompt shared by all providers (content per product spec). */
export const AI_SYSTEM_PROMPT =
  "You explain software failure investigations. " +
  "Use ONLY the facts in the provided evidence. " +
  "Never name a file, time, command or cause that is not listed. " +
  "If something is unknown, say so. Do not claim certainty. " +
  "Do not suggest a different cause than the engine's verdict. " +
  "Write 2-3 short plain-English sentences on what happened and why the " +
  "evidence points where it does, then up to 3 short steps to verify. " +
  "If the status is NO_CAUSAL_CHANGE_DETECTED or NO_CLEAR_ROOT_CAUSE, say " +
  "what was checked and that the cause may lie outside the recording; do not " +
  "invent one.";

export const DEFAULT_ANTHROPIC_MODEL = "claude-haiku-4-5";
export const DEFAULT_OPENAI_MODEL = "gpt-4o-mini";

export type ProviderKind = "anthropic" | "openai" | "openai-compatible";
export type AnyProviderKind = ProviderKind;

export interface ProviderFetchOptions {
  provider: AnyProviderKind;
  apiKey?: string;
  baseUrl?: string; // openai-compatible only
  /** Optional model override; falls back to a small default per provider. */
  model?: string;
  /** Optional request timeout in ms (default 10000). */
  timeoutMs?: number;
}

const ETH_CONTENT_TYPE = "application/json";

function openaiBody(model: string, userMessage: string): string {
  return JSON.stringify({
    model,
    max_tokens: 600,
    temperature: 0.2,
    messages: [
      { role: "system", content: AI_SYSTEM_PROMPT },
      { role: "user", content: userMessage },
    ],
  });
}

function openaiFetch(
  url: string,
  apiKey: string,
  timeoutMs: number,
  userMessage: string,
  providerLabel: string,
  model: string
): Promise<string> {
  const signal = AbortSignal.timeout(timeoutMs);
  return fetch(url, {
    method: "POST",
    signal,
    headers: {
      "content-type": ETH_CONTENT_TYPE,
      ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
    },
    body: openaiBody(model, userMessage),
  }).then(async (res) => {
    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const text = data.choices?.[0]?.message?.content;
    if (!text || !text.trim()) throw new Error(`${providerLabel} returned an empty explanation`);
    return text;
  });
}

function openaiUrl(provider: AnyProviderKind, baseUrl: string | undefined): string {
  if (provider === "openai") {
    return "https://api.openai.com/v1/chat/completions";
  }
  // openai-compatible: base URL + /chat/completions, no /v1 prefix.
  // Strip any trailing slash from baseUrl before appending the path.
  const cleanBase = baseUrl?.replace(/\/+$/, "") ?? "";
  return cleanBase + "/chat/completions";
}

export function buildProviderFetch(options: ProviderFetchOptions): (evidenceSet: EvidenceSet) => Promise<string> {
  const provider = options.provider;
  const apiKey = (options.apiKey ?? "").trim();
  // openai-compatible requires BLACKBOX_AI_MODEL; missing model or base URL → fallback.
  const model =
    provider === "openai-compatible"
      ? (options.model || "")
      : options.model || (provider === "anthropic" ? DEFAULT_ANTHROPIC_MODEL : DEFAULT_OPENAI_MODEL);
  const timeoutMs = options.timeoutMs ?? 10_000;

  if (provider === "anthropic") {
    return async (evidenceSet: EvidenceSet): Promise<string> => {
      const userMessage = JSON.stringify(evidenceSet, null, 2);
      const signal = AbortSignal.timeout(timeoutMs);
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        signal,
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model,
          max_tokens: 600,
          system: AI_SYSTEM_PROMPT,
          messages: [{ role: "user", content: userMessage }],
        }),
      });
      if (!res.ok) throw new Error(`anthropic HTTP ${res.status}`);
      const data = (await res.json()) as { content?: { type?: string; text?: string }[] };
      const text = (data.content ?? []).find((b) => b.type === "text")?.text;
      if (!text || !text.trim()) throw new Error("anthropic returned an empty explanation");
      return text;
    };
  }

  // openai + openai-compatible both use the same OpenAI-format chat endpoint.
  const url = openaiUrl(provider, options.baseUrl);
  return async (evidenceSet: EvidenceSet): Promise<string> =>
    openaiFetch(url, apiKey, timeoutMs, JSON.stringify(evidenceSet, null, 2), provider, model);
}
