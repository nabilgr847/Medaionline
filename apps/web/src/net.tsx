// © 2026 MD Gausur Rahman Nabil. All rights reserved. MedAI Hospital.
// Connection banner.
//
// Render's free/starter containers sleep after a quiet period, so the first request of the
// day can take 30-60 seconds. Before this, the app printed "check your connection" and the
// patient had to guess. Now it says what is actually happening and retries by itself.
import { useEffect, useRef, useState } from "react";
import { onNetwork, pingServer, type NetState } from "./api";

/** navigator.onLine, kept in sync with the browser's online/offline events. */
export function useOnline(): boolean {
  const [online, setOnline] = useState(() => {
    try { return navigator.onLine !== false; } catch { return true; }
  });
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);
  return online;
}

export function ConnectionBar() {
  const online = useOnline();
  const [state, setState] = useState<NetState>("ok");
  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState("");
  // "waking" is normal for a second or two on a fast connection: do not flash a banner for it.
  const [showWaking, setShowWaking] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(() => onNetwork(setState), []);

  useEffect(() => {
    if (timer.current) { window.clearTimeout(timer.current); timer.current = null; }
    if (state === "waking") {
      timer.current = window.setTimeout(() => setShowWaking(true), 1600);
    } else {
      setShowWaking(false);
    }
    return () => { if (timer.current) window.clearTimeout(timer.current); };
  }, [state]);

  // Coming back online: probe right away instead of waiting for the next user action.
  useEffect(() => {
    if (!online) return;
    let alive = true;
    pingServer().then((p) => { if (alive && !p.ok) setDetail(p.detail); }).catch(() => {});
    return () => { alive = false; };
  }, [online]);

  async function retry() {
    setBusy(true);
    setDetail("");
    try {
      const p = await pingServer();
      if (p.ok) window.dispatchEvent(new Event("medai-reconnected"));
      else setDetail(p.detail);
    } finally {
      setBusy(false);
    }
  }

  if (!online) {
    return (
      <div className="connectionbar offline" role="status" aria-live="polite">
        <span aria-hidden="true">📴</span>
        <div><b>You are offline</b><p>MedAI will send your saved actions as soon as the connection is back. Nothing is lost.</p></div>
      </div>
    );
  }

  if (state === "down") {
    return (
      <div className="connectionbar bad" role="alert">
        <span aria-hidden="true">⚠️</span>
        <div>
          <b>The MedAI server is not answering</b>
          <p>{detail || "It may be waking up from sleep — this can take up to a minute."}</p>
        </div>
        <button type="button" className="primary" disabled={busy} onClick={retry}>{busy ? "Trying…" : "Retry"}</button>
      </div>
    );
  }

  if (state === "waking" && showWaking) {
    return (
      <div className="connectionbar waking" role="status" aria-live="polite">
        <span className="spinner" aria-hidden="true" />
        <div><b>Waking the MedAI server</b><p>It sleeps when idle. This usually finishes in under a minute — keep this screen open.</p></div>
      </div>
    );
  }

  return null;
}
