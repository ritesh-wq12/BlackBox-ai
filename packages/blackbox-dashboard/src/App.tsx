import { useEffect, useState } from "react";
import { Header } from "./components/Header";
import { HealthSummary } from "./components/HealthSummary";
import { Timeline } from "./components/Timeline";
import { InvestigationPanel } from "./components/InvestigationPanel";
import "./App.css";

type Health = "HEALTHY" | "FAILURE DETECTED";

interface BlackBoxEvent {
  id: string;
  type: "FILE" | "GIT" | "COMMAND" | "BUILD_TEST" | "ERROR";
  timestamp: string;
  summary: string;
  path: string;
  project: string;
  sessionId: string;
  details: {
    exitCode?: number;
    error?: string;
    command?: string;
    stdout?: string;
    stderr?: string;
    changeType?: "created" | "modified" | "deleted";
    branch?: string;
    commits?: string[];
    changedPaths?: string[];
    message?: string;
    output?: string;
  };
}

function iconFor(type: BlackBoxEvent["type"], details?: BlackBoxEvent["details"]): string {
  switch (type) {
    case "BUILD_TEST":
      return details?.exitCode === 0 ? "✓" : "✕";
    case "COMMAND":
      return "$";
    case "FILE":
      return "◆";
    case "GIT":
      return "⬡";
    case "ERROR":
      return "⚠";
    default:
      return "•";
  }
}

export function App() {
  const [state, setState] = useState({
    project: "",
    sessionId: "",
    recording: false,
    eventCount: 0,
    events: [] as BlackBoxEvent[],
    health: { status: "HEALTHY" as Health, lastHealthyBuild: null as string | null, latestFailure: null as string | null },
    investigationOpen: false,
    investigationResult: undefined as any,
    investigationError: undefined as any,
  });

  const [loading, setLoading] = useState(false);

  async function refresh() {
    try {
      const res = await fetch("/api/state");
      const next = await res.json();
      setState(next);
    } catch {
      // polling failure: keep RECORDING visible
    }
  }

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 1000);
    return () => clearInterval(id);
  }, []);

  async function onInvestigate() {
    setLoading(true);
    try {
      const res = await fetch("/api/investigate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectDir: state.project }),
      });
      const body = await res.json();
      setState((s) => ({ ...s, investigationOpen: true, investigationResult: body }));
    } catch {
      setState((s) => ({ ...s, investigationOpen: true, investigationError: "Failed to run investigation." }));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="app">
      <Header
        project={state.project}
        recording={state.recording}
        eventCount={state.eventCount}
        onPause={() => {}}
        onStop={() => {}}
      />
      <HealthSummary health={state.health} />
      <Timeline
        events={state.events}
        isFailure={state.health.status === "FAILURE DETECTED"}
      />
      {state.health.status === "FAILURE DETECTED" && (
        <div className="investigate-controls">
          <button className="investigate-btn" onClick={onInvestigate} disabled={loading}>
            {loading ? "Investigating…" : "INVESTIGATE FAILURE"}
          </button>
        </div>
      )}
      <InvestigationPanel
        open={state.investigationOpen}
        result={state.investigationResult}
        error={state.investigationError}
      />
    </div>
  );
}
