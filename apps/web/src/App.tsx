// © 2026 MD Gausur Rahman Nabil. All rights reserved. MedAI Hospital.
import { AdminRecovery } from "./v38";
import { useEffect, useState } from "react";
import { makeApi, json, API, pingServer, setApiBase, clearApiBase } from "./api";
import PatientPanel from "./PatientPanel";
import DoctorPanel from "./DoctorPanel";
import AdminPanel from "./AdminPanel";
import DoctorApply from "./DoctorApply";
import { AlertCenter } from "./extras";
import { BannerSlider, BannerContext } from "./common";
import GuestConsultRoom from "./GuestConsultRoom";
import TeleVisitCall from "./TeleVisitCall";
import CommercialPanel from "./CommercialPanel";
import { biometricLockEnabled, setBiometricLockEnabled, isNativeApp, unlockWithBiometric, checkBiometrics, biometricLabel, biometricToken, saveBiometricToken, forgetBiometricToken } from "./biometric";

type User = { id: string; name: string; email: string; role: "patient" | "doctor" | "admin" };

/** Connection diagnostics are for troubleshooting only: they stay off the public sign-in
 *  page unless the visitor asks for them with ?debug=1 (Settings -> Security has the same
 *  controls once signed in). */
const DEBUG_UI = (() => { try { return new URLSearchParams(location.search).has("debug"); } catch { return false; } })();
const norm = (u: any): User => ({ ...u, id: u.id || u._id });

/** WhatsApp-style incoming call alert for patients and doctors, shown on any page of the dashboard. */
function IncomingCallBanner({ api }: { api: ReturnType<typeof makeApi> }) {
  const [call, setCall] = useState<any>(null);
  useEffect(() => {
    let live = true;
    const load = async () => {
      try {
        const d = await api("/notifications/mine");
        const n = (d.notifications || []).find((x: any) => x.type === "incoming_call" && !x.readAt && Date.now() - new Date(x.createdAt).getTime() < 90000);
        if (live) setCall(n || null);
      } catch {}
    };
    load(); const t = setInterval(load, 4000);
    return () => { live = false; clearInterval(t); };
  }, []);
  if (!call) return null;
  const done = () => { api(`/notifications/${call._id}/read`, { method: "POST", body: json({}) }).catch(() => {}); setCall(null); window.dispatchEvent(new Event("medai-badges")); };
  const answer = () => { const w = window.open(`/?call=${call.resourceId}`, `medai_call_${call.resourceId}`, "popup,width=1100,height=760"); done(); if (!w) window.location.href = `/?call=${call.resourceId}`; };
  return <div className="incomingcall" role="alert"><div><b>📞 {call.title}</b><p>{call.message.replace(" Open Appointments and press Join call.", "")}</p></div><div className="row"><button className="primary" onClick={answer}>Answer</button><button className="danger" onClick={done}>Dismiss</button></div></div>;
}

/** Stand-alone call window: /?call=<appointmentId> (opened from the dashboard or the incoming-call banner). */
function CallPage() {
  const id = new URLSearchParams(window.location.search).get("call") || "";
  const token = localStorage.getItem("medai_token") || ""; const api = makeApi(token);
  const [user, setUser] = useState<User | null>(null); const [message, setMessage] = useState(""); const [err, setErr] = useState("");
  useEffect(() => {
    if (!token) { setErr("Please sign in to MedAI first, then open the call again."); return; }
    api("/auth/me").then((d) => { const u = norm(d.user); if (u.role === "admin") setErr("Administrators join calls from Messages & calls in the admin panel."); else setUser(u); }).catch(() => setErr("Your session expired. Please sign in again."));
  }, []);
  return <div className="callpage"><header><img src="/branding/medai-logo.svg" alt="MedAI Hospital" style={{ height: 36 }} /><a href="/">Back to MedAI</a></header>
    {message && <p className="notice" onClick={() => setMessage("")}>{message}</p>}
    {err && <p className="warn">{err} <a href="/">Open MedAI</a></p>}
    {user && id && <TeleVisitCall api={api} token={token} appointmentId={id} user={user} setMessage={setMessage} standalone />}</div>;
}

