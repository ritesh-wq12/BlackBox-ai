import "./Header.css";

interface HeaderProps {
  project: string;
  recording: boolean;
  eventCount: number;
  onPause: () => void;
  onStop: () => void;
}

export function Header({ project, recording, eventCount, onPause, onStop }: HeaderProps) {
  return (
    <header className="header">
      <div className="brand">◉ Digital Black Box</div>
      <div className={`status ${recording ? "recording" : ""}`}>
        ● RECORDING
      </div>
      <div className="meta">
        <span>Project: <span className="mono">{project.split(/[\\/]/).pop()}</span></span>
        <span>Events: <span className="mono">{eventCount}</span></span>
      </div>
      <div className="controls">
        <button onClick={onPause}>Pause</button>
        <button onClick={onStop}>Stop</button>
      </div>
    </header>
  );
}
