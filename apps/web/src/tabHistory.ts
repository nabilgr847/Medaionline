// © 2026 MD Gausur Rahman Nabil. All rights reserved. MedAI Hospital.
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Like useState for the active dashboard tab, but every tab change is a browser-history step.
 * So the phone/browser Back button (and the Android app's Back button) returns to the previous tab
 * instead of leaving the app. At the first screen Back behaves normally (leaves the page / closes the app).
 */
export function useTabHistory(initial: string, key: string): [string, (t: string) => void] {
  const [tab, setTabState] = useState<string>(() => {
    try { const s = window.history.state; return (s && typeof s[key] === "string" && s[key]) || initial; } catch { return initial; }
  });
  const cur = useRef(tab); cur.current = tab;
  useEffect(() => {
    try { window.history.replaceState({ ...(window.history.state || {}), [key]: cur.current }, ""); } catch {}
    const onPop = (e: PopStateEvent) => { const t = e.state && e.state[key]; setTabState(typeof t === "string" && t ? t : initial); };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const setTab = useCallback((t: string) => {
    if (t === cur.current) return;
    try { window.history.pushState({ ...(window.history.state || {}), [key]: t }, ""); } catch {}
    setTabState(t);
  }, [key]);
  return [tab, setTab];
}
