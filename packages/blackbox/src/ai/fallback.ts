/**
 * Deterministic fallback AI adapter — works without any API key.
 *
 * Produces explanations from the deterministic EvidenceSet.
 * The AI layer is optional; this adapter works offline.
 *
 * Rules:
 * - Never modifies the score, outcome, or evidence.
 * - Never invents files, errors, timestamps, or causes.
 * - Displays the actual recorded error when available.
 * - Does not claim an error proves which file caused the failure.
 */

import { BaseAdapter, type ExplanationResult } from "./base.js";
import type { EvidenceSet } from "../engine/index.js";

export class FallbackAdapter extends BaseAdapter {
  async explainDetailed(
    evidenceSet: EvidenceSet,
  ): Promise<ExplanationResult> {
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

  private appendObservedError(
    lines: string[],
    set: EvidenceSet,
  ): void {
    const error = set.error?.trim();

    if (!error) return;

    lines.push("");
    lines.push("ACTUAL RECORDED FAILURE:");
    lines.push(error);
    lines.push("");
    lines.push(
      "This error identifies what failed, but does not by itself prove which file change caused it.",
    );
  }

  private explainLikelyRootCause(set: EvidenceSet): string {
    const candidate = set.topCandidates[0];

    if (!candidate) return this.uncertainExplanation(set);

    const lines: string[] = [
      `The Digital Black Box found likely root cause: ${candidate.candidate}.`,
      `Confidence: ${set.score}% — based on recorded evidence.`,
      "",
      "Evidence summary:",
    ];

    for (const point of set.breakdown) {
      lines.push(`  - ${point.point} (event ${point.eventId})`);
    }

    if (set.chain.length > 0) {
      lines.push("");
      lines.push("Evidence chain:");
      for (const step of set.chain) {
        lines.push(`  ${step}`);
      }
    }

    this.appendObservedError(lines, set);

    if (set.diff) {
      lines.push("");
      lines.push("Relevant git diff:");
      lines.push(set.diff);
    }

    if (set.topCandidates.length > 1) {
      lines.push("");
      lines.push(
        `Other candidates considered: ${set.topCandidates
          .slice(1)
          .map((item) => item.candidate)
          .join(", ")}.`,
      );
    }

    lines.push("");
    lines.push(
      "The deterministic evidence engine determines the score and outcome.",
    );
    lines.push("");
    lines.push(
      "This explanation narrates the recorded evidence; the score and outcome come from the deterministic evidence engine, not from the AI.",
    );

    return lines.join("\n");
  }

  private explainNoClearRootCause(set: EvidenceSet): string {
    const lines: string[] = [
      "The Digital Black Box could not identify a clear root cause.",
      `Confidence: ${set.score}% — the recorded evidence is ambiguous or incomplete.`,
      "",
    ];

    if (set.topCandidates.length > 0) {
      lines.push("Changes observed in the investigation window:");

      for (const candidate of set.topCandidates) {
        lines.push(
          `  - ${candidate.candidate} (score: ${candidate.score}/100)`,
        );
      }

      lines.push("");
      lines.push(
        "The evidence does not establish which change caused the failure.",
      );
    } else {
      lines.push(
        "No specific file changes were identified in the investigation window.",
      );
    }

    if (set.chain.length > 0) {
      lines.push("");
      lines.push("Evidence chain:");
      for (const step of set.chain) {
        lines.push(`  ${step}`);
      }
    }

    this.appendObservedError(lines, set);

    lines.push("");
    lines.push(
      "The failure may involve an external dependency, environment, network, configuration, nondeterministic test, or unrecorded change.",
    );
    lines.push("");
    lines.push(
      "This explanation narrates the recorded evidence; the score and outcome come from the deterministic evidence engine, not from the AI.",
    );

    return lines.join("\n");
  }

  private explainNoCausalChange(set: EvidenceSet): string {
    const lines: string[] = [
      "The Digital Black Box found no causal change that explains the failure.",
      `Confidence: ${set.score}% — no recorded evidence supports a specific root cause.`,
    ];

    this.appendObservedError(lines, set);

    if (set.chain.length > 0) {
      lines.push("");
      lines.push("Timeline:");
      for (const step of set.chain) {
        lines.push(`  ${step}`);
      }
    }

    lines.push("");
    lines.push(
      "The failure may come from an external dependency, environment change, network issue, configuration, nondeterministic test, or another cause outside the project's recorded history.",
    );
    lines.push("");
    lines.push(
      "This explanation narrates the recorded evidence; the score and outcome come from the deterministic evidence engine, not from the AI.",
    );

    return lines.join("\n");
  }

  private unknownOutcome(set: EvidenceSet): string {
    const lines: string[] = [
      "The investigation produced an outcome the Black Box does not recognize.",
      `Score: ${set.score}/100.`,
      "",
      "Evidence chain:",
      ...set.chain.map((step) => `  ${step}`),
    ];

    this.appendObservedError(lines, set);

    lines.push("");
    lines.push(
      "This explanation narrates the recorded evidence; the score and outcome come from the deterministic evidence engine, not from the AI.",
    );

    return lines.join("\n");
  }

  private uncertainExplanation(set: EvidenceSet): string {
    const lines: string[] = [
      "The investigation result is uncertain.",
      `Score: ${set.score}/100.`,
      "",
      "Evidence chain:",
      ...set.chain.map((step) => `  ${step}`),
    ];    this.appendObservedError(lines, set);

    lines.push("");
    lines.push(
      "This explanation narrates the recorded evidence; the score and outcome come from the deterministic evidence engine, not from the AI.",
    );

    return lines.join("\n");
  }
}
