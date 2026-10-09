import { useEffect, useState } from "react";

export function useCursorGlow() {
  const [g, setG] = useState<{ x: number; y: number; active: boolean }>({ x: 0.5, y: 0.5, active: false });

  useEffect(() => {
    const isTouch = window.matchMedia("(hover: none), (pointer: coarse)").matches;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (isTouch || reducedMotion) {
      setG((g) => ({ ...g, active: g.active }));
      return;
    }

    let rafId: number | null = null;
    function paint(x: number, y: number) {
      setG((g) => ({ ...g, x, y, active: true }));
    }

    function onPointerMove(e: PointerEvent) {
      if (rafId != null) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => paint(e.clientX, e.clientY));
    }

    function onPointerLeave() {
      setG((g) => ({ ...g, active: false }));
    }

    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("pointerleave", onPointerLeave, { passive: true });

    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerleave", onPointerLeave);
      if (rafId != null) cancelAnimationFrame(rafId);
    };
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    const isTouch = window.matchMedia("(hover: none), (pointer: coarse)").matches;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    root.classList.toggle("no-touch", isTouch || reducedMotion);

    if (g.active && !reducedMotion) {
      root.style.setProperty("--mx", `${g.x}px`);
      root.style.setProperty("--my", `${g.y}px`);
    } else {
      root.style.setProperty("--mx", "50%");
      root.style.setProperty("--my", "50%");
    }
  }, [g]);
}
