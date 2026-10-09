/**
 * Deterministic fallback AI adapter — works without any API key.
 *
 * Produces a natural-language explanation from the EvidenceSet produced by
 * the deterministic evidence engine. This is the local/fallback mode that
 * the PRD requires: the core feature works offline, and the AI layer is
 * optional.
 *
 * Rules:
 *   - NEVER modifies the score, outcome, or evidence.
 *   - NEVER invents files, errors, timestamps, or causes not in the evidence.
 *   - Strong evidence → explains why the recorded evidence supports it.
 *   - Ambiguous evidence → explains uncertainty and missing/conflicting evidence.
 *   - No causal change → explains that no supported causal change was found.
 */

import { BaseAdapter, type AiProviderConfig, type ExplanationResult } from "./base.js";
import type { EvidenceSet } from "../engine/index.js";

export class FallbackAdapter extends BaseAdapter {
  /** Deterministic explanation with provenance metadata. */
  async explainDetailed(evidenceSet: EvidenceSet): Promise<ExplanationResult> {
    return {
      text: this.explain(evidenceSet),
      source: "deterministic",
      fallbackReason: "no-provider",
    };
  }

  explain(evidenceSet: EvidenceSet): string {
    this.validateImmutability(evidenceSet);

    switch (evidenceSet.status) {
      case "LIKELY_ROOT_CAUSE":
        return this.explainLikelyRootCause(evidenceSet);
      case "NO_CLEAR_ROOT_CAUSE":
        return this.explainNoClearRootCause(evidenceSet);
      case "NO_CAUSAL_CHANGE_DETECTED":
        return this.explainNoCausalChange(evidenceSet);
      default:
        return this.unknownOutcome(evidenceSet);
    }
  }

  private explainLikelyRootCause(set: EvidenceSet): string {
    const candidate = set.topCandidates[0];
    if (!candidate) {
      // Should not happen for LIKELY_ROOT_CAUSE, but defend anyway.
      return this.uncertainExplanation(set);
    }

    const lines: string[] = [
      `The Digital Black Box found likely root cause: ${candidate.candidate}.`,
      `Confidence: ${set.score}% — this score comes from recorded evidence, not from an AI guess.`,
      "",
      "Evidence summary:",
    ];

    for (const point of set.breakdown) {
      lines.push(`  • ${point.point} (event ${point.eventId})`);
    }

    if (set.chain.length > 0) {
      lines.push("");
      lines.push("Evidence chain:");
      for (const step of set.chain) {
        lines.push(`  ${step}`);
      }
    }

    if (set.error) {
      lines.push("");
      lines.push(`Error captured: ${set.error}`);
    }

    if (set.diff) {
      lines.push("");
      lines.push("Relevant git diff:");
      lines.push(set.diff);
    }

    if (set.topCandidates.length > 1) {
      lines.push("");
      lines.push(
        `Other candidates considered: ${set.topCandidates.slice(1).map((c) => c.candidate).join(", ")}.`
      );
      lines.push("The evidence above supports the top candidate more strongly than the alternatives.");
    }

    lines.push("");
    lines.push(
      "This explanation narrates the recorded evidence. The score and outcome were determined by the deterministic evidence engine, not by an AI model."
    );

    return lines.join("\n");
  }

  private explainNoClearRootCause(set: EvidenceSet): string {
    const lines: string[] = [
      `The Digital Black Box could not identify a clear root cause with high confidence.`,
      `Confidence: ${set.score}% — the recorded evidence is ambiguous or incomplete.`,
      "",
    ];

    if (set.topCandidates.length > 0) {
      lines.push("Changes observed in the investigation window:");
      for (const candidate of set.topCandidates) {
        lines.push(`  • ${candidate.candidate} (score: ${candidate.score}/100)`);
      }
      lines.push("");
      lines.push(
        "The evidence does not clearly point to one of these as the cause. The failure may be related to one of these changes, or to something the Black Box did not record."
      );
    } else {
      lines.push("No specific file changes were identified in the investigation window.");
    }

    if (set.chain.length > 0) {
      lines.push("");
      lines.push("Evidence chain:");
      for (const step of set.chain) {
        lines.push(`  ${step}`);
      }
    }

    if (set.error) {
      lines.push("");
      lines.push(`Error captured: ${set.error}`);
    }

    lines.push("");
    lines.push(
      "Possible explanations the Black Box cannot distinguish without more evidence: the failure may come from an external dependency, environment, network, configuration, a nondeterministic test, or a change the Black Box did not observe."
    );
    lines.push("");
    lines.push(
      "This explanation narrates the recorded evidence and its gaps. The score and outcome were determined by the deterministic evidence engine, not by an AI model."
    );

    return lines.join("\n");
  }

  private explainNoCausalChange(set: EvidenceSet): string {
    const lines: string[] = [
      `The Digital Black Box found no causal change that explains the failure.`,
      `Confidence: ${set.score}% — no recorded evidence supports a specific root cause.`,
      "",
    ];

    if (set.chain.length > 0) {
      lines.push("Timeline:");
      for (const step of set.chain) {
        lines.push(`  ${step}`);
      }
    }

    lines.push("");
    lines.push(
      "The failure may come from a source the Black Box did not record: an external dependency, environment change, network issue, configuration, a nondeterministic test, or another cause outside the project's recorded history."
    );
    lines.push("");
    lines.push(
      "This explanation reflects the recorded evidence. The score and outcome were determined by the deterministic evidence engine, not by an AI model."
    );

    return lines.join("\n");
  }

  private unknownOutcome(set: EvidenceSet): string {
    return [
      "The investigation produced an outcome the Black Box does not recognize.",
      `Score: ${set.score}/100.`,
      "",
      "Evidence chain:",
      ...set.chain.map((s) => `  ${s}`),
      "",
      "This explanation reflects the recorded evidence. The score and outcome were determined by the deterministic evidence engine.",
    ].join("\n");
  }

  private uncertainExplanation(set: EvidenceSet): string {
    return [
      "The investigation result is uncertain.",
      `Score: ${set.score}/100.`,
      "",
      "Evidence chain:",
      ...set.chain.map((s) => `  ${s}`),
      "",
      "This explanation reflects the recorded evidence. The score and outcome were determined by the deterministic evidence engine.",
    ].join("\n");
  }
}
