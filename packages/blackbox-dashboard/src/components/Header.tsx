import "./Header.css";
import { IconPause, IconPlay, IconStop } from "./icons";

interface Health {
  status: "HEALTHY" | "FAILURE DETECTED";
  lastHealthyBuild: string | null;
  latestFailure: string | null;
}

type RecordingStatus = "recording" | "paused" | "stopped";

interface HeaderProps {
  projectName: string;
  eventCount: number;
  health: Health;
  recording: boolean;
  recordingStatus: RecordingStatus;
  onPause: () => void;
  onStop: () => void;
  onStart: () => void;
}

const STATUS_LABEL: Record<RecordingStatus, string> = {
  recording: "Recording",
  paused: "Paused",
  stopped: "Stopped",
};

export function Header({ projectName, eventCount, health, recording, recordingStatus, onPause, onStop, onStart }: HeaderProps) {
  const isPaused = recordingStatus === "paused";
  const isStopped = recordingStatus === "stopped";
  const pauseLabel = isPaused ? "Resume" : "Pause";
  return (
    <header className="app-bar">
      <div className="brand">
        <div className="brand-mark" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="mark-svg">
            <rect x="3" y="3" width="18" height="18" rx="3" />
            <path d="M7 7h10M7 12h10M7 17h6" />
          </svg>
        </div>
        <div className="brand-text">
          <div className="brand-name">Digital Black Box</div>
          <div className="brand-sub">forensic build console</div>
        </div>
      </div>

      <div className="meta">
        <div className="meta-cell">
          <span className="label">Project</span>
          <span className="value mono">{projectName}</span>
        </div>
        <div className="meta-cell">
          <span className="label">Events</span>
          <span className="value mono">{eventCount}</span>
        </div>
        <div className="meta-cell">
          <span className="label">Health</span>
          <span className="health quiet" data-health={health.status}>
            <span className="dot" aria-hidden="true" />
            <span>{health.status === "HEALTHY" ? "Healthy" : "Failure"}</span>
          </span>
        </div>
      </div>

      <div className="controls">
        <div className="health quiet" data-health={health.status} data-status={recordingStatus} aria-live="polite">
          <span className="dot" aria-hidden="true" />
          <span className="mono">{STATUS_LABEL[recordingStatus] ?? (recording ? "Recording" : "Idle")}</span>
        </div>

        <button
          type="button"
          className="btn is-ghost"
          onClick={onPause}
          disabled={isStopped}
          aria-label={pauseLabel === "Resume" ? "Resume recording" : "Pause recording"}
        >
          <span className="btn-icon" aria-hidden="true">{isPaused ? <IconPlay /> : <IconPause />}</span>
          {pauseLabel}
        </button>

        <button type="button" className="btn is-ghost" onClick={onStop} disabled={isStopped} aria-label="Stop recording">
          <span className="btn-icon" aria-hidden="true"><IconStop /></span>
          Stop
        </button>

        {isStopped && (
          <button type="button" className="btn is-primary" onClick={onStart} aria-label="Start recording">
            <span className="btn-icon" aria-hidden="true"><IconPlay /></span>
            Start
          </button>
        )}
      </div>
    </header>
  );
}
