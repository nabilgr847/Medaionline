// © 2026 MD Gausur Rahman Nabil. All rights reserved. MedAI Hospital.
import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./style.css";
import "./components.css";

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { err: Error | null }> {
  state = { err: null as Error | null };
  static getDerivedStateFromError(err: Error) { return { err }; }
  componentDidCatch(err: Error) { console.error("App crashed:", err); }
  render() {
    if (!this.state.err) return this.props.children;
    return <div style={{ padding: 24, fontFamily: "sans-serif", maxWidth: 640, margin: "0 auto" }}>
      <h2>MedAI could not start</h2>
      <p>Please reload the page. If this keeps happening, send this message to the site admin:</p>
      <pre style={{ whiteSpace: "pre-wrap", background: "#fff6e0", padding: 12, borderRadius: 8 }}>{String(this.state.err.message || this.state.err)}</pre>
      <button onClick={() => window.location.reload()}>Reload</button>
    </div>;
  }
}

createRoot(document.getElementById("root")!).render(<React.StrictMode><ErrorBoundary><App /></ErrorBoundary></React.StrictMode>);

// --- Native (Capacitor Android) integrations: push notifications + auto-lock ---
const cap = (window as any).Capacitor;

/**
 * Capacitor's `addListener` returns a Promise in some plugin versions and a plain handle in
 * others. Calling `.catch` on the handle threw "l.addListener(...).catch is not a function"
 * and took the whole native bootstrap down with it, so every call goes through here.
 */
function listen(plugin: any, event: string, handler: (data: any) => void) {
  try {
    const result = plugin?.addListener?.(event, handler);
    if (result && typeof result.catch === "function") result.catch(() => {});
    return result;
  } catch { return null; }
}

if (cap && typeof cap.isNativePlatform === "function" && cap.isNativePlatform()) {
  const plugins = cap.Plugins || {};

  // Push notifications. Requires google-services.json from Firebase in the
  // Android project; without it registration fails harmlessly.
  const PushNotifications = plugins.PushNotifications;
  if (PushNotifications) {
    listen(PushNotifications, "registration", (token: any) => {
      const token2 = localStorage.getItem("medai_token") || "";
      if (!token2 || !token?.value) return;
      fetch(String(import.meta.env.VITE_API_URL || "").replace(/\/$/, "") + "/api/commercial/push/register", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + token2 },
        body: JSON.stringify({ token: token.value }),
      }).catch(() => {});
    });
    listen(PushNotifications, "registrationError", (e: any) => console.warn("Push registration error:", e));
    PushNotifications.requestPermissions()
      .then((r: any) => { if (r && r.receive === "granted") return PushNotifications.register(); })
      .catch(() => {});
  }

  // Re-lock the app after it sat in the background for a while, so a locked
  // session cannot be reopened by someone else holding the phone.
  const App = plugins.App;
  const LOCK_AFTER_MS = 2 * 60 * 1000;
  let hiddenAt = 0;
  if (App) {
    listen(App, "appStateChange", (state: any) => {
      if (!state || !state.isActive) { hiddenAt = Date.now(); return; }
      if (!hiddenAt) return;
      const away = Date.now() - hiddenAt;
      hiddenAt = 0;
      const wantsLock = localStorage.getItem("medai_biometric_lock") === "1";
      const hasSession = !!localStorage.getItem("medai_token");
      if (wantsLock && hasSession && away > LOCK_AFTER_MS) window.location.reload();
    });
  }
}
