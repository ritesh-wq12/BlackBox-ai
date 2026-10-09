import { useEffect, useRef, useState } from "react";
import { Header } from "./components/Header";
import { Timeline, type TabId } from "./components/Timeline";
import { InvestigationPanel } from "./components/InvestigationPanel";
import { CommandPalette, HelpOverlay, FILTER_TABS, type PaletteAction } from "./components/CommandPalette";
import { useCursorGlow } from "./components/useCursorGlow";
import { isFailureEvent } from "./lib/aiPrompt";
import "./App.css";

type Health = "HEALTHY" | "FAILURE DETECTED";
type RecordingStatus = "recording" | "paused" | "stopped";

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

function projectName(project: string): string {
  return project.split(/[\\/]/).pop() || project;
}

/** Compact "time since" label for the session strip. */
function sinceLabel(ms: number): string {
  if (ms < 0) ms = 0;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  if (h < 24) return rm ? `${h}h ${rm}m ago` : `${h}h ago`;
  const d = Math.floor(h / 24);
  const rh = h % 24;
  return rh ? `${d}d ${rh}h ago` : `${d}d ago`;
}

const SHORTCUTS = [
  { keys: "⌘K / Ctrl+K", desc: "Open the command palette" },
  { keys: "J / K", desc: "Move through events" },
  { keys: "Enter", desc: "Expand a group / jump to event" },
  { keys: "I", desc: "Investigate the focused failure" },
  { keys: "Esc", desc: "Close panel, palette or help" },
  { keys: "?", desc: "Show this help" },
];

