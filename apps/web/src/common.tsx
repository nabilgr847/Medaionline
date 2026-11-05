import { useEffect, useState } from "react";
import { Api, json, fmtDate } from "./api";

const ICONS: Record<string, string> = { appointments: "📅", requests: "📥", rx: "💊", reports: "📄", notifications: "🔔", profile: "👤", nearby: "📍", medicines: "🔎", ai: "🤖", account: "⚙️", doctors: "✅", users: "👥", monitor: "📡", import: "⬆️", banner: "🖼️", security: "🔒", resets: "🔑" };

export function Tabs({ tabs, tab, setTab, badges }: { tabs: [string, string][]; tab: string; setTab: (t: string) => void; badges?: Record<string, number> }) {
  return <div className="tabs">{tabs.map(([id, text]) => <button key={id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}>
    {ICONS[id] ? ICONS[id] + " " : ""}{text}{badges && badges[id] > 0 && <span className="reddot" aria-label={badges[id] + " new"}>{badges[id] > 9 ? "9+" : badges[id]}</span>}</button>)}</div>;
}

// Red-dot counters shown on tab buttons. Polls every 30 s and when the tab regains focus.
export function useBadges(api: Api, role: "patient" | "doctor" | "admin"): Record<string, number> {
  const [b, setB] = useState<Record<string, number>>({});
  useEffect(() => {
    let live = true;
    async function load() {
      const next: Record<string, number> = {};
      try {
        if (role !== "admin") { const d = await api("/notifications/mine"); next.notifications = (d.notifications || []).filter((n: any) => !n.readAt).length; }
        if (role === "doctor") { const d = await api("/doctor/unassigned-appointment-requests"); next.requests = (d.requests || []).length; }
        if (role === "admin") { const d = await api("/admin/doctors/pending"); next.doctors = (d.applications || []).length; const r = await api("/admin/password-requests?status=pending"); next.resets = (r.requests || []).length; const sg = await api("/admin/recent-signups"); next.resets += (sg.users || []).filter((u: any) => u.status === "pending_approval").length; }
      } catch { /* badges are best-effort */ }
      if (live) setB(next);
    }
    load(); const t = setInterval(load, 30000); const f = () => { if (!document.hidden) load(); };
    document.addEventListener("visibilitychange", f);
    return () => { live = false; clearInterval(t); document.removeEventListener("visibilitychange", f); };
  }, [role]);
  return b;
}

const dayKey = (iso: string) => new Date(iso).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
const timeKey = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

