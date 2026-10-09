/**
 * Provider-agnostic AI adapter interface for the Digital Black Box.
 *
 * The adapter receives the deterministic EvidenceSet produced by the evidence
 * engine and converts it into a natural-language explanation. The adapter MUST
 * NOT modify the score, outcome, evidence, or suspected root cause — it only
 * narrates what the deterministic layer already decided.
 *
 * Without a configured provider key, the fallback adapter returns a
 * deterministic local explanation so the feature works offline.
 *
 * When a provider is configured via providerFetch, the ProviderAdapter
 * fetches an AI explanation from the provider. If the provider fails,
 * times out, or is unavailable, the fallback adapter is used.
 *
 * The EvidenceSet (score, outcome, evidence, root-cause candidate) is ALWAYS
 * produced by the deterministic evidence engine. The AI adapter NEVER
 * modifies, overrides, or invents these values — it only narrates the
 * recorded evidence.
 */

import {
  BaseAdapter,
  type AiProviderConfig,
  type ExplainableAdapter,
  type ExplanationResult,
} from "./base.js";
import type { EvidenceSet } from "../engine/index.js";
import { FallbackAdapter } from "./fallback.js";

/** Longest explanation we accept from a provider (prompt asks for ~2-3 sentences). */
export const MAX_EXPLANATION_LENGTH = 4000;

const FILE_EXTENSIONS =
  "ts|tsx|js|jsx|mjs|cjs|json|css|scss|md|mdx|py|go|rs|java|kt|yml|yaml|toml|" +
  "txt|sh|bash|zsh|html|htm|sql|snap|lock|env|cfg|ini|xml|c|cpp|h|hpp|rb|php|" +
  "vue|svelte|gradle|properties|conf";

/** ISO timestamps and HH:MM:SS clock times. */
const TIMESTAMP_RE =
  /\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?|\b\d{2}:\d{2}:\d{2}\b/g;

/** Path-like tokens: anything with a separator, or a known file extension. */
const PATH_RE = new RegExp(
  `(?:[A-Za-z0-9_.@-]+[\\\\/])+[A-Za-z0-9_.@-]+|\\b[A-Za-z0-9_-]+\\.(?:${FILE_EXTENSIONS})\\b`,
  "g"
);

/**
 * Command-like mentions: an unambiguous binary followed by up to 4 tokens.
 * Ambiguous English words (make, go, run) are deliberately excluded so plain
 * prose is never mistaken for a command.
 */