/** Full-screen fingerprint / face gate shown when the Android app reopens. */
function BiometricLock({ userName, onUnlock, onSignOut }: { userName?: string; onUnlock: () => void; onSignOut: () => void }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const attempt = async () => {
    setBusy(true); setNote("");
    const r = await unlockWithBiometric();
    setBusy(false);
    if (r.ok) onUnlock();
    else if (!r.cancelled) setNote(r.reason);
  };
  useEffect(() => { attempt(); }, []);
  return <div className="biolock">
    <div className="biolock-card">
      <div className="biolock-icon" aria-hidden="true">{"\uD83D\uDD12"}</div>
      <h2>MedAI Hospital is locked</h2>
      <p className="muted">{userName ? "Welcome back, " + userName + "." : "Welcome back."} Confirm your fingerprint or face to continue.</p>
      {note && <p className="warn" role="alert">{note}</p>}
      <button className="primary" onClick={attempt} disabled={busy}>{busy ? "Waiting for fingerprint..." : "Unlock with fingerprint"}</button>
      <button className="link" onClick={onSignOut}>Sign out and use password</button>
    </div>
  </div>;
}

function MainApp() {
  const [token, setTokenState] = useState(localStorage.getItem("medai_token") || "");
  const [locked, setLocked] = useState(() => isNativeApp() && biometricLockEnabled() && !!(localStorage.getItem("medai_token") || biometricToken()));
  const [menuOpen, setMenuOpen] = useState(false);
  const [diag, setDiag] = useState<{ ok: boolean; ms: number; status?: string; base?: string; detail: string } | null>(null);
  const [pinging, setPinging] = useState(false);
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMenuOpen(false); };
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = previous; };
  }, [menuOpen]);
  const [user, setUser] = useState<User | null>(null);
  const [view, setView] = useState<"home" | "apply" | "more">("home");
  const [mode, setMode] = useState("login");
  const [banner, setBanner] = useState<any>({ active: true, intervalSec: 5, slides: [{ eyebrow: "YOUR HEALTH, OUR PRIORITY", title: "Healthcare support, connected around you.", subtitle: "Organize your health journey, request clinician appointments, and understand general health information.", pills: ["Patient care", "Doctor-led review", "Secure access"], linkText: "", linkUrl: "", image: "" }] });
  useEffect(() => { makeApi("")("/banner").then((d) => d.banner && setBanner(d.banner)).catch(() => {}); }, []);
  const [email, setEmail] = useState(""); const [password, setPassword] = useState(""); const [name, setName] = useState(""); const [resetEmail, setResetEmail] = useState("");
  const [message, setMessage] = useState(""); const [pendingNote, setPendingNote] = useState<any>(null);
  const [step, setStep] = useState<"form" | "code" | "reset">("form"); const [code, setCode] = useState(""); const [newPassword, setNewPassword] = useState("");
  // The server address shown on the sign-in screen. It is editable *before* logging in, so a
  // wrong API host can never lock a user out of their own app again.
  const [apiLabel, setApiLabel] = useState(API || "");
  const [serverInput, setServerInput] = useState(API || "");
  const [serverNote, setServerNote] = useState(""); const [serverOk, setServerOk] = useState(false);
  const [serverBusy, setServerBusy] = useState(false);
  async function saveServerAddress(e: any) {
    e?.preventDefault?.();
    setServerBusy(true); setServerNote("");
    const r = setApiBase(serverInput);
    if (!r.ok) { setServerOk(false); setServerNote(r.message); setServerBusy(false); return; }
    const p = await pingServer();
    setDiag(p); setApiLabel(p.base || serverInput); setServerOk(p.ok);
    setServerNote(p.ok ? "Saved. " + p.detail : "Saved, but " + p.detail);
    setServerBusy(false);
  }
  const nativeApp = isNativeApp();
  const [bio, setBio] = useState<{ available: boolean; type: string; reason?: string }>({ available: false, type: "none" });
  const [bioBusy, setBioBusy] = useState(false);
  const [bioNote, setBioNote] = useState("");
  const [askBio, setAskBio] = useState(false);
  useEffect(() => {
    if (!nativeApp) return;
    let alive = true;
    checkBiometrics().then((c) => {
      if (!alive) return;
      setBio(c.ok ? { available: c.available, type: c.type } : { available: false, type: "none", reason: c.reason });
    }).catch(() => { /* no native bridge in a browser build */ });
    return () => { alive = false; };
  }, [nativeApp]);

  /** Fingerprint / face sign-in: a successful device check unlocks the kept session. */
  async function signInWithBiometric() {
    setBioNote(""); setBioBusy(true);
    try {
      const saved = biometricToken();
      if (!saved) { setBioNote("Sign in with your password once; after that you can use " + biometricLabel(bio.type) + "."); return; }
      const r = await unlockWithBiometric("Sign in to MedAI Hospital");
      if (!r.ok) { if (!r.cancelled) setBioNote(r.reason); return; }
      const me = await makeApi(saved)("/auth/me");
      setToken(saved); setUser(norm(me.user));
    } catch (x: any) {
      // The kept session is gone or expired: drop it so the password path is used next time.
      forgetBiometricToken();
      setBioNote(x?.status === 401 ? "Your saved session expired. Please sign in with your password once." : (x?.message || "Fingerprint sign-in failed. Use your password."));
    } finally { setBioBusy(false); }
  }

  /** Offered right after a successful password sign-in (native app + working sensor). */
  function turnOnBiometric() {
    saveBiometricToken(localStorage.getItem("medai_token") || "");
    setBiometricLockEnabled(true);
    setAskBio(false);
  }

  // Resolve the API host once on load so the label never shows the website by mistake.
  useEffect(() => {
    let alive = true;
    pingServer().then((p) => {
      if (!alive) return;
      if (p.base) { setApiLabel(p.base); setServerInput(p.base); }
      if (!p.ok) setDiag(p);
    }).catch(() => {});
    return () => { alive = false; };
  }, []);
  async function useAutomaticServer() {
    setServerBusy(true); setServerNote("");
    clearApiBase();
    const p = await pingServer();
    setDiag(p); setApiLabel(p.base || ""); setServerOk(p.ok); setServerInput(p.base || "");
    setServerNote(p.ok ? "Automatic detection found " + p.base.replace(/^https?:\/\//, "") : "Automatic detection: " + p.detail);
    setServerBusy(false);
  }
  const api = makeApi(token);

  function setToken(t: string) { if (t) localStorage.setItem("medai_token", t); else localStorage.removeItem("medai_token"); setTokenState(t); }
  function logout() {
    setToken(""); setUser(null); setMessage("");
    forgetBiometricToken();          // a real sign-out must not leave a usable session
    setAskBio(false); setBioNote("");
  }
  // Re-runs when the session changes, so a token restored by the fingerprint lock screen or
  // by "Sign in with fingerprint" actually loads the account instead of sitting unused.
  useEffect(() => {
    if (!token) { setUser(null); return; }
    let alive = true;
    api("/auth/me")
      .then((d) => { if (alive) setUser(norm(d.user)); })
      .catch((x: any) => { if (alive && x?.status === 401) setToken(""); });
    return () => { alive = false; };
  }, [token]);
  useEffect(() => {
    if (!token || !user) return;
    const beat = () => api("/presence/heartbeat", { method: "POST", body: json({}) }).catch(() => {});
    beat(); const timer = window.setInterval(beat, 25000);
    return () => window.clearInterval(timer);
  }, [token, user?.id]);

  async function submitAuth(e: any) {
    e.preventDefault(); setMessage(""); setPendingNote(null);
    try {
      if (mode === "register") { const r = await api("/auth/register", { method: "POST", body: json({ name, email, password }) }); setMessage(r.message); setPassword(""); if (r.needsVerification) { setStep("code"); setCode(""); } else setMode("login"); return; }
      const d = await api("/auth/login", { method: "POST", body: json({ email, password }) });
      setToken(d.token); setUser(norm(d.user)); setPassword("");
      if (isNativeApp()) {
        if (biometricLockEnabled()) saveBiometricToken(d.token);
        else if (bio.available) setAskBio(true);
      }
    } catch (x: any) {
      setMessage(x.message);
      if (x.data?.status === "pending_email") { setStep("code"); setCode(""); }
      if (x.data?.role === "doctor" && x.data?.status === "pending_verification") setPendingNote({ note: x.data.note });
    }
  }
  async function verifyCode(e: any) {
    e.preventDefault(); setMessage("");
    try {
      const d = await api("/auth/verify-email", { method: "POST", body: json({ email, code: code.trim() }) });
      setCode(""); setStep("form");
      if (d.token) { setToken(d.token); setUser(norm(d.user)); setMessage(d.message); } else { setMessage(d.message); setMode("login"); }
    } catch (x: any) { setMessage(x.message); }
  }
  async function resendCode() { try { const d = await api("/auth/resend-code", { method: "POST", body: json({ email }) }); setMessage(d.message); } catch (x: any) { setMessage(x.message); } }
  async function completeReset(e: any) {
    e.preventDefault(); setMessage("");
    try { const d = await api("/auth/password-reset/complete", { method: "POST", body: json({ email: resetEmail || email, code: code.trim(), newPassword }) }); setCode(""); setNewPassword(""); setPassword(""); if (d.token) { setToken(d.token); setStep("form"); setMessage(d.message); } else { setMessage(d.message); setStep("form"); setMode("login"); } } catch (x: any) { setMessage(x.message); }
  }
  async function requestReset() { try { const d = await api("/auth/password-reset/request", { method: "POST", body: json({ email: resetEmail || email }) }); setMessage(d.message); } catch (x: any) { setMessage(x.message); } }

  if (locked) return <BiometricLock userName={user?.name}
    onUnlock={() => { const kept = localStorage.getItem("medai_token") || biometricToken(); if (kept) setToken(kept); setLocked(false); }}
    onSignOut={() => {
      // Only the active session is dropped, so "Sign in with fingerprint" still works from
      // the login page; a real sign-out (menu) removes the biometric session too.
      localStorage.removeItem("medai_token"); setTokenState(""); setUser(null); setMessage(""); setLocked(false);
    }} />;

  return <BannerContext.Provider value={banner}><div className="shell">
    <header>
      <a className="brand" href="#top" aria-label="MedAI Hospital home"><img src="/branding/medai-logo.svg" alt="MedAI Hospital" /></a>
      <nav className="desktopnav">
        <a href="#services">Services</a>
        <a href="#safety">Safety</a>
        {!user && <a href="#portal" onClick={() => setView("home")}>Sign in</a>}
        {user && <a href="#dashboard" onClick={(e) => { e.preventDefault(); document.getElementById("dashboard")?.scrollIntoView({ behavior: "smooth" }); }}>Dashboard</a>}
      </nav>
      {user && <div className="row headeruser"><span className="role">{user.name} · {user.role}</span><button className="outline" onClick={logout}>Sign out</button></div>}
      <button className="hamburger" onClick={() => setMenuOpen(true)} aria-label="Open menu" aria-expanded={menuOpen} aria-haspopup="dialog">
        <span aria-hidden="true"><i /><i /><i /></span>
        <em>Menu</em>
      </button>
    </header>

    {menuOpen && (
      <div className="drawerwrap" role="dialog" aria-modal="true" aria-label="Main menu">
        <div className="drawerbackdrop" onClick={() => setMenuOpen(false)} />
        <aside className="drawer">
          <div className="drawerhead">
            <img src="/branding/medai-logo.svg" alt="MedAI Hospital" />
            <button className="iconbtn" onClick={() => setMenuOpen(false)} aria-label="Close menu">✕</button>
          </div>

          {user ? (
            <div className="draweruser">
              <span className="avatar" aria-hidden="true">{String(user.name || "MedAI").trim().charAt(0).toUpperCase()}</span>
              <div><strong>{user.name}</strong><small>{user.email} · {user.role}</small></div>
            </div>
          ) : (
            <div className="draweruser">
              <span className="avatar" aria-hidden="true">M</span>
              <div><strong>Welcome to MedAI</strong><small>Sign in to reach your dashboard</small></div>
            </div>
          )}

          <div className="drawerlinks">
            {user && <button className="draweritem" onClick={() => { setMenuOpen(false); document.getElementById("dashboard")?.scrollIntoView({ behavior: "smooth" }); }}><span aria-hidden="true">🏠</span>Dashboard</button>}
            {!user && <button className="draweritem" onClick={() => { setMenuOpen(false); setView("home"); document.getElementById("portal")?.scrollIntoView({ behavior: "smooth" }); }}><span aria-hidden="true">🔑</span>Sign in / Create account</button>}
            <button className="draweritem" onClick={() => { setMenuOpen(false); document.getElementById("services")?.scrollIntoView({ behavior: "smooth" }); }}><span aria-hidden="true">✚</span>Services</button>
            <button className="draweritem" onClick={() => { setMenuOpen(false); document.getElementById("safety")?.scrollIntoView({ behavior: "smooth" }); }}><span aria-hidden="true">🛡️</span>Safety &amp; privacy</button>
            {!user && <button className="draweritem" onClick={() => { setMenuOpen(false); setView("apply"); }}><span aria-hidden="true">👨‍⚕️</span>Apply for a doctor account</button>}
          </div>

          <div className="drawerfoot">
            {user && <button className="primary drawerwide" onClick={() => { setMenuOpen(false); logout(); }}>Sign out</button>}
            <p>MedAI Hospital · Secure patient care</p>
          </div>
        </aside>
      </div>
    )}

    {!user && view === "apply" && <DoctorApply mode="new" onBack={() => setView("home")} />}
    {!user && view === "more" && <DoctorApply mode="more" onBack={() => setView("home")} />}
    {!user && view === "home" && <>
      <BannerSlider banner={banner} where="home" />
      <section className="auth" id="portal"><div>
        <h2>{step === "code" ? "Verify your email" : step === "reset" ? "Reset your password" : mode === "login" ? "Welcome back" : "Create your patient account"}</h2>
                {step === "form" && <>
        <form onSubmit={submitAuth}>
            {mode === "register" && <input autoComplete="name" placeholder="Full name" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} />}
            <input type="text" inputMode="email" autoComplete="username" placeholder="Email address" value={email} onChange={(e) => setEmail(e.target.value)} required />
            <input type="password" autoComplete={mode === "register" ? "new-password" : "current-password"} placeholder={mode === "register" ? "Password (minimum 12 characters)" : "Password"} value={password} onChange={(e) => setPassword(e.target.value)} required minLength={mode === "register" ? 12 : 1} />
            {mode === "register" && <p className="muted">We will email a 6-digit code to verify your email address.</p>}
            <button className="primary">{mode === "login" ? "Sign in" : "Send verification code"}</button></form>
          {mode === "login" && nativeApp && biometricLockEnabled() && (
            <div className="biologin">
              <button type="button" className="outline biobtn" disabled={bioBusy} onClick={signInWithBiometric}>
                {bioBusy ? "Waiting for " + biometricLabel(bio.type) + "\u2026" : "Sign in with " + biometricLabel(bio.type)}
              </button>
              {bioNote && <p className="warn small" role="alert">{bioNote}</p>}
            </div>
          )}
          {mode === "login" && askBio && (
            <div className="bioask">
              <b>Use {biometricLabel(bio.type)} next time?</b>
              <p className="muted small">Unlock MedAI with {biometricLabel(bio.type)} instead of typing your password. You can switch this off any time in Settings, Security.</p>
              <div className="row"><button type="button" className="primary" onClick={turnOnBiometric}>Turn on</button><button type="button" className="outline" onClick={() => setAskBio(false)}>Not now</button></div>
            </div>
          )}
          <button className="link" onClick={() => { setMode(mode === "login" ? "register" : "login"); setMessage(""); }}>{mode === "login" ? "Create a patient account" : "Back to sign in"}</button>
          <div className="doctorbox"><b>Are you a doctor?</b><div className="row"><button className="outline" onClick={() => { setView("apply"); setMessage(""); }}>Apply for a doctor account</button><button className="outline" onClick={() => { setView("more"); setMessage(""); }}>Send requested documents</button></div></div>
          {mode === "login" && <button className="link" onClick={() => { setStep("reset"); setResetEmail(email); setCode(""); setNewPassword(""); setMessage(""); }}>Forgot password?</button>}
        </>}
        {step === "code" && <form onSubmit={verifyCode}>
          <p className="muted">Enter the 6-digit code we emailed to <b>{email}</b>. It is valid for 10 minutes. Check the spam folder if you do not see it.</p>
          <input inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="6-digit code" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} required />
          <button className="primary">Verify and create account</button>
          <div className="row"><button type="button" className="outline" onClick={resendCode}>Send a new code</button><button type="button" className="link" onClick={() => { setStep("form"); setMessage(""); }}>Back</button></div>
        </form>}
        {step === "reset" && <form onSubmit={completeReset}>
          <input type="email" placeholder="Your account email" value={resetEmail} onChange={(e) => setResetEmail(e.target.value)} required />
          <button type="button" className="outline" onClick={requestReset}>Email me a reset code</button>
          <input inputMode="numeric" maxLength={6} placeholder="6-digit code from the email" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} required />
          <input type="password" autoComplete="new-password" minLength={14} placeholder="New password (minimum 14 characters)" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required />
          <button className="primary">Set new password</button>
          <button type="button" className="link" onClick={() => { setStep("form"); setMessage(""); }}>Back to sign in</button>
        </form>}
        {message && <p className="notice" role="status" aria-live="polite">{message}</p>}
        {DEBUG_UI && <>
        <div className="servercheck">
          <span>Server: <code>{apiLabel ? apiLabel.replace(/^https?:\/\//, "") : "not configured in this build"}</code></span>
          <button type="button" className="link" disabled={pinging} onClick={async () => { setPinging(true); const p = await pingServer(); setDiag(p); if (p.base) setApiLabel(p.base); setPinging(false); }}>
            {pinging ? "Testing…" : "Test connection"}
          </button>
          {diag && <span className={diag.ok ? "ok" : diag.status === "blocked" || diag.status === "notapi" ? "warn" : "bad"}>{diag.detail}</span>}
        </div>
        <details className="serverfix">
          <summary>Server address</summary>
          <form onSubmit={saveServerAddress}>
            <input type="url" inputMode="url" autoComplete="off" spellCheck={false} placeholder="https://your-api.onrender.com" value={serverInput} onChange={(e) => setServerInput(e.target.value)} />
            <div className="row">
              <button className="primary" disabled={serverBusy}>{serverBusy ? "Checking…" : "Save and test"}</button>
              <button type="button" className="outline" disabled={serverBusy} onClick={useAutomaticServer}>Automatic</button>
            </div>
          </form>
          <p className="muted small">MedAI Hospital has two services on Render: the <b>API</b> (backend) and the <b>website</b> (frontend). Enter the API address — it answers <code>/api/health</code> with JSON.</p>
          {serverNote && <p className={serverOk ? "ok small" : "warn small"}>{serverNote}</p>}
        </details>
        </>}
        {pendingNote && <p className="warn">{pendingNote.note ? "Message from the admin team: " + pendingNote.note : "Your documents are being reviewed."} If more documents were requested, use “Send requested documents”.</p>}
      </div></section></>}

    {user && user.role !== "admin" && <AlertCenter api={api} />}
    {user && user.role !== "admin" && <IncomingCallBanner api={api} />}
    {user && <section className="dashboard" id="dashboard"><div className="welcome"><div><span className="eyebrow">{user.role.toUpperCase()} PORTAL</span><h1>Hello, {user.name}</h1><p>{user.role === "admin" ? "Platform operations and verification workspace" : user.role === "doctor" ? "Clinician workspace" : "Your health dashboard"}</p></div><span className="role">{user.role}</span></div>
      {message && <p className="notice" onClick={() => setMessage("")}>{message} <small>(tap to dismiss)</small></p>}
      {user.role !== "admin" && <BannerSlider banner={banner} compact where={user.role} />}
      {user.role === "patient" && <PatientPanel api={api} token={token} user={user} onToken={setToken} setMessage={setMessage} />}
      {user.role === "doctor" && <DoctorPanel api={api} token={token} user={user} onToken={setToken} setMessage={setMessage} />}
      {user.role === "admin" && <AdminPanel api={api} user={user} token={token} onToken={setToken} setMessage={setMessage} />}
      {user && <CommercialPanel api={api} token={token} user={user} onToken={setToken} setMessage={setMessage} />}
    </section>}

    <section id="services"><p className="eyebrow">CARE, CONNECTED</p><h2>Tools to support your health journey</h2><div className="grid three"><article><div className="service-icon" aria-hidden="true">▤</div><h3>Medical report hub</h3><p>Organize private reports and share them only through authorized care workflows.</p></article><article><div className="service-icon" aria-hidden="true">✚</div><h3>Doctor consultation</h3><p>Appointment requests, clinician messaging and doctor-written prescriptions.</p></article><article><div className="service-icon" aria-hidden="true">♡</div><h3>Medicine information</h3><p>Structured medicine information for review. MedAI does not independently prescribe treatment.</p></article></div></section>
    <section id="safety"><p className="eyebrow">SAFETY BY DESIGN</p><h2>Clinical safety comes first</h2><p>MedAI provides general health information and organization tools. It is not a diagnosis, a substitute for a qualified clinician, or an emergency service. For severe breathing difficulty, chest pain, stroke symptoms, unconsciousness, or severe bleeding, seek emergency care immediately. In Bangladesh, call 999.</p></section>
    <footer><img src="/branding/medai-logo.svg" alt="" /><p>MedAI Hospital · Your Health, Our Priority</p><p className="copyright">© {new Date().getFullYear() < 2026 ? 2026 : new Date().getFullYear()} MD Gausur Rahman Nabil. All rights reserved.</p></footer></div></BannerContext.Provider>;
}