// Shows only the doctor's free (published and not yet booked) times. Nothing outside them can be picked.
export function SlotPicker({ api, doctorId, value, onChange, fallback }: { api: Api; doctorId: string; value: string; onChange: (iso: string) => void; fallback?: any }) {
  const [slots, setSlots] = useState<string[]>([]); const [loading, setLoading] = useState(true); const [day, setDay] = useState("");
  useEffect(() => {
    let live = true; setLoading(true);
    api(`/doctors/${doctorId}/free-slots`).then((d) => { if (!live) return; const s: string[] = d.slots || []; setSlots(s); setDay(s.length ? dayKey(value && s.includes(value) ? value : s[0]) : ""); })
      .catch(() => { if (live) setSlots([]); }).finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [doctorId]);
  useEffect(() => { if (value && slots.includes(value)) setDay(dayKey(value)); }, [value]);
  if (loading) return <p className="muted">Loading free times…</p>;
  if (!slots.length) return fallback ?? <p className="muted">This doctor has no free times published right now. Send the request and the doctor will suggest a time.</p>;
  const days = Array.from(new Set(slots.map(dayKey)));
  return <div className="slotpicker">
    <label>Day<select value={day} onChange={(e) => { setDay(e.target.value); onChange(""); }}>{days.map((d) => <option key={d}>{d}</option>)}</select></label>
    <div className="slotgrid">{slots.filter((s) => dayKey(s) === day).map((s) => <button type="button" key={s} className={"slot" + (value === s ? " on" : "")} onClick={() => onChange(value === s ? "" : s)}>{timeKey(s)}</button>)}</div>
    <p className="muted">{value ? "Selected: " + fmtDate(value) : "Tap a time. Only the doctor’s free times are shown."}</p>
  </div>;
}

export function BannerSlider({ banner, compact }: { banner: any; compact?: boolean }) {
  const slides: any[] = (banner?.slides || []).filter(Boolean);
  const [i, setI] = useState(0); const [hold, setHold] = useState(false);
  useEffect(() => { setI(0); }, [slides.length]);
  useEffect(() => {
    if (slides.length < 2 || hold) return;
    const t = setInterval(() => setI((x) => (x + 1) % slides.length), Math.max(3, banner?.intervalSec || 5) * 1000);
    return () => clearInterval(t);
  }, [slides.length, hold, banner?.intervalSec]);
  if (!banner?.active || !slides.length) return null;
  const s = slides[i % slides.length];
  return <section className={"hero slider" + (compact ? " compact" : "")} onMouseEnter={() => setHold(true)} onMouseLeave={() => setHold(false)}>
    <div key={"t" + i} className="slidefade"><span className="eyebrow">{s.eyebrow}</span><h1>{s.title}</h1>{s.subtitle && <p>{s.subtitle}</p>}
      {s.pills?.length > 0 && <div className="pills">{s.pills.map((p: string) => <span key={p}>{p}</span>)}</div>}
      {s.linkText && s.linkUrl && <p><a className="bannerlink" href={s.linkUrl} target="_blank" rel="noopener noreferrer">{s.linkText}</a></p>}</div>
    <div className="bannerwrap"><img key={"i" + i} className="banner slidefade" src={s.image || "/branding/medai-banner.png"} alt="" /></div>
    {slides.length > 1 && <div className="dots" role="tablist">{slides.map((_, n) => <button key={n} type="button" aria-label={"Slide " + (n + 1)} className={n === i % slides.length ? "on" : ""} onClick={() => setI(n)} />)}</div>}
  </section>;
}

export function Chat({ api, appointmentId, meId }: { api: Api; appointmentId: string; meId: string }) {
  const [msgs, setMsgs] = useState<any[]>([]); const [body, setBody] = useState(""); const [err, setErr] = useState("");
  async function load() { try { const d = await api(`/appointments/${appointmentId}/messages`); setMsgs(d.messages || []); setErr(""); } catch (e: any) { setErr(e.message); } }
  useEffect(() => { load(); const t = setInterval(load, 10000); return () => clearInterval(t); }, [appointmentId]);
  async function send(e: any) {
    e.preventDefault(); if (!body.trim()) return;
    try { await api(`/appointments/${appointmentId}/messages`, { method: "POST", body: json({ body }) }); setBody(""); load(); } catch (x: any) { setErr(x.message); }
  }
  return <div className="chat">
    <div className="chatlog">{msgs.length === 0 && <p className="muted">No messages yet.</p>}
      {msgs.map((m) => <div key={m._id} className={"bubble" + (m.senderId?._id === meId ? " me" : "")}><b>{m.senderId?.name || "User"}</b><span>{m.body}</span><small>{fmtDate(m.createdAt)}</small></div>)}</div>
    {err && <p className="notice">{err}</p>}
    <form onSubmit={send} className="row"><input value={body} onChange={(e) => setBody(e.target.value)} placeholder="Write a message" maxLength={5000} /><button className="primary">Send</button></form>
    <p className="muted">Messages are for non-urgent follow-up. In an emergency call 999.</p>
  </div>;
}

export function ChangePassword({ api, onToken, setMessage }: { api: Api; onToken: (t: string) => void; setMessage: (s: string) => void }) {
  const [cur, setCur] = useState(""); const [next, setNext] = useState("");
  async function submit(e: any) {
    e.preventDefault();
    try { const d = await api("/auth/change-password", { method: "POST", body: json({ currentPassword: cur, newPassword: next }) }); if (d.token) onToken(d.token); setCur(""); setNext(""); setMessage(d.message); }
    catch (x: any) { setMessage(x.message); }
  }
  return <article><h3>Change password</h3><form onSubmit={submit}>
    <input type="password" placeholder="Current password" value={cur} onChange={(e) => setCur(e.target.value)} required />
    <input type="password" placeholder="New password (minimum 14 characters)" minLength={14} value={next} onChange={(e) => setNext(e.target.value)} required />
    <button className="primary">Update password</button></form></article>;
}
