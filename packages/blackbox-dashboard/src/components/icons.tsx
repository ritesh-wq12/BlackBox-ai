export function IconPause(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <rect x="6" y="4" width="4" height="16" rx="1" />
      <rect x="14" y="4" width="4" height="16" rx="1" />
    </svg>
  );
}

export function IconPlay(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d="M8 5.5v13l11-6.5-11-6.5z" />
    </svg>
  );
}

export function IconStop(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <rect x="5" y="5" width="14" height="14" rx="2" />
    </svg>
  );
}

/** Distinct 16px line glyphs for timeline event kinds. */
export type EventGlyphKind = "file" | "folder" | "command" | "build" | "test" | "error" | "git";

export function EventGlyph({ kind }: { kind: EventGlyphKind }) {
  const common = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.6,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true as const,
    className: "event-glyph",
    width: 16,
    height: 16,
  };
  switch (kind) {
    case "file":
      return (
        <svg {...common}>
          <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
          <path d="M14 3v5h5" />
        </svg>
      );
    case "folder":
      return (
        <svg {...common}>
          <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        </svg>
      );
    case "command":
      return (
        <svg {...common}>
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <path d="M7 9l3 3-3 3M13 15h4" />
        </svg>
      );
    case "build":
      return (
        <svg {...common}>
          <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" />
          <path d="M12 12l8-4.5M12 12v9M12 12L4 7.5" />
        </svg>
      );
    case "test":
      return (
        <svg {...common}>
          <path d="M9 3h6M10 3v6l-5 8.2A2 2 0 0 0 6.7 20h10.6a2 2 0 0 0 1.7-2.8L14 9V3" />
          <path d="M8 15h8" />
        </svg>
      );
    case "error":
      return (
        <svg {...common}>
          <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
          <path d="M12 9v4M12 17h.01" />
        </svg>
      );
    case "git":
      return (
        <svg {...common}>
          <circle cx="6" cy="6" r="2" />
          <circle cx="6" cy="18" r="2" />
          <circle cx="18" cy="8" r="2" />
          <path d="M6 8v8M8 6h5a5 5 0 0 1 5 5v0" />
        </svg>
      );
    default:
      return null;
  }
}
