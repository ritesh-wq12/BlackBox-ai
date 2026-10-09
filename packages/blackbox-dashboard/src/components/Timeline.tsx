import { useState, useRef, useEffect } from "react";
import "./Timeline.css";
import { EventGlyph, type EventGlyphKind } from "./icons";
import { buildAiPrompt, copyText } from "../lib/aiPrompt";

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

/** Slice of the investigation result used for the evidence trail and copy prompt. */
export interface TrailInvestigation {
  score: number;
  status: "LIKELY_ROOT_CAUSE" | "NO_CLEAR_ROOT_CAUSE" | "NO_CAUSAL_CHANGE_DETECTED";
  breakdown: { point: string; eventId: string }[];
  topCandidates: { candidate: string; score: number }[];
  chain: string[];
  diff?: string;
  error?: string;
  message?: string;
  aiExplanation?: string;
}

export type TabId = "all" | "build" | "file" | "command" | "error" | "git";

const TABS: { id: TabId; label: string }[] = [
  { id: "all", label: "All" },
  { id: "build", label: "Build" },
  { id: "file", label: "Files" },
  { id: "command", label: "Commands" },
  { id: "error", label: "Errors" },
  { id: "git", label: "Git" },
];

/** Short noun used in the "No <noun> events" empty-filter message. */
const EMPTY_NOUN: Record<TabId, string> = {
  all: "event",
  build: "build",
  file: "file",
  command: "command",
  error: "error",
  git: "git",
};

function tabFor(e: BlackBoxEvent): TabId {
  switch (e.type) {
    case "BUILD_TEST": return "build";
    case "FILE": return "file";
    case "COMMAND": return "command";
    case "ERROR": return "error";
    case "GIT": return "git";
    default: return "all";
  }
}

function detailsOf(e: BlackBoxEvent): BlackBoxEvent["details"] {
  return e.details ?? {};
}

/** Failed rows are dominant; everything else stays quiet. */
function isFailureEvent(e: BlackBoxEvent): boolean {
  if (e.type === "ERROR") return true;
  if (e.type === "BUILD_TEST" || e.type === "COMMAND") {
    const code = detailsOf(e).exitCode;
    return typeof code === "number" && code !== 0;
  }
  return false;
}

function isTestCommand(command: string | undefined): boolean {
  return /\btest\b|jest|vitest|mocha|pytest|\.test\.|\.spec\./i.test(command ?? "");
}

function glyphKind(e: BlackBoxEvent): EventGlyphKind {
  switch (e.type) {
    case "ERROR":
      return "error";
    case "GIT":
      return "git";
    case "COMMAND":
      return "command";
    case "BUILD_TEST":
      return isTestCommand(detailsOf(e).command) ? "test" : "build";
    case "FILE": {
      const base = basename(e.path || e.summary.split(" ").pop() || "");
      return base.includes(".") ? "file" : "folder";
    }
    default:
      return "file";
  }
}

function basename(p: string): string {
  const parts = p.split(/[\\/]/);
  return parts[parts.length - 1] || p;
}

/** The event type is shown exactly once per row, in the tag. */
function typeTag(e: BlackBoxEvent): string {
  switch (e.type) {
    case "BUILD_TEST":
      return isTestCommand(detailsOf(e).command) ? "Test" : "Build";
    case "FILE":
      return `File · ${detailsOf(e).changeType ?? "modified"}`;
    case "COMMAND":
      return "Command";
    case "ERROR":
      return "Error";
    case "GIT":
      return "Git";
    default:
      return "Event";
  }
}

/** Failure label chip: "exit 1" for command/build failures, "Failed" for errors. */
function failureChip(e: BlackBoxEvent): string | null {
  if (!isFailureEvent(e)) return null;
  if (e.type === "ERROR") return "Failed";
  const code = detailsOf(e).exitCode;
  return typeof code === "number" ? `exit ${code}` : "Failed";
}

/**
 * Main line for a row, with the type/status prefix stripped so the text is
 * never repeated between the tag and the body (e.g. "MODIFIED .agents"
 * alongside a redundant ".agents" sub-line).
 */
