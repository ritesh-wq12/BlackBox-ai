import "./Timeline.css";

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

export function Timeline({ events, isFailure  }: { events: BlackBoxEvent[]; isFailure: boolean }) {
  if (!events.length) {
    return <div className="empty">Event count 0 — events will appear as they happen.</div>;
  }

  return (
    <div className="timeline">
      {events.map((e, i) => {
        const isFailureRow = isFailure && i === events.length - 1;
        return (
          <div
            key={e.id}
            className={`row ${isFailureRow ? "failure-row" : ""}`}
          >
            <div className={`dot ${dotClass(e)}`} />
            <div className="mono">{new Date(e.timestamp).toLocaleTimeString()}</div>
            <div className="icon">{iconFor(e, e.details)}</div>
            <div className="desc">{escapeHtml(e.summary)}</div>
            <div className="mono">{e.path || ""}</div>
          </div>
        );
      })}
    </div>
  );
}

function dotClass(e: BlackBoxEvent): string {
  if (e.type === "BUILD_TEST" && (e.details as any)?.exitCode === 0) return "green";
  if (e.type === "BUILD_TEST") return "red";
  return "blue";
}

function iconFor(e: BlackBoxEvent, details?: BlackBoxEvent["details"]): string {
  switch (e.type) {
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

function escapeHtml(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) => {
    const map: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return map[c] as string;
  });
}
