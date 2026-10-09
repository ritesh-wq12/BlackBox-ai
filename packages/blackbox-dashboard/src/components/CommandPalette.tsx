import { useEffect, useMemo, useRef, useState } from "react";
import "./CommandPalette.css";
import type { TabId } from "./Timeline";

export interface PaletteAction {
  id: string;
  label: string;
  hint?: string;
  run: () => void;
}

/** Cmd/Ctrl+K command palette. Runs only actions the app already exposes. */
export function CommandPalette({
  open,
  actions,
  onClose,
}: {
  open: boolean;
  actions: PaletteAction[];
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      setSel(0);
      // focus after paint
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return actions;
    return actions.filter(
      (a) => a.label.toLowerCase().includes(q) || (a.hint ?? "").toLowerCase().includes(q)
    );
  }, [query, actions]);

  useEffect(() => {
    setSel(0);
  }, [query]);

  if (!open) return null;

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSel((s) => Math.min(s + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSel((s) => Math.max(s - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const action = filtered[sel];
      if (action) {
        onClose();
        action.run();
      }
    }
  };

  return (
    <div className="palette" role="dialog" aria-modal="true" aria-label="Command palette">
      <div className="palette__backdrop" onClick={onClose} />
      <div className="palette__panel">
        <input
          ref={inputRef}
          className="palette__input"
          placeholder="Type a command…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          aria-label="Command palette input"
        />
        <ul className="palette__list">
          {filtered.map((a, i) => (
            <li key={a.id}>
              <button
                type="button"
                className={`palette__item ${i === sel ? "is-sel" : ""}`}
                onMouseEnter={() => setSel(i)}
                onClick={() => {
                  onClose();
                  a.run();
                }}
              >
                <span className="palette__label">{a.label}</span>
                {a.hint && <span className="palette__hint mono">{a.hint}</span>}
              </button>
            </li>
          ))}
          {filtered.length === 0 && <li className="palette__empty">No matching command</li>}
        </ul>
        <div className="palette__foot mono">
          ↑↓ move · Enter run · Esc close · ⌘K / Ctrl+K toggle
        </div>
      </div>
    </div>
  );
}

export interface ShortcutItem {
  keys: string;
  desc: string;
}

/** Small "?" help overlay listing the keyboard shortcuts. */
export function HelpOverlay({
  open,
  shortcuts,
  onClose,
}: {
  open: boolean;
  shortcuts: ShortcutItem[];
  onClose: () => void;
}) {
  if (!open) return null;
  return (
    <div className="help-overlay" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts">
      <div className="help-overlay__backdrop" onClick={onClose} />
      <div className="help-overlay__panel">
        <div className="help-overlay__head">
          <span className="help-overlay__title">Keyboard shortcuts</span>
          <button className="help-overlay__close" onClick={onClose}>
            Close
          </button>
        </div>
        <ul className="help-overlay__list">
          {shortcuts.map((s) => (
            <li key={s.keys}>
              <kbd className="mono">{s.keys}</kbd>
              <span>{s.desc}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export const FILTER_TABS: { id: TabId; label: string }[] = [
  { id: "all", label: "All" },
  { id: "build", label: "Build" },
  { id: "file", label: "Files" },
  { id: "command", label: "Commands" },
  { id: "error", label: "Errors" },
  { id: "git", label: "Git" },
];
