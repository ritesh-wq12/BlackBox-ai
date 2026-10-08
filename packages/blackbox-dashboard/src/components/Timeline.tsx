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

export function Timeline({ events, isFailure }: { events: BlackBoxEvent[]; isFailure: boolean }) {
  if (!events.length) {
    return <div className="empty">Event count 0 — events will appear as they happen.</div>;
  }

  return (
    <div className="timeline">
      {events.map((e) => {
        const isFailureRow = isFailure && e.type === "BUILD_TEST" && (e.details as any)?.exitCode !== 0;
        return (
          <div
            key={e.id}
            className={`row ${isFailureRow ? "failure-row" : ""}`}
          >
            <div className={`dot ${dotClass(e)}`} title={eventLabel(e)} />
            <div className="row-meta">
              <div className="mono time">{new Date(e.timestamp).toLocaleTimeString()}</div>
              <div className="label">{eventLabel(e)}</div>
            </div>
            <div className="row-body">
              <div className="desc">{escapeHtml(e.summary)}</div>
              {eventSub(e) && (
                <div className="row-sub mono" title={eventSub(e)}>
                  {escapeHtml(eventSub(e))}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function dotClass(e: BlackBoxEvent): string {
  if (e.type === "BUILD_TEST" && (e.details as any)?.exitCode === 0) return "green";
  if (e.type === "BUILD_TEST" && (e.details as any)?.exitCode !== 0) return "red";
  if (e.type === "ERROR") return "red";
  if (e.type === "FILE") return "amber";
  if (e.type === "COMMAND") return (e.details as any)?.exitCode === 0 ? "green" : "red";
  return "blue";
}

function eventLabel(e: BlackBoxEvent): string {
  switch (e.type) {
    case "BUILD_TEST":
      return (e.details as any)?.exitCode === 0 ? "BUILD PASSED" : "BUILD FAILED";
    case "COMMAND":
      return `COMMAND (exit ${(e.details as any)?.exitCode ?? "?"})`;
    case "FILE":
      return `FILE ${e.details.changeType ?? "modified"}`;
    case "ERROR":
      return "ERROR";
    case "GIT":
      return "GIT";
    default:
      return e.type;
  }
}

function eventSub(e: BlackBoxEvent): string {
  switch (e.type) {
    case "BUILD_TEST": {
      const cmd = (e.details as any)?.command;
      return cmd ? String(cmd).slice(0, 60) : "";
    }
    case "COMMAND":
      return (e.details as any)?.command ? String((e.details as any).command).slice(0, 60) : "";
    case "FILE":
      return e.path || "";
    case "ERROR":
      return (e.details as any)?.message ? String((e.details as any).message).slice(0, 80) : "";
    case "GIT":
      return (e.details as any)?.branch ? `branch: ${e.details.branch}` : "";
    default:
      return e.path || "";
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
