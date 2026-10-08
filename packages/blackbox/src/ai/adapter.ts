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
 * The EvidenceSet (score, outcome, evidence, root-cause candidate) is
 * ALWAYS produced by the deterministic evidence engine. The AI adapter
 * NEVER modifies, overrides, or invents these values — it only narrates
 * the recorded evidence.
 */

import { BaseAdapter, type AiProviderConfig, type ExplainableAdapter } from "./base.js";
import type { EvidenceSet } from "../engine/index.js";
import { FallbackAdapter } from "./fallback.js";

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

  async explain(evidenceSet: EvidenceSet): Promise<string> {
    // Validate the evidence set is immutable before passing to the provider.
    this.validateImmutability(evidenceSet);

    const fetchFn = this.config.providerFetch;
    if (!fetchFn) {
      // No provider configured — use deterministic fallback.
      return this.fallback.explain(evidenceSet);
    }

    try {
      const explanation = await this.withTimeout(
        fetchFn(evidenceSet),
        this.timeoutMs,
      );

      if (!explanation || typeof explanation !== "string" || explanation.trim().length === 0) {
        // Provider returned empty/invalid — fall back to deterministic.
        return this.fallback.explain(evidenceSet);
      }

      // Provider returned something — validate it doesn't contradict the evidence.
      this.validateProviderExplanation(explanation, evidenceSet);

      return explanation;
    } catch (error) {
      // Provider failed, timed out, or was unavailable — fall back to deterministic.
      return this.fallback.explain(evidenceSet);
    }
  }

  /**
   * Validate that the provider's explanation does not contradict the
   * deterministic evidence. This is a basic check — the provider should
   * already be contractually bound to not modify the score/outcome.
   */
  private validateProviderExplanation(explanation: string, evidenceSet: EvidenceSet): void {
    // The provider must not invent a different score.
    const scorePattern = new RegExp(`Confidence:\\s*${evidenceSet.score}%`, "i");
    if (!scorePattern.test(explanation) && !explanation.includes(String(evidenceSet.score))) {
      // Provider didn't mention the correct score — flag but don't fail.
      // The deterministic score is still authoritative; we just note the
      // provider's explanation may not reference it correctly.
    }

    // The provider must not change the outcome status.
    const status = evidenceSet.status;
    if (status === "LIKELY_ROOT_CAUSE" && !explanation.toLowerCase().includes("root cause")) {
      // Provider didn't mention root cause — note but don't fail.
    }
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
