import { useState } from "react";
import "./InvestigationPanel.css";
import {
  buildAiPrompt,
  buildReportMarkdown,
  copyText,
  downloadMarkdown,
  isFailureEvent,
  type PromptEvent,
} from "../lib/aiPrompt";

export type InvestigationOutcome =
  | "LIKELY_ROOT_CAUSE"
  | "NO_CLEAR_ROOT_CAUSE"
  | "NO_CAUSAL_CHANGE_DETECTED";

interface InvestigationResult {
  score: number;
  status: InvestigationOutcome;
  breakdown: { point: string; eventId: string }[];
  topCandidates: { candidate: string; score: number }[];
  chain: string[];
  diff?: string;
  error?: string;
  message?: string;
  aiExplanation?: string;
  /** "ai" when a configured provider produced the text, else "deterministic". */
  explanationSource?: "ai" | "deterministic";
  /** Why the deterministic fallback was used (server-provided). */
  explanationFallback?: "no-provider" | "timeout" | "http-error" | "invalid-output" | "provider-error";
}

interface InvestigationPanelProps {
  open: boolean;
  result?: InvestigationResult;
  error?: string;
  onClose?: () => void;
  /** Recorded events, used by Copy-for-AI / Export report (already in the UI). */
  events?: PromptEvent[];
}

/** Deterministic confidence label derived from the engine's score. */
function confidenceLabel(score: number): "High" | "Medium" | "Low" | "None" {
  if (score >= 70) return "High";
  if (score >= 40) return "Medium";
  if (score >= 1) return "Low";
  return "None";
}

/** One plain-English verdict sentence, derived only from status + candidate. */
function verdictSentence(result: InvestigationResult): string {
  const top = result.topCandidates[0]?.candidate;
  switch (result.status) {
    case "LIKELY_ROOT_CAUSE":
      return top
        ? `The recorded evidence points to ${top} as the likely cause of this failure.`
        : "The recorded evidence points to a likely root cause.";
    case "NO_CLEAR_ROOT_CAUSE":
      return "The recorded evidence is ambiguous — no single change clearly explains this failure.";
    case "NO_CAUSAL_CHANGE_DETECTED":
      return "No recorded change explains this failure.";
    default:
      return "Investigation complete.";
  }
}

/** 2-3 short lines describing what happened, taken from the engine's chain. */
function happenedLines(chain: string[]): string[] {
  const out: string[] = [];
  for (const raw of chain) {
    if (raw.startsWith("BUILD PASSED")) {
      const rest = raw.replace("BUILD PASSED", "").trim();
      if (rest.includes(" — ")) {
        const [when = "", tail = ""] = rest.split(" — ");
        out.push(`Last passing build at ${when.trim()}`);
        if (tail.trim()) out.push(tail.trim());
      } else if (rest) {
        out.push(`Last passing build at ${rest}`);
      } else {
        out.push("A passing build was recorded");
      }
    } else if (raw.startsWith("FILE CHANGED")) {
      const rest = raw.replace("FILE CHANGED ", "");
      const parts = rest.split(" ");
      const ts = parts[parts.length - 1] ?? "";
      const path = parts.slice(0, -1).join(" ");
      out.push(path ? `${path} changed at ${ts}` : `File changed at ${ts}`);
    } else if (raw.startsWith("BUILD FAILED")) {
      const ts = raw.replace("BUILD FAILED", "").trim();
      out.push(ts ? `Build failed at ${ts}` : "Build failed");
    } else if (
      raw.startsWith("No failure recorded yet") ||
      raw.startsWith("No last healthy state") ||
      raw.includes("no change in the window")
    ) {
      out.push(raw);
    }
    if (out.length >= 3) break;
  }
  return out;
}

