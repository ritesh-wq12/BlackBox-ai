/**
 * Base adapter types and classes for the Digital Black Box AI explanation layer.
 *
 * This module is shared between the FallbackAdapter and ProviderAdapter to
 * avoid circular dependencies. It defines the core interface and base class
 * that all adapters must implement.
 */

import type { EvidenceSet } from "../engine/index.js";

export interface AiProviderConfig {
  /** Optional provider name (e.g. "anthropic", "openai"). */
  provider?: string;
  /** Optional API key. When absent, the fallback adapter is used. */
  apiKey?: string;
  /**
   * Optional provider fetch function. When provided, the ProviderAdapter uses
   * it to fetch an AI explanation from the configured provider.
   *
   * The function receives the EvidenceSet (serialized) and must return a
   * string explanation. If it rejects, times out, or returns an empty result,
   * the fallback adapter is used instead.
   */
  providerFetch?: (evidenceSet: EvidenceSet) => Promise<string>;
  /**
   * Optional timeout in milliseconds for the provider fetch. Defaults to 10 seconds.
   */
  timeoutMs?: number;
}

/** Whether an explanation came from a real AI provider or the local fallback. */
export type ExplanationSource = "ai" | "deterministic";

/** Why a deterministic fallback explanation was used instead of AI output. */
export type ExplanationFallbackReason =
  | "no-provider"
  | "timeout"
  | "http-error"
  | "invalid-output"
  | "provider-error";

/** Result of producing an explanation, including its provenance. */
export interface ExplanationResult {
  text: string;
  source: ExplanationSource;
  fallbackReason?: ExplanationFallbackReason;
}

/**
 * Interface that any AI provider must implement.
 * The only method is explain(), which receives the full EvidenceSet and
 * returns a natural-language narrative.
 */
export interface ExplainableAdapter {
  /**
   * Convert a deterministic evidence set into a human-readable explanation.
   * The returned string MUST NOT contradict or modify the evidence set's
   * score, status, breakdown, or candidates.
   */
  explain(evidenceSet: EvidenceSet): string | Promise<string>;
  /**
   * Like explain(), but also reports where the text came from ("ai" or
   * "deterministic") and, when it fell back, why. Optional so external
   * adapters implementing only explain() keep working.
   */
  explainDetailed?(evidenceSet: EvidenceSet): Promise<ExplanationResult>;
}

/**
 * Base class that enforces the contract: the adapter receives the evidence
 * set but cannot modify it. Subclasses implement the actual explanation.
 */
export abstract class BaseAdapter implements ExplainableAdapter {
  constructor(protected config: AiProviderConfig = {}) {}

  /**
   * Every adapter must validate that it does not mutate the evidence set.
   * This is a runtime guard, not a substitute for code review.
   */
  protected validateImmutability(_evidenceSet: EvidenceSet): void {
    // Subclasses may override to add provider-specific checks.
  }

  /**
   * Explain the evidence set. Must be implemented by subclasses.
   * May return a Promise for async providers.
   */
  abstract explain(evidenceSet: EvidenceSet): string | Promise<string>;
}