function rowMain(e: BlackBoxEvent): string {
  const d = detailsOf(e);
  switch (e.type) {
    case "FILE":
      // summary = "MODIFIED name" — tag carries type + status, body carries the name.
      return e.summary.replace(/^(CREATED|MODIFIED|DELETED)\s+/, "");
    case "COMMAND":
      return e.summary.replace(/^COMMAND\s+/, "");
    case "BUILD_TEST": {
      const cmd = d.command ? String(d.command).slice(0, 120) : "";
      if (cmd) return cmd;
      return d.exitCode === 0 ? "Build passed" : `Build failed (exit ${d.exitCode ?? "?"})`;
    }
    case "ERROR":
      return e.summary.replace(/^ERROR\s+/, "");
    case "GIT":
      return e.summary.replace(/^GIT\s+/, "");
    default:
      return e.summary;
  }
}

/** Secondary line — only where it adds information the body does not have. */
function rowSub(e: BlackBoxEvent): string {
  const d = detailsOf(e);
  switch (e.type) {
    case "BUILD_TEST":
      // Body already shows the command; show nothing extra when absent.
      return "";
    case "GIT":
      return d.branch ? `branch: ${d.branch}` : "";
    default:
      return "";
  }
}

function formatTime(ts: string): string {
  try {
    const d = new Date(ts);
    if (isNaN(d.getTime())) return ts;
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  } catch {
    return ts;
  }
}

function secondKey(ts: string): string {
  return formatTime(ts);
}

/* ---------- inline evidence trail (A4) ---------- */

interface TrailStep {
  key: string;
  label: string;
  detail?: string;
}

/**
 * Build failed -> File changed -> Error match -> Evidence -> Likely root cause,
 * including only the steps for which data exists.
 */
function evidenceTrail(
  e: BlackBoxEvent,
  all: BlackBoxEvent[],
  investigation?: TrailInvestigation
): TrailStep[] {
  const steps: TrailStep[] = [];
  const first = e.type === "BUILD_TEST" ? "Build failed" : e.type === "COMMAND" ? "Command failed" : "Error captured";
  steps.push({ key: "failed", label: first });

  const myTime = new Date(e.timestamp).getTime();
  const before = all.filter((x) => x.id !== e.id && !isNaN(new Date(x.timestamp).getTime()) && new Date(x.timestamp).getTime() <= myTime);

  const lastFile = [...before].reverse().find((x) => x.type === "FILE");
  if (lastFile) {
    steps.push({ key: "file", label: "File changed", detail: basename(lastFile.path || rowMain(lastFile)) });
  }

  const lastError = [...before].reverse().find((x) => x.type === "ERROR");
  if (lastError) {
    steps.push({ key: "error", label: "Error match" });
  }

  if (investigation && investigation.breakdown.length > 0) {
    steps.push({ key: "evidence", label: "Evidence", detail: `${investigation.breakdown.length} signal${investigation.breakdown.length === 1 ? "" : "s"}` });
  }

  if (investigation && investigation.status === "LIKELY_ROOT_CAUSE" && investigation.topCandidates[0]) {
    steps.push({ key: "root", label: "Likely root cause", detail: basename(investigation.topCandidates[0].candidate) });
  }

  return steps;
}

/* ---------- rows (with same-second file grouping) ---------- */

type Row =
  | { kind: "event"; e: BlackBoxEvent }
  | { kind: "group"; key: string; second: string; items: BlackBoxEvent[] };

function buildRows(filtered: BlackBoxEvent[]): Row[] {
  const fileCountBySecond = new Map<string, number>();
  for (const e of filtered) {
    if (e.type !== "FILE") continue;
    const k = secondKey(e.timestamp);
    fileCountBySecond.set(k, (fileCountBySecond.get(k) ?? 0) + 1);
  }

  const rows: Row[] = [];
  const emitted = new Set<string>();
  for (const e of filtered) {
    if (e.type === "FILE") {
      const k = secondKey(e.timestamp);
      const count = fileCountBySecond.get(k) ?? 0;
      if (count >= 3) {
        if (emitted.has(k)) continue;
        emitted.add(k);
        rows.push({ kind: "group", key: `g-${k}`, second: k, items: filtered.filter((f) => f.type === "FILE" && secondKey(f.timestamp) === k) });
        continue;
      }
    }
    rows.push({ kind: "event", e });
  }
  return rows;
}