/** The changed file, from the top candidate or the chain's FILE CHANGED step. */
function changedFile(result: InvestigationResult): string {
  if (result.topCandidates[0]?.candidate) return result.topCandidates[0].candidate;
  const fileStep = result.chain.find((s) => s.startsWith("FILE CHANGED"));
  if (fileStep) {
    const rest = fileStep.replace("FILE CHANGED ", "");
    const parts = rest.split(" ");
    return parts.slice(0, -1).join(" ");
  }
  return "";
}

/** What the deterministic engine checks — shown for the 0% / no-change case. */
const ENGINE_CHECKS = [
  "a file changed in the investigation window",
  "the build/test output references the changed file",
  "the error message references the changed file",
  "a change landed within 30 seconds of the failure",
];

export function InvestigationPanel({
  open,
  result,
  error,
  onClose,
  events = [],
}: InvestigationPanelProps) {
  const [copied, setCopied] = useState(false);

  if (!open) return null;

  const failureEvent = [...events].reverse().find((e) => isFailureEvent(e));

  const onCopyPrompt = async () => {
    if (!failureEvent) return;
    const ok = await copyText(buildAiPrompt(failureEvent, events, result));
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    }
  };

  const onExport = () => {
    if (!result) return;
    const md = buildReportMarkdown(result, events);
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    downloadMarkdown(`blackbox-investigation-${stamp}.md`, md);
  };

  if (error) {
    return (
      <div className="investigation">
        <div className="investigation__backdrop" />
        <div className="investigation__panel">
          <div className="investigation__header">
            <div>
              <div className="investigation__eyebrow">Failure Investigation</div>
            </div>
            <button className="investigation__close" onClick={onClose}>
              Close
            </button>
          </div>
          <div className="investigation__callout">
            The deterministic report cannot be rendered: {error}
          </div>
        </div>
      </div>
    );
  }

  if (!result) return null;


  const isNoChange = result.status === "NO_CAUSAL_CHANGE_DETECTED";
  const confidence = confidenceLabel(result.score);
  const isAiExplanation = result.explanationSource === "ai";
  const explanationNote =
    !result.explanationFallback || result.explanationFallback === "no-provider"
      ? "No AI provider configured"
      : "AI unavailable, showing deterministic summary";
  const happened = happenedLines(result.chain);
  const file = changedFile(result);
  const otherCauses = result.topCandidates.slice(1);
  // "What to try next" renders only when the result actually provides
  // suggestions. The current engine result has no such field, so it is
  // never shown — nothing is invented.

  return (
    <div className="investigation">
      <div className="investigation__backdrop" />
      <div className="investigation__panel">
        <div className="investigation__header">
          <div>
            <div className="investigation__eyebrow">Failure Investigation</div>
          </div>
          <div className="investigation__header-actions">
            {failureEvent && (
              <button className="investigation__action" onClick={onCopyPrompt}>
                {copied ? "Copied ✓" : "Copy for AI agent"}
              </button>
            )}
            <button className="investigation__action" onClick={onExport}>
              Export report
            </button>
            <button className="investigation__close" onClick={onClose}>
              Close
            </button>
          </div>
        </div>

        {/* Verdict: plain-English sentence + deterministic confidence. */}
        <section className="investigation__section investigation__verdict">
          <div className="investigation__section-head">
            <span className="investigation__section-title">Verdict</span>
            <span className="investigation__tag" data-kind="evidence">
              Deterministic evidence
            </span>
          </div>
          <p className="investigation__verdict-line">{verdictSentence(result)}</p>
          <div className="investigation__confidence">
            <span className={`investigation__confidence-score ${confidence === "None" ? "none" : confidence === "High" ? "high" : "mid"}`}>
              {result.score}%
            </span>
            <span className="investigation__confidence-label">
              confidence · {confidence}
            </span>
            <span className="investigation__score-bar">
              <span
                className={confidence === "None" ? "fail" : confidence === "High" ? "green" : "amber"}
                style={{ width: `${Math.min(100, Math.max(0, result.score))}%` }}
              />
            </span>
          </div>
        </section>

        {/* What happened */}
        {happened.length > 0 && (
          <section className="investigation__section">
            <div className="investigation__section-head">
              <span className="investigation__section-title">What happened</span>
              <span className="investigation__tag" data-kind="evidence">
                Deterministic evidence
              </span>
            </div>
            <ul className="investigation__lines">
              {happened.map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
          </section>
        )}

        {/* No-change case: say it plainly and list what was checked. */}
        {isNoChange && (
          <section className="investigation__section">
            <div className="investigation__section-head">
              <span className="investigation__section-title">What BlackBox checked</span>
              <span className="investigation__tag" data-kind="evidence">
                Deterministic evidence
              </span>
            </div>
            <p className="investigation__plain">
              No recorded change explains this failure. BlackBox checked:
            </p>
            <ul className="investigation__checks">
              {ENGINE_CHECKS.map((c) => (
                <li key={c}>
                  <span className="investigation__check-mark">checked</span>
                  {c}
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Why we think so — evidence signals with their event ids. */}
        {result.breakdown.length > 0 && (
          <section className="investigation__section">
            <div className="investigation__section-head">
              <span className="investigation__section-title">Why we think so</span>
              <span className="investigation__tag" data-kind="evidence">
                Deterministic evidence
              </span>
            </div>
            <ul className="investigation__signals">
              {result.breakdown.map((b, i) => (
                <li key={i}>
                  <span className="investigation__signal-text">{b.point}</span>
                  <span className="investigation__signal-meta mono">
                    {b.eventId ? `event ${b.eventId.slice(0, 8)}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* What changed — with the diff in a collapsible code block. */}
        {file && (
          <section className="investigation__section">
            <div className="investigation__section-head">
              <span className="investigation__section-title">What changed</span>
              <span className="investigation__tag" data-kind="evidence">
                Deterministic evidence
              </span>
            </div>
            <div className="investigation__file-path">{file}</div>
            {result.diff && (
              <details className="investigation__details">
                <summary>Git diff</summary>
                <pre className="investigation__pre">{result.diff}</pre>
              </details>
            )}
          </section>
        )}

        {/* The error */}
        {result.error && (
          <section className="investigation__section">
            <div className="investigation__section-head">
              <span className="investigation__section-title">The error</span>
              <span className="investigation__tag" data-kind="evidence">
                Deterministic evidence
              </span>
            </div>
            <pre className="investigation__pre error">{result.error}</pre>
          </section>
        )}

        {/* Other possible causes */}
        {otherCauses.length > 0 && (
          <section className="investigation__section">
            <div className="investigation__section-head">
              <span className="investigation__section-title">Other possible causes</span>
              <span className="investigation__tag" data-kind="evidence">
                Deterministic evidence
              </span>
            </div>
            <ul className="investigation__candidates">
              {otherCauses.map((c, i) => (
                <li key={i}>
                  <span className="investigation__candidate-path">{c.candidate}</span>
                  <span className="investigation__candidate-score mono">{c.score}%</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Explanation — tagged by provenance: AI-written only when a real
            provider produced it; otherwise a deterministic summary + note. */}
        {result.aiExplanation && (
          <section className="investigation__section">
            <div className="investigation__section-head">
              <span className="investigation__section-title">Explanation</span>
              <span
                className="investigation__tag"
                data-kind={isAiExplanation ? "ai" : "evidence"}
              >
                {isAiExplanation ? "AI-written" : "Deterministic summary"}
              </span>
            </div>
            <p className="investigation__ai-note">
              {isAiExplanation
                ? "A narrative of the evidence above — not proof. The verdict, confidence and signals come from the deterministic engine."
                : explanationNote}
            </p>
            <div className="investigation__ai-text">{result.aiExplanation}</div>
          </section>
        )}

        {!result.diff &&
          !result.error &&
          !result.topCandidates.length &&
          result.breakdown.length === 0 &&
          !result.aiExplanation && (
            <div className="investigation__callout">
              No additional evidence retained for this case.
            </div>
          )}
      </div>
    </div>
  );
}
