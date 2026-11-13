// © 2026 MD Gausur Rahman Nabil. All rights reserved. MedAI Hospital.
// Phone and desktop are different products: the same component can now ask which one it
// is rendering for instead of relying on CSS alone (some layouts, not just sizes, differ).
import { useEffect, useState } from "react";

export type ViewKind = "mobile" | "tablet" | "desktop";

function read(): ViewKind {
  if (typeof window === "undefined") return "desktop";
  const w = window.innerWidth || 1024;
  if (w < 768) return "mobile";
  if (w < 1100) return "tablet";
  return "desktop";
}

/** Current view kind, updated on rotate/resize. */
export function useView(): ViewKind {
  const [view, setView] = useState<ViewKind>(read);
  useEffect(() => {
    let frame = 0;
    const onResize = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => setView(read()));
    };
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
    };
  }, []);
  return view;
}

export const isPhone = (v: ViewKind) => v === "mobile";