export function App() {
  useCursorGlow();

  const [state, setState] = useState({
    project: "",
    sessionId: "",
    recording: false,
    recordingStatus: "recording" as RecordingStatus,
    eventCount: 0,
    events: [] as BlackBoxEvent[],
    health: { status: "HEALTHY" as Health, lastHealthyBuild: null as string | null, latestFailure: null as string | null },
    investigationOpen: false,
    investigationResult: undefined as any,
    investigationError: undefined as any,
  });

  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<TabId>("all");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [toast, setToast] = useState<{ id: string; summary: string } | null>(null);

  const prevIdsRef = useRef<Set<string> | null>(null);
  const seededRef = useRef(false);

  useEffect(() => {
    refresh();

    const id = setInterval(refresh, 1000);
    return () => clearInterval(id);
  }, []);

  async function refresh() {
    try {
      const res = await fetch("/api/state");
      const next = await res.json();
      // Merge the server state into local state so the 1s poll does not
      // clobber locally-managed investigation UI state (the server payload
      // carries its own copy under `ui`).
      setState((s) => ({
        ...s,
        ...next,
        investigationOpen: s.investigationOpen,
        investigationResult: s.investigationResult,
        investigationError: s.investigationError,
      }));
    } catch {
      // polling failure: keep RECORDING visible
    }
  }

  async function postRecording(action: "pause" | "resume" | "stop") {
    try {
      await fetch(`/api/recording/${action}`, { method: "POST" });
    } catch {
      // keep polling; refresh() will pick up whatever the server has
    }
    await refresh();
  }

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

  /* ---------- B6: live "new failure" toast from the existing poll ---------- */

  useEffect(() => {
    if (!state.events.length) return;
    const ids = new Set(state.events.map((e) => e.id));
    if (seededRef.current && prevIdsRef.current) {
      const newestFailure = [...state.events].reverse().find(
        (e) => !prevIdsRef.current!.has(e.id) && isFailureEvent(e)
      );
      if (newestFailure) {
        setToast({ id: newestFailure.id, summary: newestFailure.summary });
      }
    }
    prevIdsRef.current = ids;
    seededRef.current = true;
  }, [state.events]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 8000);
    return () => clearTimeout(t);
  }, [toast]);

  function scrollToEvent(id: string) {
    const el = document.getElementById(`event-${id}`);
    if (!el) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ block: "center", behavior: reduced ? "auto" : "smooth" });
    (el as HTMLElement).focus?.();
  }

  /* ---------- B5: keyboard shortcuts ---------- */

  function moveFocus(dir: 1 | -1) {
    const links = Array.from(document.querySelectorAll<HTMLElement>(".timeline-list .timeline-link"));
    if (!links.length) return;
    const current = document.activeElement as HTMLElement | null;
    const idx = current ? links.indexOf(current) : -1;
    const next =
      idx === -1
        ? dir > 0
          ? 0
          : links.length - 1
        : Math.min(Math.max(idx + dir, 0), links.length - 1);
    const el = links[next];
    if (!el) return;
    el.focus({ preventScroll: true });
    el.scrollIntoView({ block: "center" });
  }

  function jumpToLatestFailure() {
    const failures = state.events.filter((e) => isFailureEvent(e));
    const last = failures[failures.length - 1];
    setPaletteOpen(false);
    setTab("all");
    if (last) {
      // wait a tick for the tab to re-render rows
      setTimeout(() => scrollToEvent(last.id), 60);
    }
  }

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      const target = ev.target as HTMLElement | null;
      const typing =
        !!target &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);

      if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === "k") {
        ev.preventDefault();
        setPaletteOpen((o) => !o);
        return;
      }
      if (ev.key === "Escape") {
        setPaletteOpen(false);
        setHelpOpen(false);
        setState((s) => (s.investigationOpen ? { ...s, investigationOpen: false } : s));
        return;
      }
      if (typing) return;

      if (ev.key === "?") {
        ev.preventDefault();
        setHelpOpen((h) => !h);
        return;
      }
      if (ev.key === "j" || ev.key === "J") {
        ev.preventDefault();
        moveFocus(1);
        return;
      }
      if (ev.key === "k" || ev.key === "K") {
        ev.preventDefault();
        moveFocus(-1);
        return;
      }
      if (ev.key === "i" || ev.key === "I") {
        const el = document.activeElement as HTMLElement | null;
        const row = el?.closest?.(".timeline-row");
        if (row && row.classList.contains("is-failure")) {
          ev.preventDefault();
          onInvestigate();
        }
        return;
      }
      // Enter: native behavior already expands group buttons and follows
      // row anchors (they point at #event-<id>), so nothing to intercept.
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  /* ---------- B4: session summary strip (computed from loaded events) ---------- */

  const summary = (() => {
    let passed = 0;
    let failed = 0;
    let files = 0;
    let lastFailureMs: number | null = null;
    for (const e of state.events) {
      if (e.type === "FILE") files++;
      if (e.type === "COMMAND" && typeof e.details.exitCode === "number") {
        if (e.details.exitCode === 0) {
          passed++;
        } else {
          failed++;
          const t = Date.parse(e.timestamp);
          if (!isNaN(t)) lastFailureMs = Math.max(lastFailureMs ?? 0, t);
        }
      } else if (e.type === "ERROR") {
        const t = Date.parse(e.timestamp);
        if (!isNaN(t)) lastFailureMs = Math.max(lastFailureMs ?? 0, t);
      }
    }
    return {
      passed,
      failed,
      files,
      since: lastFailureMs === null ? "—" : sinceLabel(Date.now() - lastFailureMs),
    };
  })();

  /* ---------- B3: palette actions (existing handlers only) ---------- */

  const recordingStatus = state.recordingStatus ?? (state.recording ? "recording" : "stopped");
  const failures = state.events.filter((e) => isFailureEvent(e));

  const paletteActions: PaletteAction[] = [
    ...(failures.length
      ? [{ id: "jump-failure", label: "Jump to latest failure", hint: "timeline", run: jumpToLatestFailure }]
      : []),
    ...(failures.length
      ? [{ id: "investigate", label: "Open investigation", hint: "evidence", run: () => { setPaletteOpen(false); onInvestigate(); } }]
      : []),
    ...(recordingStatus === "recording"
      ? [{ id: "pause", label: "Pause recording", run: () => { setPaletteOpen(false); postRecording("pause"); } }]
      : []),
    ...(recordingStatus === "paused"
      ? [{ id: "resume", label: "Resume recording", run: () => { setPaletteOpen(false); postRecording("resume"); } }]
      : []),
    ...(recordingStatus !== "stopped"
      ? [{ id: "stop", label: "Stop recording", run: () => { setPaletteOpen(false); postRecording("stop"); } }]
      : []),
    ...(recordingStatus === "stopped"
      ? [{ id: "start", label: "Start recording", hint: "resume", run: () => { setPaletteOpen(false); postRecording("resume"); } }]
      : []),
    ...FILTER_TABS.map((t) => ({
      id: `filter-${t.id}`,
      label: `Filter: ${t.label}`,
      hint: "timeline tab",
      run: () => { setPaletteOpen(false); setTab(t.id); },
    })),
  ];

  return (
    <div className="app">
      <Header
        projectName={projectName(state.project)}
        eventCount={state.eventCount}
        health={state.health}
        recording={state.recording}
        recordingStatus={recordingStatus}
        onPause={() => postRecording(recordingStatus === "paused" ? "resume" : "pause")}
        onStop={() => postRecording("stop")}
        onStart={() => postRecording("resume")}
      />

      {/* B4: session summary strip above the timeline */}
      <div className="session-strip" aria-label="Session summary">
        <div className="session-strip__cell">
          <span className="label">Passed</span>
          <span className="session-strip__val mono">{summary.passed}</span>
        </div>
        <div className="session-strip__cell">
          <span className="label">Failed</span>
          <span className="session-strip__val mono is-fail">{summary.failed}</span>
        </div>
        <div className="session-strip__cell">
          <span className="label">Files changed</span>
          <span className="session-strip__val mono">{summary.files}</span>
        </div>
        <div className="session-strip__cell">
          <span className="label">Last failure</span>
          <span className="session-strip__val mono">{summary.since}</span>
        </div>
      </div>

      <Timeline
        events={state.events}
        isFailure={state.health.status === "FAILURE DETECTED"}
        investigation={state.investigationResult}
        tab={tab}
        onTabChange={setTab}
      />

      {state.health.status === "FAILURE DETECTED" && (
        <div className="investigate-controls">
          <button className="is-primary" onClick={onInvestigate} disabled={loading}>
            {loading ? "Investigating…" : "Investigate failure"}
          </button>
        </div>
      )}

      <InvestigationPanel
        open={state.investigationOpen}
        result={state.investigationResult}
        error={state.investigationError}
        onClose={() => setState((s) => ({ ...s, investigationOpen: false }))}
        events={state.events}
      />

      <CommandPalette
        open={paletteOpen}
        actions={paletteActions}
        onClose={() => setPaletteOpen(false)}
      />

      <HelpOverlay open={helpOpen} shortcuts={SHORTCUTS} onClose={() => setHelpOpen(false)} />

      {/* B6: live new-failure toast */}
      {toast && (
        <div className="failure-toast" role="status" aria-live="polite">
          <span className="failure-toast__dot" aria-hidden="true" />
          <div className="failure-toast__body">
            <div className="failure-toast__title">New failure recorded</div>
            <div className="failure-toast__text mono">{toast.summary}</div>
          </div>
          <button
            type="button"
            className="failure-toast__view"
            onClick={() => {
              scrollToEvent(toast.id);
              setToast(null);
            }}
          >
            View
          </button>
          <button
            type="button"
            className="failure-toast__x"
            aria-label="Dismiss notification"
            onClick={() => setToast(null)}
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
}
