// © 2026 MD Gausur Rahman Nabil. All rights reserved. MedAI Hospital.
import { createContext, useContext, useEffect, useState } from "react";
import { Api, json, fmtDate, postForm, downloadFile } from "./api";

export const BannerContext = createContext<any>(null);

const ICONS: Record<string, string> = { appointments: "📅", requests: "📥", rx: "💊", reports: "📄", notifications: "🔔", profile: "👤", nearby: "📍", medicines: "🔎", ai: "🤖", account: "⚙️", doctors: "✅", users: "👥", monitor: "📡", import: "⬆️", banner: "🖼️", specialties: "🏷️", security: "🔒", resets: "🔑", schedule: "🗓️", messages: "💬", direct: "💬", temporary: "🔗" };

export function Tabs({ tabs, tab, setTab, badges, strip }: { tabs: [string, string][]; tab: string; setTab: (t: string) => void; badges?: Record<string, number>; strip?: string }) {
  return <>{strip && tab !== "ai" && <BannerStrip where={strip} />}<div className="tabs">{tabs.map(([id, text]) => <button key={id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}>
    {ICONS[id] ? ICONS[id] + " " : ""}{text}{badges && badges[id] > 0 && <span className="reddot" aria-label={badges[id] + " new"}>{badges[id] > 9 ? "9+" : badges[id]}</span>}</button>)}</div></>;
}

// Red-dot counters shown on tab buttons. Polls every 30 s and when the tab regains focus.
export function useBadges(api: Api, role: "patient" | "doctor" | "admin"): Record<string, number> {
  const [b, setB] = useState<Record<string, number>>({});
  useEffect(() => {
    let live = true;
    async function load() {
      const next: Record<string, number> = {};
      try {
        const nd = await api("/notifications/mine");
        const unread = (nd.notifications || []).filter((n: any) => !n.readAt);
        next.notifications = unread.length;
        const messages = unread.filter((n: any) => ["new_message", "direct_message"].includes(n.type)).reduce((s: number, n: any) => s + (n.count || 1), 0);
        if (role === "admin") next.convos = messages;
        if (role !== "admin") next.messages = unread.filter((n: any) => n.type === "direct_message").reduce((s: number,n:any)=>s+(n.count||1),0);
        const direct = unread.filter((n: any) => n.type === "direct_message").reduce((s: number, n: any) => s + (n.count || 1), 0);
        if (direct) next.messages = direct;
        if (role === "doctor") { const d = await api("/doctor/unassigned-appointment-requests"); next.requests = (d.requests || []).length; }
        if (role === "admin") { const d = await api("/admin/doctors/pending"); next.doctors = (d.applications || []).length; const r = await api("/admin/password-requests?status=pending"); next.resets = (r.requests || []).length; const sg = await api("/admin/recent-signups"); next.resets += (sg.users || []).filter((u: any) => u.status === "pending_approval").length; }
      } catch { /* badges are best-effort */ }
      if (live) setB(next);
    }
    load(); const t = setInterval(load, 10000); const f = () => { if (!document.hidden) load(); };
    document.addEventListener("visibilitychange", f); window.addEventListener("medai-badges", f);
    return () => { live = false; clearInterval(t); document.removeEventListener("visibilitychange", f); window.removeEventListener("medai-badges", f); };
  }, [role]);
  return b;
}

export const Seq = ({ n }: { n: number }) => <span className="seq" aria-label={"Number " + n}>{n}</span>;

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

export const slidesFor = (banner: any, where?: string): any[] => (banner?.slides || []).filter((s: any) => s && (!where || !s.placement || s.placement === "all" || s.placement === where));

