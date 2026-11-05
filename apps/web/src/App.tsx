// © 2026 MD Gausur Rahman Nabil. All rights reserved. MedAI Hospital.
import { useEffect, useState } from "react";
import { makeApi, json } from "./api";
import PatientPanel from "./PatientPanel";
import DoctorPanel from "./DoctorPanel";
import AdminPanel from "./AdminPanel";
import DoctorApply from "./DoctorApply";
import { BannerSlider, BannerContext } from "./common";

type User = { id: string; name: string; email: string; role: "patient" | "doctor" | "admin" };
const norm = (u: any): User => ({ ...u, id: u.id || u._id });

function MainApp() {
  const [token, setTokenState] = useState(localStorage.getItem("medai_token") || "");
  const [user, setUser] = useState<User | null>(null);
  const [view, setView] = useState<"home" | "apply" | "more">("home");
  const [mode, setMode] = useState("login");
  const [banner, setBanner] = useState<any>({ active: true, intervalSec: 5, slides: [{ eyebrow: "YOUR HEALTH, OUR PRIORITY", title: "Healthcare support, connected around you.", subtitle: "Organize your health journey, request clinician appointments, and understand general health information.", pills: ["Patient care", "Doctor-led review", "Secure access"], linkText: "", linkUrl: "", image: "" }] });
  useEffect(() => { makeApi("")("/banner").then((d) => d.banner && setBanner(d.banner)).catch(() => {}); }, []);
  const [email, setEmail] = useState(""); const [password, setPassword] = useState(""); const [name, setName] = useState(""); const [resetEmail, setResetEmail] = useState("");
  const [message, setMessage] = useState(""); const [pendingNote, setPendingNote] = useState<any>(null);
  const [step, setStep] = useState<"form" | "code" | "reset">("form"); const [code, setCode] = useState(""); const [newPassword, setNewPassword] = useState("");
  const api = makeApi(token);

  function setToken(t: string) { if (t) localStorage.setItem("medai_token", t); else localStorage.removeItem("medai_token"); setTokenState(t); }
  function logout() { setToken(""); setUser(null); setMessage(""); }
  useEffect(() => { if (token) api("/auth/me").then((d) => setUser(norm(d.user))).catch(() => { setToken(""); }); }, []);
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

  return <BannerContext.Provider value={banner}><div className="shell">
    <header><img src="/branding/medai-logo.svg" alt="MedAI Hospital" />
      <nav><a href="#services">Services</a><a href="#safety">Safety</a>{!user && <a href="#portal" onClick={() => setView("home")}>Sign in</a>}</nav>
      {user && <div className="row"><span className="role">{user.name} · {user.role}</span><button className="outline" onClick={logout}>Sign out</button></div>}</header>

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
        {pendingNote && <p className="warn">{pendingNote.note ? "Message from the admin team: " + pendingNote.note : "Your documents are being reviewed."} If more documents were requested, use “Send requested documents”.</p>}
      </div></section></>}

    {user && <section className="dashboard"><div className="welcome"><div><span className="eyebrow">{user.role.toUpperCase()} PORTAL</span><h1>Hello, {user.name}</h1><p>{user.role === "admin" ? "Platform operations and verification workspace" : user.role === "doctor" ? "Clinician workspace" : "Your health dashboard"}</p></div><span className="role">{user.role}</span></div>
      {message && <p className="notice" onClick={() => setMessage("")}>{message} <small>(tap to dismiss)</small></p>}
      {user.role !== "admin" && <BannerSlider banner={banner} compact where={user.role} />}
      {user.role === "patient" && <PatientPanel api={api} token={token} user={user} onToken={setToken} setMessage={setMessage} />}
      {user.role === "doctor" && <DoctorPanel api={api} token={token} user={user} onToken={setToken} setMessage={setMessage} />}
      {user.role === "admin" && <AdminPanel api={api} token={token} onToken={setToken} setMessage={setMessage} />}
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
    {ok && <a className="bannerlink" href="/">Continue</a>}</div></div>;
}

export default function App() { return window.location.pathname === "/reset-password" || resetTokenFromUrl() ? <ResetPassword /> : <MainApp />; }
