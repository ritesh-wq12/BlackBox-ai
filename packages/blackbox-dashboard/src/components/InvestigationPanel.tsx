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
}

interface InvestigationPanelProps {
  open: boolean;
  result?: InvestigationResult;
  error?: string;
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

  return (
    <div className="investigation">
      <h2>Investigation Result</h2>
      <div className="chain">
        {result.chain.map((step, i) => (
          <div key={i} className="chain-row">
            <span className="chain-arrow">↓</span>
            <span>{step}</span>
          </div>
        ))}
      </div>
      <div
        className={
          "score " +
          (result.status === "LIKELY_ROOT_CAUSE" ? "" : result.status === "NO_CLEAR_ROOT_CAUSE" ? "amber" : "red")
        }
      >
        Confidence: {result.score}%
      </div>
      <div className="why">
        <strong>Why {result.score}%?</strong>
        {result.breakdown.map((b, i) => (
          <div key={i} className="why-row">
            <span className="why-point">{b.point}</span>
            <span className="why-score">+1</span>
          </div>
        ))}
      </div>
      {result.diff && <div className="diff">Git diff: {result.diff}</div>}
      {result.error && <div className="error-box">Error: {result.error}</div>}
      {result.topCandidates && result.topCandidates.length > 0 && (
        <div className="callout">
          Candidates: {result.topCandidates.map((c) => c.candidate).join(", ")}
        </div>
      )}
      {!result.diff && !result.error && !result.topCandidates && (
        <div className="callout">No additional evidence retained for this case.</div>
      )}
    </div>
  );
}