function resetTokenFromUrl() { const q = new URLSearchParams(window.location.search); return q.get("reset") || q.get("token") || ""; }

function ResetPassword() {
  const [password, setPassword] = useState(""); const [confirm, setConfirm] = useState(""); const [show, setShow] = useState(false);
  const [message, setMessage] = useState(""); const [ok, setOk] = useState(false); const [busy, setBusy] = useState(false);
  const rules = [["At least 14 characters", password.length >= 14], ["Passwords match", password.length > 0 && password === confirm]] as const;
  async function submit(e: any) {
    e.preventDefault(); if (!rules.every((r) => r[1])) { setMessage("Please meet all the requirements below."); return; }
    setBusy(true); setMessage("");
    try { const d = await makeApi("")("/auth/password-reset/complete", { method: "POST", body: json({ token: resetTokenFromUrl(), newPassword: password }) }); setMessage(d.message); setOk(true); if (d.token) { localStorage.setItem("medai_token", d.token); setTimeout(() => window.location.replace("/"), 1200); } else window.history.replaceState({}, "", "/"); }
    catch (x: any) { setMessage(x.message); } finally { setBusy(false); }
  }
  return <div className="auth"><div><img src="/branding/medai-logo.svg" alt="MedAI Hospital" style={{ width: 180, marginBottom: 14 }} /><h2>Choose a new password</h2>
    {!resetTokenFromUrl() && !ok && <p className="warn">This reset link is incomplete. Open the link from your email again, or request a new one from the sign-in page.</p>}
    {!ok && <form onSubmit={submit}>
      <input type={show ? "text" : "password"} autoComplete="new-password" placeholder="New password" value={password} onChange={(e) => setPassword(e.target.value)} required />
      <input type={show ? "text" : "password"} autoComplete="new-password" placeholder="Confirm new password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
      <label className="check"><input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} /> Show password</label>
      <ul className="rules">{rules.map(([t, v]) => <li key={t} className={v ? "ok" : ""}>{v ? "✓" : "○"} {t}</li>)}</ul>
      <button className="primary" disabled={busy}>{busy ? "Saving…" : "Set new password"}</button></form>}
    {message && <p className={ok ? "notice" : "warn"} role="status" aria-live="polite">{message}</p>}
    {ok ? <a className="bannerlink" href="/">Continue to MedAI</a> : <p className="muted small"><a href="/">← Back to sign in</a></p>}</div></div>;
}

export default function App() { const q=new URLSearchParams(window.location.search); return q.has("recovery") ? <AdminRecovery /> : q.has("consult") ? <GuestConsultRoom /> : q.has("call") ? <CallPage /> : window.location.pathname === "/reset-password" || resetTokenFromUrl() ? <ResetPassword /> : <MainApp />; }
