/** Builds markdown prompts/reports from data already present in the UI.
 *  Nothing here fetches, derives or invents new evidence. */

export interface PromptEvent {
  id: string;
  type: string;
  timestamp: string;
  summary: string;
  path: string;
  project: string;
  details: {
    exitCode?: number;
    error?: string;
    command?: string;
    stderr?: string;
    changeType?: string;
    branch?: string;
    message?: string;
  };
}

export interface PromptInvestigation {
  score: number;
  status: string;
  breakdown: { point: string; eventId: string }[];
  topCandidates: { candidate: string; score: number }[];
  chain: string[];
  diff?: string;
  error?: string;
  aiExplanation?: string;
}

export function isFailureEvent(e: PromptEvent): boolean {
  if (e.type === "ERROR") return true;
  if (e.type === "BUILD_TEST" || e.type === "COMMAND") {
    return typeof e.details.exitCode === "number" && e.details.exitCode !== 0;
  }
  return false;
}

/** Markdown prompt a user can paste into Cursor / Claude Code / Copilot. */
export function buildAiPrompt(
  failure: PromptEvent,
  allEvents: PromptEvent[],
  investigation?: PromptInvestigation
): string {
  const lines: string[] = [];
  const before = allEvents.filter(
    (x) => x.id !== failure.id && new Date(x.timestamp).getTime() <= new Date(failure.timestamp).getTime()
  );
  const lastFile = [...before].reverse().find((x) => x.type === "FILE");
  const lastError = [...before].reverse().find((x) => x.type === "ERROR");

  lines.push("# BlackBox failure report");
  lines.push("");
  lines.push("You are debugging a build/test failure. The facts below were");
  lines.push("recorded deterministically by Digital BlackBox. Use them as");
  lines.push("ground truth; say so if you need more information.");
  lines.push("");
  lines.push("## Error");
  lines.push("- **When:** " + failure.timestamp);
  lines.push("- **Event:** " + failure.summary);
  if (failure.details.command) lines.push("- **Command:** `" + failure.details.command + "`");
  if (typeof failure.details.exitCode === "number") lines.push("- **Exit code:** " + failure.details.exitCode);
  const errText = failure.details.stderr || failure.details.error || failure.details.message;
  if (errText) {
    lines.push("");
    lines.push("```");
    lines.push(String(errText).slice(0, 4000));
    lines.push("```");
  }
  if (lastError && lastError !== failure) {
    lines.push("");
    lines.push("## Matched error event");
    lines.push("- " + lastError.summary);
  }

  lines.push("");
  lines.push("## Changed file");
  if (lastFile) {
    lines.push("- **Path:** " + (lastFile.path || lastFile.summary));
    lines.push("- **Change:** " + (lastFile.details.changeType ?? "modified") + " at " + lastFile.timestamp);
  } else {
    lines.push("- No file change was recorded before this failure.");
  }

  if (investigation) {
    if (investigation.diff) {
      lines.push("");
      lines.push("## Git diff");
      lines.push("```diff");
      lines.push(investigation.diff.slice(0, 8000));
      lines.push("```");
    }
    if (investigation.breakdown.length) {
      lines.push("");
      lines.push("## Evidence (deterministic)");
      for (const b of investigation.breakdown) lines.push("- " + b.point);
    }
    lines.push("");
    lines.push("## Suspected cause");
    lines.push(
      "- " +
        investigation.status +
        " — " +
        investigation.score +
        "% confidence" +
        (investigation.topCandidates[0]
          ? " → `" + investigation.topCandidates[0].candidate + "`"
          : "")
    );
  } else {
    lines.push("");
    lines.push("## Suspected cause");
    lines.push("- Not yet investigated in the dashboard (run Investigate to add evidence).");
  }

  return lines.join("\n");
}

/** Full investigation report for the "Export report" download. */
export function buildReportMarkdown(
  investigation: PromptInvestigation,
  events: PromptEvent[]
): string {
  const lines: string[] = [];
  lines.push("# BlackBox failure investigation report");
  lines.push("");
  lines.push("- **Generated:** " + new Date().toISOString());
  lines.push("- **Outcome:** " + investigation.status);
  lines.push("- **Confidence:** " + investigation.score + "%");
  lines.push("");

  lines.push("## Evidence (deterministic)");
  if (investigation.breakdown.length) {
    for (const b of investigation.breakdown) lines.push("- " + b.point + " (" + b.eventId + ")");
  } else {
    lines.push("- No evidence signals matched.");
  }
  lines.push("");

  if (investigation.topCandidates.length) {
    lines.push("## Candidates");
    for (const c of investigation.topCandidates) lines.push("- " + c.candidate + " — " + c.score + "%");
    lines.push("");
  }

  lines.push("## Chain");
  for (const step of investigation.chain) lines.push("- " + step);
  lines.push("");

  if (investigation.error) {
    lines.push("## Error");
    lines.push("```");
    lines.push(investigation.error.slice(0, 4000));
    lines.push("```");
    lines.push("");
  }

  if (investigation.diff) {
    lines.push("## Git diff");
    lines.push("```diff");
    lines.push(investigation.diff.slice(0, 8000));
    lines.push("```");
    lines.push("");
  }

  if (investigation.aiExplanation) {
    lines.push("## Explanation (AI-written — not proof)");
    lines.push(investigation.aiExplanation);
    lines.push("");
  }

  lines.push("## Timeline (" + events.length + " recorded events)");
  for (const e of events) {
    const status =
      typeof e.details.exitCode === "number" ? " (exit " + e.details.exitCode + ")" : "";
    lines.push("- " + e.timestamp + " · " + e.type + " · " + e.summary + status);
  }
  lines.push("");

  return lines.join("\n");
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}

export function downloadMarkdown(filename: string, markdown: string): void {
  const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
