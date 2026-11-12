// © 2026 MD Gausur Rahman Nabil. All rights reserved. MedAI Hospital.
// Install the website as an app (PWA) + tell the visitor when a new version is ready.
//
// Inside the Android APK the bundle already lives on the phone, so nothing here runs.
import { useEffect, useState } from "react";
import { isNativeApp } from "./biometric";

type Prompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

const DISMISS_KEY = "medai_install_dismissed";

function standalone(): boolean {
  try {
    return window.matchMedia("(display-mode: standalone)").matches
      || (navigator as any).standalone === true;      // iOS Safari
  } catch { return false; }
}

function isIos(): boolean {
  try { return /iphone|ipad|ipod/i.test(navigator.userAgent); } catch { return false; }
}

/** True when the browser offered a real install prompt (Chrome/Edge on Android + desktop). */
export function useInstall(): { canInstall: boolean; installed: boolean; install: () => Promise<boolean>; ios: boolean } {
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [installed, setInstalled] = useState(() => standalone() || isNativeApp());

  useEffect(() => {
    const offer = (e: Event) => { e.preventDefault(); setPrompt(e as Prompt); };
    const done = () => { setInstalled(true); setPrompt(null); };
    window.addEventListener("beforeinstallprompt", offer);
    window.addEventListener("appinstalled", done);
    return () => {
      window.removeEventListener("beforeinstallprompt", offer);
      window.removeEventListener("appinstalled", done);
    };
  }, []);

  async function install(): Promise<boolean> {
    if (!prompt) return false;
    try {
      await prompt.prompt();
      const choice = await prompt.userChoice;
      setPrompt(null);
      if (choice.outcome === "accepted") { setInstalled(true); return true; }
      return false;
    } catch { return false; }
  }

  return { canInstall: !!prompt && !installed, installed, install, ios: isIos() && !installed };
}

/** One quiet invitation on the home screen — dismissed for good after the first "no". */
export function InstallCard() {
  const { canInstall, installed, install, ios } = useInstall();
  const [dismissed, setDismissed] = useState(() => {
    try { return localStorage.getItem(DISMISS_KEY) === "1"; } catch { return false; }
  });
  const [note, setNote] = useState("");
  if (installed || dismissed) return null;
  if (!canInstall && !ios) return null;

  function hide() {
    setDismissed(true);
    try { localStorage.setItem(DISMISS_KEY, "1"); } catch { /* ignore */ }
  }

  return (
    <div className="installcard">
      <div>
        <b>Keep MedAI on your phone</b>
        <p>{ios ? "Tap Share → Add to Home Screen to open MedAI like an app, without a browser bar." : "Install MedAI as an app — it opens full screen and keeps the last screens available offline."}</p>
        {note && <p className="muted small">{note}</p>}
      </div>
      <div className="row">
        {!ios && <button type="button" className="primary" onClick={async () => { const ok = await install(); if (!ok) setNote("Install was cancelled. You can try again from the menu."); }}>Install app</button>}
        <button type="button" className="link" onClick={hide}>Not now</button>
      </div>
    </div>
  );
}

/**
 * A service worker that changes while the app is open leaves the visitor on old code.
 * Offer a reload instead of letting them file a bug about a fix that is already deployed.
 */
export function UpdateToast() {
  const [ready, setReady] = useState(false);
  const [native, setNative] = useState(true);

  useEffect(() => {
    setNative(isNativeApp());
    if (!("serviceWorker" in navigator)) return;
    let reloading = false;
    const onController = () => {
      if (reloading) return;
      // First install also fires this; only react when an older controller already existed.
      if (!navigator.serviceWorker.controller) return;
      setReady(true);
    };
    navigator.serviceWorker.addEventListener("controllerchange", onController);
    // Check for a new build when the tab comes back to the foreground.
    const check = () => {
      if (document.visibilityState !== "visible") return;
      navigator.serviceWorker.getRegistration().then((r) => r?.update()).catch(() => {});
    };
    document.addEventListener("visibilitychange", check);
    return () => {
      reloading = true;
      navigator.serviceWorker.removeEventListener("controllerchange", onController);
      document.removeEventListener("visibilitychange", check);
    };
  }, []);

  if (native || !ready) return null;
  return (
    <div className="updatetoast" role="status" aria-live="polite">
      <span>A new version of MedAI is ready.</span>
      <button type="button" className="primary" onClick={() => window.location.reload()}>Reload</button>
      <button type="button" className="link" onClick={() => setReady(false)}>Later</button>
    </div>
  );
}
