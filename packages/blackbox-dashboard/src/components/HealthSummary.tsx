import "./HealthSummary.css";

interface HealthSummaryProps {
  health: { status: "HEALTHY" | "FAILURE DETECTED"; lastHealthyBuild: string | null; latestFailure: string | null };
}

export function HealthSummary({ health }: HealthSummaryProps) {
  return (
    <div className={`health-badge ${health.status === "HEALTHY" ? "" : "failure"}`}>
      <span className={`dot ${health.status === "HEALTHY" ? "" : "warn"}`} />
      <span>{health.status}</span>
    </div>
  );
}