export function BannerSlider({ banner, compact, where }: { banner: any; compact?: boolean; where?: string }) {
  const slides: any[] = slidesFor(banner, where);
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

export function Chat({ api, appointmentId, meId, token }: { api: Api; appointmentId: string; meId: string; token?: string }) {
  const [msgs, setMsgs] = useState<any[]>([]); const [body, setBody] = useState(""); const [err, setErr] = useState("");
  const [pending, setPending] = useState<any[]>([]); const [busy, setBusy] = useState(false);
  async function load() { try { const d = await api(`/appointments/${appointmentId}/messages`); setMsgs(d.messages || []); setErr(""); } catch (e: any) { setErr(e.message); } }
  useEffect(() => { load(); const t = setInterval(load, 10000); return () => clearInterval(t); }, [appointmentId]);
  async function onPick(e: any) {
    const files: FileList | null = e.target.files; if (!files || !files.length) return;
    setBusy(true); setErr("");
    try {
      for (const file of Array.from(files).slice(0, 3)) {
        const fd = new FormData(); fd.append("file", file); fd.append("category", "chat_attachment");
        const up = await postForm("/files/upload", fd, token || "");
        const kind = file.type.startsWith("image/") ? "image" : file.type.startsWith("audio/") ? "audio" : file.type.startsWith("video/") ? "video" : "file";
        setPending((p) => [...p, { fileId: up.file.id, originalName: file.name, mimeType: file.type, kind, size: file.size }]);
      }
    } catch (x: any) { setErr(x.message); }
    finally { setBusy(false); e.target.value = ""; }
  }
  async function send(e: any) {
    e.preventDefault(); if (!body.trim() && !pending.length) return;
    setBusy(true);
    try {
      await api(`/appointments/${appointmentId}/messages`, { method: "POST", body: json({ body: body.trim(), attachments: pending }) });
      setBody(""); setPending([]); load();
    } catch (x: any) { setErr(x.message); }
    finally { setBusy(false); }
  }
  function attView(a: any) {
    if (!a?.fileId) return null;
    const id = a.fileId._id || a.fileId;
    if (a.kind === "image") return <button type="button" className="outline" onClick={() => downloadFile(token || "", id, a.originalName || "image").catch((e) => setErr(e.message))}>🖼️ {a.originalName || "Photo"}</button>;
    if (a.kind === "audio") return <button type="button" className="outline" onClick={() => downloadFile(token || "", id, a.originalName || "audio").catch((e) => setErr(e.message))}>🎵 {a.originalName || "Audio"}</button>;
    if (a.kind === "video") return <button type="button" className="outline" onClick={() => downloadFile(token || "", id, a.originalName || "video").catch((e) => setErr(e.message))}>🎬 {a.originalName || "Video"}</button>;
    return <button type="button" className="outline" onClick={() => downloadFile(token || "", id, a.originalName || "file").catch((e) => setErr(e.message))}>📎 {a.originalName || "File"}</button>;
  }
  return <div className="chat">
    <div className="chatlog">{msgs.length === 0 && <p className="muted">No messages yet.</p>}
      {msgs.map((m) => <div key={m._id} className={"bubble" + (m.senderId?._id === meId ? " me" : "")}>
        <b>{m.senderId?.name || "User"}</b>
        {m.body && m.body !== "(attachment)" && <span>{m.body}</span>}
        {(m.attachments || []).length > 0 && <div className="row" style={{ marginTop: 6, flexWrap: "wrap" }}>{m.attachments.map((a: any, i: number) => <span key={i}>{attView(a)}</span>)}</div>}
        <small>{fmtDate(m.createdAt)}</small>
      </div>)}</div>
    {err && <p className="notice">{err}</p>}
    {pending.length > 0 && <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>{pending.map((a, i) => <span key={i} className="pill">{a.kind}: {a.originalName} <button type="button" className="link" onClick={() => setPending(pending.filter((_, n) => n !== i))}>✕</button></span>)}</div>}
    <form onSubmit={send} className="row" style={{ flexWrap: "wrap" }}>
      <input value={body} onChange={(e) => setBody(e.target.value)} placeholder="Write a message" maxLength={5000} style={{ flex: "1 1 160px" }} />
      <label className="outline" style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer", margin: 0 }}>
        📷 Photo<input type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={onPick} />
      </label>
      <label className="outline" style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer", margin: 0 }}>
        🎵 Audio<input type="file" accept="audio/mpeg,audio/mp4,audio/ogg,audio/webm,audio/wav" hidden onChange={onPick} />
      </label>
      <label className="outline" style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer", margin: 0 }}>
        🎬 Video<input type="file" accept="video/mp4,video/webm,video/quicktime" hidden onChange={onPick} />
      </label>
      <button className="primary" disabled={busy || (!body.trim() && !pending.length)}>{busy ? "…" : "Send"}</button>
    </form>
    <p className="muted">You can send text, photo, audio or video. Messages are for non-urgent follow-up. In an emergency call 999.</p>
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

const NOTE_ICON: Record<string, string> = { missed: "📵", message: "💬", prescription: "💊", report: "📄", appointment: "📅", account: "👤", call: "📞" };
const noteIcon = (t: string) => { const k = Object.keys(NOTE_ICON).find((x) => (t || "").includes(x)); return k ? NOTE_ICON[k] : "🔔"; };

// One notification list for patient and doctor. Unread items get a red dot and a tinted card; read items are plain.
export function Notifications({ api, setMessage }: { api: Api; setMessage: (s: string) => void }) {
  const [items, setItems] = useState<any[]>([]);
  async function load() { try { const d = await api("/notifications/mine"); setItems(d.notifications || []); } catch (e: any) { setMessage(e.message); } }
  useEffect(() => { load(); const t = setInterval(load, 10000); return () => clearInterval(t); }, []);
  async function read(id: string) { try { await api(`/notifications/${id}/read`, { method: "POST", body: json({}) }); setItems((l) => l.map((n) => (n._id === id ? { ...n, readAt: new Date().toISOString() } : n))); window.dispatchEvent(new Event("medai-badges")); } catch (e: any) { setMessage(e.message); } }
  async function readAll() { await Promise.all(items.filter((n) => !n.readAt).map((n) => api(`/notifications/${n._id}/read`, { method: "POST", body: json({}) }).catch(() => {}))); load(); window.dispatchEvent(new Event("medai-badges")); }
  const unread = items.filter((n) => !n.readAt).length;
  return <div className="grid"><article className="full"><div className="notehead"><h3>Notifications{unread > 0 && <span className="reddot inline">{unread > 9 ? "9+" : unread}</span>}</h3>
    <div className="row"><button className="outline" onClick={load}>↻ Refresh</button>{unread > 0 && <button className="outline" onClick={readAll}>Mark all read</button>}</div></div>
    {items.length === 0 && <p className="muted">No notifications.</p>}
    <div className="notelist">{items.map((n, idx) => <div key={n._id} className={"note" + (n.readAt ? "" : " unread")} onClick={() => !n.readAt && read(n._id)}>
      <Seq n={idx + 1} /><span className="noteico" aria-hidden="true">{noteIcon(n.type + " " + (n.resourceType || "").toLowerCase())}</span>
      <div className="notebody"><b>{n.title}</b><p>{n.message}</p></div>
      <div className="notemeta"><time>{fmtDate(n.createdAt)}</time>{!n.readAt && <i className="newdot" aria-label="New" />}</div></div>)}</div>
  </article></div>;
}

// Slim banner shown at the top of every tab (patient and doctor). Admin controls it from the Banner tab.
export function BannerStrip({ where }: { where: string }) {
  const banner = useContext(BannerContext); const slides = slidesFor(banner, where); const [i, setI] = useState(0);
  useEffect(() => { setI(0); }, [slides.length]);
  useEffect(() => { if (slides.length < 2) return; const t = setInterval(() => setI((x) => (x + 1) % slides.length), Math.max(3, banner?.intervalSec || 5) * 1000); return () => clearInterval(t); }, [slides.length, banner?.intervalSec]);
  if (!banner?.active || !slides.length) return null;
  const s = slides[i % slides.length];
  return <div className="bstrip" role="complementary"><img src={s.image || "/branding/medai-banner.png"} alt="" />
    <div key={i} className="slidefade"><b>{s.title}</b>{s.subtitle && <p>{s.subtitle}</p>}</div>
    {s.linkText && s.linkUrl && <a className="bannerlink" href={s.linkUrl} target="_blank" rel="noopener noreferrer">{s.linkText}</a>}
    {slides.length > 1 && <div className="bsdots">{slides.map((_, n) => <i key={n} className={n === i % slides.length ? "on" : ""} />)}</div>}</div>;
}
