import "./InvestigationPanel.css";

export type InvestigationOutcome = "LIKELY_ROOT_CAUSE" | "NO_CLEAR_ROOT_CAUSE" | "NO_CAUSAL_CHANGE_DETECTED";

interface InvestigationResult {
  score: number;
  status: InvestigationOutcome;
  breakdown: { point: string; eventId: string }[];
  topCandidates: { candidate: string; score: number }[];
  chain: string[];
  diff?: string;
  error?: string;
  message?: string;
  /**
   * Optional AI-generated explanation. When present, it narrates the
   * deterministic evidence set. The score and outcome are authoritative
   * from the evidence engine; the AI never modifies them.
   */
  aiExplanation?: string;
}

interface InvestigationPanelProps {
  open: boolean;
  result?: InvestigationResult;
  error?: string;
}

function outcomeLabel(status: InvestigationOutcome): string {
  switch (status) {
    case "LIKELY_ROOT_CAUSE":
      return "LIKELY ROOT CAUSE";
    case "NO_CLEAR_ROOT_CAUSE":
      return "NO CLEAR ROOT CAUSE";
    case "NO_CAUSAL_CHANGE_DETECTED":
      return "NO CAUSAL CHANGE DETECTED";
    default:
      return status;
  }
}

function chainStepClass(step: string): string {
  if (step.startsWith("BUILD PASSED")) return "chain-step pass";
  if (step.startsWith("FILE CHANGED")) return "chain-step change";
  if (step.startsWith("BUILD FAILED")) return "chain-step fail";
  if (step.startsWith("ERROR MATCH")) return "chain-step error";
  if (step.startsWith("LIKELY_ROOT_CAUSE") || step.startsWith("NO_CLEAR_ROOT_CAUSE") || step.startsWith("NO_CAUSAL_CHANGE_DETECTED")) return "chain-step root";
  if (step.startsWith("FAILURE REPORTED")) return "chain-step fail";
  return "chain-step";
}

function chainStepIcon(step: string): string {
  if (step.startsWith("BUILD PASSED")) return "\u2713";
  if (step.startsWith("FILE CHANGED")) return "\u25C8";
  if (step.startsWith("BUILD FAILED")) return "\u2715";
  if (step.startsWith("ERROR MATCH")) return "\u26A0";
  if (step.startsWith("LIKELY_ROOT_CAUSE")) return "\u25C6";
  if (step.startsWith("NO_CLEAR_ROOT_CAUSE")) return "\u25C7";
  if (step.startsWith("NO_CAUSAL_CHANGE_DETECTED")) return "\u25CB";
  if (step.startsWith("FAILURE REPORTED")) return "\u2715";
  return "\u2022";
}

export function InvestigationPanel({ open, result, error }: InvestigationPanelProps) {
  if (!open) return null;

  if (error) {
    return (
      <div className="callout">
        The deterministic report cannot be rendered: {error}
      </div>
    );
  }

  if (!result) return null;

  const outcomeClass =
    result.status === "LIKELY_ROOT_CAUSE"
      ? "outcome likely"
      : result.status === "NO_CLEAR_ROOT_CAUSE"
        ? "outcome ambiguous"
        : "outcome none";

  const changedPath = result.topCandidates && result.topCandidates[0]
    ? result.topCandidates[0].candidate
    : result.chain.find((s) => s.startsWith("FILE CHANGED"))?.replace("FILE CHANGED ", "")?.split(" ").slice(0, -1).join(" ") || "";

  return (
    <div className="investigation">
      <div className="inv-header">
        <h2>Investigation Result</h2>
        <div className={`outcome-banner ${outcomeClass}`}>
          <span className="outcome-label">{outcomeLabel(result.status)}</span>
        </div>
      </div>

      <div className="score-row">
        <div className={`score ${result.status === "LIKELY_ROOT_CAUSE" ? "" : result.status === "NO_CLEAR_ROOT_CAUSE" ? "amber" : "red"}`}>
          {result.score}%
        </div>
        <div className="score-label">Confidence</div>
      </div>

      {result.breakdown.length > 0 && (
        <div className="breakdown">
          <div className="breakdown-title">Why {result.score}%?</div>
          {result.breakdown.map((b, i) => (
            <div key={i} className="breakdown-row">
              <span className="breakdown-point">{b.point}</span>
              <span className="breakdown-score">+25</span>
            </div>
          ))}
        </div>
      )}

      <div className="chain-section">
        <div className="section-title">Evidence Chain</div>
        <div className="chain">
          {result.chain.map((step, i) => (
            <div key={i} className={chainStepClass(step)}>
              <span className="chain-icon">{chainStepIcon(step)}</span>
              <span className="chain-content">
                <span className="chain-step-label">{step.split(" ").slice(0, 2).join(" ") || step}</span>
                <span className="chain-step-detail">{step}</span>
              </span>
            </div>
          ))}
        </div>
      </div>

      {changedPath && (
        <div className="file-section">
          <div className="section-title">Changed File</div>
          <div className="file-path mono">{changedPath}</div>
        </div>
      )}

      {result.error && (
        <div className="error-section">
          <div className="section-title">Build / Test Error</div>
          <pre className="error-output">{result.error}</pre>
        </div>
      )}

      {result.diff && (
        <div className="diff-section">
          <div className="section-title">Git Diff</div>
          <pre className="diff-output">{result.diff}</pre>
        </div>
      )}

      {result.topCandidates && result.topCandidates.length > 0 && (
        <div className="candidates-section">
          <div className="section-title">Top Candidates</div>
          <div className="candidates">
            {result.topCandidates.map((c, i) => (
              <div key={i} className="candidate">
                <span className="candidate-name mono">{c.candidate}</span>
                <span className="candidate-score">{c.score}%</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {result.aiExplanation && (
        <div className="ai-section">
          <div className="section-title">Deterministic Explanation</div>
          <p className="ai-disclaimer">
            This narration is generated from the recorded evidence. The confidence score and
            outcome above are determined by the deterministic evidence engine, not by an AI model.
          </p>
          <pre className="ai-narrative">{result.aiExplanation}</pre>
        </div>
      )}

      {!result.diff && !result.error && !result.topCandidates && result.breakdown.length === 0 && (
        <div className="callout">
          No additional evidence retained for this case.
        </div>
      )}
    </div>
  );
}
