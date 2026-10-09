/**
 * AI explanation layer — provider-agnostic adapter.
 *
 * The deterministic evidence engine produces EvidenceSet structures.
 * The adapter turns them into natural-language explanations.
 *
 * Without a configured provider key, the FallbackAdapter provides a
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

export {
  BaseAdapter,
  ExplainableAdapter,
  type AiProviderConfig,
  type ExplanationResult,
  type ExplanationSource,
  type ExplanationFallbackReason,
} from "./base.js";
export { FallbackAdapter } from "./fallback.js";
export {
  ProviderAdapter,
  createAdapter,
  validateProviderExplanation,
  MAX_EXPLANATION_LENGTH,
} from "./adapter.js";
export {
  buildProviderFetch,
  AI_SYSTEM_PROMPT,
  DEFAULT_ANTHROPIC_MODEL,
  DEFAULT_OPENAI_MODEL,
  type ProviderKind,
  type ProviderFetchOptions,
  type AnyProviderKind,
} from "./providers.js";