const COMMAND_RE =
  /(?:^|[\s'"`(\[;:,])((?:npm|npx|yarn|pnpm|node|python3?|pip3?|pytest|jest|vitest|mocha|deno|bun|docker|kubectl|cargo|tsc|mvn|gradle|dotnet|composer|terraform|git|bash)(?:\s+[^\s,;.!?()]+){1,4})/gim;

function normalize(s: string): string {
  return s.replace(/\\/g, "/");
}

function stripTrailingPunct(s: string): string {
  return s.replace(/[.,;:!?)\]>"']+$/, "").trim();
}

/** Extract candidate file paths, timestamps and commands from AI text. */
function extractMentions(text: string): { paths: string[]; times: string[]; commands: string[] } {
  const paths = (text.match(PATH_RE) ?? []).map((m) => normalize(stripTrailingPunct(m)));
  const times = (text.match(TIMESTAMP_RE) ?? []).map((m) => stripTrailingPunct(m));
  const commands = (text.match(COMMAND_RE) ?? []).map((m) => stripTrailingPunct(m));
  return { paths: [...new Set(paths)], times: [...new Set(times)], commands: [...new Set(commands)] };
}

/**
 * Strict validation of provider output (per spec): every file path, timestamp
 * and command extracted from the AI text must literally appear somewhere in
 * the EvidenceSet (breakdown, chain, topCandidates, diff, error). Empty or
 * excessively long text is also rejected. Returns true only for text that is
 * safe to show as an AI explanation.
 */
export function validateProviderExplanation(
  explanation: string,
  evidenceSet: EvidenceSet
): boolean {
  const text = (explanation ?? "").trim();
  if (!text) return false;
  if (text.length > MAX_EXPLANATION_LENGTH) return false;

  const haystack = normalize(
    [
      ...evidenceSet.breakdown.map((b) => `${b.point} ${b.eventId}`),
      ...evidenceSet.chain,
      ...evidenceSet.topCandidates.map((c) => `${c.candidate} ${c.score}`),
      evidenceSet.diff ?? "",
      evidenceSet.error ?? "",
    ].join("\n")
  );

  const { paths, times, commands } = extractMentions(text);

  for (const p of paths) {
    if (!p || p.length < 3) continue;
    if (!haystack.includes(p)) return false;
  }
  for (const t of times) {
    if (!haystack.includes(t)) return false;
  }
  for (const c of commands) {
    // Allow exactly one trailing glue word (e.g. "again"), nothing more —
    // if no prefix of the mention appears in the evidence, reject.
    const tokens = c.split(/\s+/);
    let found = false;
    for (let drop = 0; drop <= 1 && !found; drop++) {
      const candidate = tokens.slice(0, Math.max(2, tokens.length - drop)).join(" ");
      if (haystack.includes(candidate)) found = true;
    }
    if (!found) return false;
  }

  return true;
}

/**
 * Provider adapter — uses a configurable provider fetch function to get an
 * AI explanation from an external provider. Falls back to the deterministic
 * explanation if the provider fails, times out, or is unavailable.
 *
 * The provider fetch function is provider-agnostic: it can be implemented
 * for any provider (Anthropic, OpenAI, etc.) without changing this adapter.
 * The adapter does not hardcode any provider or API key.
 */
export class ProviderAdapter extends BaseAdapter {
  private readonly fallback: FallbackAdapter;
  private readonly timeoutMs: number;

  constructor(config: AiProviderConfig = {}) {
    super(config);
    this.fallback = new FallbackAdapter(config);
    this.timeoutMs = config.timeoutMs ?? 10_000;
  }

  /** Full result including provenance ("ai" vs "deterministic" and why). */
  async explainDetailed(evidenceSet: EvidenceSet): Promise<ExplanationResult> {
    // Validate the evidence set is immutable before passing to the provider.
    this.validateImmutability(evidenceSet);

    const deterministic = (): ExplanationResult => ({
      text: this.fallback.explain(evidenceSet),
      source: "deterministic",
    });

    const fetchFn = this.config.providerFetch;
    if (!fetchFn) {
      // No provider configured — use deterministic fallback.
      return { ...deterministic(), fallbackReason: "no-provider" };
    }

    let explanation: string;
    try {
      explanation = await this.withTimeout(fetchFn(evidenceSet), this.timeoutMs);
    } catch (error) {
      // Provider failed, timed out, or was unavailable — fall back and
      // classify why. Error messages must never contain the API key.
      const message = error instanceof Error ? error.message : String(error);
      const reason = /timed out|timeout/i.test(message)
        ? "timeout"
        : /HTTP \d{3}/i.test(message)
          ? "http-error"
          : "provider-error";
      return { ...deterministic(), fallbackReason: reason };
    }

    if (!explanation || typeof explanation !== "string" || !explanation.trim()) {
      return { ...deterministic(), fallbackReason: "invalid-output" };
    }

    if (!validateProviderExplanation(explanation, evidenceSet)) {
      // The provider named a file, time or command that is not in the
      // evidence — reject the text and use the deterministic fallback.
      return { ...deterministic(), fallbackReason: "invalid-output" };
    }

    return { text: explanation, source: "ai" };
  }

  async explain(evidenceSet: EvidenceSet): Promise<string> {
    return (await this.explainDetailed(evidenceSet)).text;
  }

  private withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error("Provider timed out"));
      }, timeoutMs);

      promise.then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (error) => {
          clearTimeout(timer);
          reject(error);
        },
      );
    });
  }
}

/**
 * Create the appropriate adapter based on configuration.
 * - No API key / no provider fetch → FallbackAdapter (deterministic, offline)
 * - Provider fetch configured → ProviderAdapter (with fallback on failure)
 */
export function createAdapter(config: AiProviderConfig = {}): ExplainableAdapter {
  if (config.providerFetch) {
    return new ProviderAdapter(config);
  }
  return new FallbackAdapter(config);
}

// Re-export for backwards compatibility.
export { FallbackAdapter } from "./fallback.js";
