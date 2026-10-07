import "./HealthSummary.css";

interface HealthSummaryProps {
  health: { status: "HEALTHY" | "FAILURE DETECTED"; lastHealthyBuild: string | null; latestFailure: string | null };
}

export function HealthSummary({ health }: HealthSummaryProps) {
  return (
    <div className={`health ${health.status === "HEALTHY" ? "healthy" : "failure"}`}>
      <span className="label">Health</span>
      <span className="value">{health.status}</span>
      {health.lastHealthyBuild && (
        <span className="mono" style={{ marginLeft: "auto", fontSize: "12px", color: "var(--muted)" }}>
          Last success: {new Date(health.lastHealthyBuild).toLocaleTimeString()}
        </span>
      )}
      {health.latestFailure && (
        <span className="mono" style={{ marginLeft: "auto", fontSize: "12px", color: "var(--muted)" }}>
          Latest failure: {new Date(health.latestFailure).toLocaleTimeString()}
        </span>
      )}
    </div>
  );
}