function groupVerb(items: BlackBoxEvent[]): string {
  const types = new Set(items.map((i) => detailsOf(i).changeType ?? "modified"));
  if (types.size === 1) return [...types][0] ?? "changed";
  return "changed";
}

function positionPill(host: HTMLDivElement | null, activeId: TabId) {
  if (!host) return;
  const active = host.querySelector<HTMLElement>(`[data-tab-id="${activeId}"]`);
  if (!active || !host.contains(active)) {
    host.style.setProperty("--pill-x", "var(--gutter)");
    host.style.setProperty("--pill-w", "0px");
    return;
  }
  const r = active.getBoundingClientRect();
  const hr = host.getBoundingClientRect();
  const x = r.left - hr.left + r.width / 2 - r.width / 2;
  const w = r.width;
  host.style.setProperty("--pill-x", `${x}px`);
  host.style.setProperty("--pill-w", `${w}px`);
}

export function Timeline({
  events,
  isFailure,
  investigation,
  tab,
  onTabChange,
}: {
  events: BlackBoxEvent[];
  isFailure: boolean;
  investigation?: TrailInvestigation;
  tab: TabId;
  onTabChange: (t: TabId) => void;
}) {
  const active = tab;
  const setActive = onTabChange;
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const segRef = useRef<HTMLDivElement | null>(null);

  const onCopyPrompt = async (e: BlackBoxEvent) => {
    const ok = await copyText(buildAiPrompt(e, events, investigation));
    if (ok) {
      setCopiedId(e.id);
      setTimeout(() => setCopiedId(null), 1600);
    }
  };

  useEffect(() => {
    positionPill(segRef.current, active);
  }, [active]);

  useEffect(() => {
    const el = segRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => positionPill(segRef.current, active));
    observer.observe(el);
    return () => observer.disconnect();
  }, [active]);

  const filtered =
    active === "all"
      ? events
      : events.filter((e) => tabFor(e) === active);

  const rows = filtered.length ? buildRows(filtered) : [];
  // Header counts count underlying events, not grouped rows.
  const visibleCount = rows.reduce((n, r) => n + (r.kind === "group" ? r.items.length : 1), 0);

  const head = (
    <div className="timeline-head">
      <h2>Event trace</h2>
      <div className="count mono">
        {filtered.length === events.length
          ? `${events.length} event${events.length === 1 ? "" : "s"}`
          : `${visibleCount} of ${events.length} event${events.length === 1 ? "" : "s"}`}
      </div>
      <div className="segmented" ref={segRef} data-tab-id={active}>
        {TABS.map((t) => (
          <button
            key={t.id}
            data-tab-id={t.id}
            className={`seg ${active === t.id ? "active" : ""}`}
            onClick={() => setActive(t.id)}
            role="tab"
            aria-selected={active === t.id}
          >
            {t.label}
          </button>
        ))}
        <span className="seg-pill" aria-hidden="true" />
      </div>
    </div>
  );

  if (!filtered.length) {
    // "BlackBox is recording" only when there are no events at all;
    // an empty filter over existing events gets a short per-filter line.
    const noEventsOverall = events.length === 0;
    return (
      <div className="timeline">
        {head}
        <div className="timeline-body">
          <div className="evidence-rail">
            <svg className="rail-svg" viewBox="0 0 2 80" preserveAspectRatio="none" aria-hidden="true">
              <line x1="1" y1="0" x2="1" y2="76" stroke="rgba(255,255,255,0.18)" strokeWidth="1.4" />
            </svg>
            <div className="empty">
              {noEventsOverall ? (
                <>
                  <div className="empty-tile">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="empty-icon" aria-hidden="true">
                      <circle cx="12" cy="12" r="9" />
                      <circle cx="12" cy="12" r="3.2" />
                      <path d="M12 3v2M12 19v2M3 12h2M19 12h2" />
                    </svg>
                    <span className="pulse-dot" aria-hidden="true" />
                  </div>
                  <p className="empty-lead">BlackBox is recording.</p>
                  <p className="empty-body">Run a build, test, or command to begin the evidence trail.</p>
                </>
              ) : (
                <p className="empty-lead">No {EMPTY_NOUN[active]} events</p>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  const renderEventRow = (e: BlackBoxEvent, opts: { member?: boolean } = {}) => {
    const failed = isFailureEvent(e);
    const chip = failureChip(e);
    const sub = rowSub(e);
    const trail = failed ? evidenceTrail(e, events, investigation) : [];
    const showTrail = failed && trail.length > 1;
    return (
      <div className={`timeline-row ${failed ? "is-failure" : "is-passed"} ${opts.member ? "is-member" : ""}`}>
        <a className="timeline-link" href={`#event-${e.id}`} id={`event-${e.id}`}>
          <div className={`timeline-icon icon ${failed ? "is-failure" : ""}`}>
            <EventGlyph kind={glyphKind(e)} />
          </div>
          <div className="timeline-main">
            <div className="timeline-meta">
              <div className="event-tag mono">{typeTag(e)}</div>
              {chip && <span className="event-chip mono">{chip}</span>}
              <div className="event-time mono">{formatTime(e.timestamp)}</div>
            </div>
            {/* React escapes text children; do NOT HTML-escape here or
                apostrophes render as literal &#39; entities. */}
            <p className="timeline-desc">{rowMain(e)}</p>
            {sub && (
              <p className="timeline-sub mono" title={sub}>{sub}</p>
            )}
            {showTrail && (
              <div className="evidence-trail" aria-label="Evidence trail">
                {trail.map((s, i) => (
                  <span className="trail-fragment" key={s.key}>
                    {i > 0 && <span className="trail-arrow" aria-hidden="true">→</span>}
                    <span className="trail-step" data-kind={s.key}>
                      {s.label}
                      {s.detail && <span className="trail-detail mono">{s.detail}</span>}
                    </span>
                  </span>
                ))}
              </div>
            )}
          </div>
        </a>
        {failed && (
          <button
            type="button"
            className="row-copy"
            onClick={() => onCopyPrompt(e)}
            aria-label="Copy for AI agent"
          >
            {copiedId === e.id ? "Copied ✓" : "Copy for AI agent"}
          </button>
        )}
      </div>
    );
  };

  return (
    <div className="timeline">
      {head}
      <div className="timeline-body">
        <div className="evidence-rail">
          <svg className="rail-svg" viewBox="0 0 2 200" preserveAspectRatio="none" aria-hidden="true">
            <line x1="1" y1="0" x2="1" y2="196" stroke="rgba(255,255,255,0.18)" strokeWidth="1.4" />
          </svg>
          <ul className="timeline-list">
            {rows.map((row, idx) => {
              const isLast = idx === rows.length - 1;
              if (row.kind === "event") {
                const e = row.e;
                const failed = isFailureEvent(e);
                return (
                  <li key={e.id} className="row-slot" data-last={isLast ? "true" : undefined}>
                    {renderEventRow(e)}
                    {!isLast && <span className="timeline-branch" aria-hidden="true" data-failed={failed ? "true" : undefined} />}
                  </li>
                );
              }

              // Group row: 3+ file events in the same second.
              const open = !!expanded[row.key];
              const verb = groupVerb(row.items);
              return (
                <li key={row.key} className="row-slot" data-last={isLast ? "true" : undefined}>
                  <div className={`timeline-row is-group ${open ? "is-open" : ""}`}>
                    <button
                      type="button"
                      className="timeline-link group-link"
                      aria-expanded={open}
                      onClick={() => setExpanded((s) => ({ ...s, [row.key]: !s[row.key] }))}
                    >
                      <div className="timeline-icon icon">
                        <EventGlyph kind="folder" />
                      </div>
                      <div className="timeline-main">
                        <p className="timeline-desc group-label">
                          <span className="group-caret" aria-hidden="true">{open ? "▾" : "▸"}</span>
                          {" "}{row.items.length} files {verb}{" "}
                          <span className="mono group-time">· {row.second}</span>
                        </p>
                      </div>
                    </button>
                  </div>
                  {open && (
                    <div className="timeline-members">
                      {row.items.map((m) => renderEventRow(m, { member: true }))}
                    </div>
                  )}
                  {!isLast && <span className="timeline-branch" aria-hidden="true" />}
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </div>
  );
}
