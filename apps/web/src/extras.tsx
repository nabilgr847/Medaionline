// MedAI extras: doctor cards, global call/message alerts, admin conversation + call observer.
import { useEffect, useRef, useState } from "react";
import { API, Api, json, fmtDate } from "./api";
import { Chat } from "./common";

export function DoctorPhoto({ token, doctor, size = 64, v = 0 }: { token: string; doctor: any; size?: number; v?: number }) {
  const [src, setSrc] = useState("");
  useEffect(() => {
    let url = ""; let live = true;
    if (!doctor?.hasPhoto || !API) return;
    fetch(`${API}/api/doctors/${doctor._id}/photo${v ? "?v=" + v : ""}`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.blob() : Promise.reject())).then((b) => { url = URL.createObjectURL(b); if (live) setSrc(url); }).catch(() => {});
    return () => { live = false; if (url) URL.revokeObjectURL(url); };
  }, [doctor?._id, doctor?.hasPhoto, token, v]);
  const style = { width: size, height: size, borderRadius: "50%", objectFit: "cover" as const, flex: "none" as const };
  return src ? <img src={src} alt={doctor.name} style={style} /> : <div style={{ ...style, background: "#dff1f5", display: "grid", placeItems: "center", fontSize: size / 2.2 }} aria-hidden="true">🩺</div>;
}

export function DoctorPicker({ token, doctors, value, onChange }: { token: string; doctors: any[]; value: string; onChange: (id: string) => void }) {
  const card = (d: any | null) => {
    const p = d?.doctorProfile || {}; const on = (d?._id || "") === value;
    return <button type="button" key={d?._id || "any"} className={"doccard" + (on ? " on" : "")} onClick={() => onChange(d?._id || "")} aria-pressed={on}>
      {d ? <DoctorPhoto token={token} doctor={d} /> : <div className="docany" aria-hidden="true">👥</div>}
      <div className="docinfo">
        <b>{d ? "Dr. " + d.name.replace(/^Dr\.?\s*/i, "") : "Any available doctor"}</b>
        {d ? <>
          {p.specialty && <span>{p.specialty}</span>}
          {p.qualifications?.length > 0 && <small>{p.qualifications.join(", ")}</small>}
          <small>{[p.experienceYears ? p.experienceYears + " yrs experience" : "", p.clinicName || ""].filter(Boolean).join(" · ")}</small>
          {p.bio && <small className="docbio">{p.bio}</small>}
        </> : <small>The first doctor to accept your request will take your case.</small>}
      </div>{on && <i className="docok" aria-hidden="true">✓</i>}</button>;
  };
  return <div className="docpick" role="group" aria-label="Choose a doctor">{card(null)}{doctors.map(card)}</div>;
}

// ---- Global alerts: incoming call (ringing), new messages, missed calls ----
let actx: AudioContext | null = null;
function beep(freqs: number[]) {
  try {
    actx = actx || new (window.AudioContext || (window as any).webkitAudioContext)();
    let t = actx.currentTime;
    for (const f of freqs) { const o = actx.createOscillator(); const g = actx.createGain(); o.frequency.value = f; o.connect(g); g.connect(actx.destination); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.25, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.28); o.start(t); o.stop(t + 0.3); t += 0.32; }
  } catch { /* audio blocked until first tap */ }
}

export function AlertCenter({ api }: { api: Api }) {
  const [calls, setCalls] = useState<any[]>([]); const [toasts, setToasts] = useState<any[]>([]);
  const known = useRef<Set<string>>(new Set()); const first = useRef(true); const baseTitle = useRef(document.title);
  useEffect(() => {
    const ask = () => { if ("Notification" in window && Notification.permission === "default") Notification.requestPermission().catch(() => {}); actx = actx || null; };
    window.addEventListener("pointerdown", ask, { once: true });
    let live = true;
    async function poll() {
      try {
        const d = await api("/notifications/mine"); if (!live) return;
        const unread = (d.notifications || []).filter((n: any) => !n.readAt && ["incoming_call", "new_message", "missed_call"].includes(n.type));
        const stamp = (n: any) => n._id + ":" + (n.count || 1) + ":" + n.createdAt;
        const fresh = unread.filter((n: any) => !known.current.has(stamp(n)));
        unread.forEach((n: any) => known.current.add(stamp(n)));
        setCalls(unread.filter((n: any) => n.type === "incoming_call"));
        if (!first.current && fresh.length) {
          setToasts((t) => [...t, ...fresh.filter((n: any) => n.type !== "incoming_call")].slice(-3));
          beep(fresh.some((n: any) => n.type === "incoming_call") ? [880, 660, 880] : [740, 990]);
          try { navigator.vibrate?.(fresh.some((n: any) => n.type === "incoming_call") ? [300, 150, 300, 150, 300] : [200]); } catch {}
          if ("Notification" in window && Notification.permission === "granted" && document.hidden) fresh.forEach((n: any) => { try { new Notification(n.title, { body: n.message, tag: n._id }); } catch {} });
        }
        first.current = false;
      } catch { /* best effort */ }
    }
    poll(); const t = setInterval(poll, 3000);
    return () => { live = false; clearInterval(t); window.removeEventListener("pointerdown", ask); };
  }, []);
  // keep ringing while a call is unanswered + flash the tab title
  useEffect(() => {
    if (!calls.length) { document.title = baseTitle.current; return; }
    const r = setInterval(() => { beep([880, 660, 880]); try { navigator.vibrate?.([300, 150, 300]); } catch {} }, 4000);
    let on = false; const f = setInterval(() => { on = !on; document.title = on ? "📞 Incoming call!" : baseTitle.current; }, 900);
    return () => { clearInterval(r); clearInterval(f); document.title = baseTitle.current; };
  }, [calls.length]);
  async function open(n: any, call: boolean) {
    api(`/notifications/${n._id}/read`, { method: "POST", body: json({}) }).catch(() => {});
    setCalls((c) => c.filter((x) => x._id !== n._id)); setToasts((t) => t.filter((x) => x._id !== n._id));
    const detail = { appointmentId: n.resourceId, kind: call ? "call" : "chat" };
    (window as any).__medaiOpen = detail; window.dispatchEvent(new CustomEvent("medai-open", { detail })); window.dispatchEvent(new Event("medai-badges"));
  }
  const dismiss = (n: any) => { api(`/notifications/${n._id}/read`, { method: "POST", body: json({}) }).catch(() => {}); setCalls((c) => c.filter((x) => x._id !== n._id)); setToasts((t) => t.filter((x) => x._id !== n._id)); window.dispatchEvent(new Event("medai-badges")); };
  if (!calls.length && !toasts.length) return null;
  return <div className="alertwrap" role="alert" aria-live="assertive">
    {calls.map((n) => <div className="alertcard callalert" key={n._id}><div className="ring" aria-hidden="true">📞</div><div className="alerttext"><b>{n.title}</b><small>{n.message}</small></div>
      <div className="row"><button className="primary" onClick={() => open(n, true)}>Answer</button><button className="danger" onClick={() => dismiss(n)}>Dismiss</button></div></div>)}
    {toasts.map((n) => <div className="alertcard" key={n._id}><div className="alerttext"><b>{n.type === "missed_call" ? "📵 " : "💬 "}{n.title}</b><small>{n.message}</small></div>
      <div className="row"><button className="primary" onClick={() => open(n, n.type === "missed_call")}>Open</button><button className="outline" onClick={() => dismiss(n)}>✕</button></div></div>)}
  </div>;
}

// ---- Admin: read/send messages, observe or join calls ----
export function AdminConversations({ api, user, setMessage }: { api: Api; user: any; setMessage: (s: string) => void }) {
  const [list, setList] = useState<any[]>([]); const [sel, setSel] = useState<any>(null); const [callOn, setCallOn] = useState(false);
  async function load() { try { const d = await api("/admin/appointments"); setList(d.appointments || []); } catch (e: any) { setMessage(e.message); } }
  useEffect(() => { load(); const t = setInterval(load, 10000); return () => clearInterval(t); }, []);
  return <div className="grid">
    <article><h3>Conversations</h3><button className="outline" onClick={load}>↻ Refresh</button>
      {list.length === 0 && <p className="muted">No assigned appointments yet.</p>}
      <div className="convlist">{list.map((a) => <button type="button" key={a._id} className={"item convitem" + (sel?._id === a._id ? " on" : "")} onClick={() => { setSel(a); setCallOn(false); }}>
        <b>{a.patientId?.name || "Patient"} ⇄ Dr. {a.doctorId?.name || "?"}</b>{a.liveCall && <span className="livepill">● LIVE CALL</span>}
        <small>{a.status.replace(/_/g, " ")} · {a.consultationType.replace("_", " ")}{a.scheduledAt ? " · " + fmtDate(a.scheduledAt) : ""}</small></button>)}</div></article>
    <article>{!sel ? <p className="muted">Select a conversation to read its messages or join its call.</p> : <>
      <h3>{sel.patientId?.name} ⇄ Dr. {sel.doctorId?.name}</h3>
      <p className="muted">Admin access is recorded in the audit log.</p>
      <Chat api={api} appointmentId={sel._id} meId={user.id} />
      {sel.consultationType === "online" && <div className="row"><button className="primary" onClick={() => setCallOn(!callOn)}>{callOn ? "Leave call" : "🎥 Join call (watch & listen)"}</button></div>}
      {callOn && <AdminCallObserver api={api} appt={sel} onLeave={() => setCallOn(false)} />}</>}
    </article></div>;
}

function AdminCallObserver({ api, appt, onLeave }: { api: Api; appt: any; onLeave: () => void }) {
  const peers = useRef<Record<string, RTCPeerConnection>>({}); const vids = useRef<Record<string, HTMLVideoElement | null>>({});
  const seen = useRef<Set<string>>(new Set()); const after = useRef(new Date(Date.now() - 1000).toISOString());
  const [status, setStatus] = useState<Record<string, string>>({});
  const targets: [string, string][] = [[appt.patientId?._id, "Patient · " + (appt.patientId?.name || "")], [appt.doctorId?._id, "Doctor · " + (appt.doctorId?.name || "")]];
  const sig = (to: string, type: string, payload: any = {}) => api(`/appointments/${appt._id}/call-signals`, { method: "POST", body: json({ type, payload, to }) });
  async function dial(id: string) {
    peers.current[id]?.close();
    const pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] }); peers.current[id] = pc;
    pc.addTransceiver("audio", { direction: "recvonly" }); pc.addTransceiver("video", { direction: "recvonly" });
    pc.onicecandidate = (e) => { if (e.candidate) sig(id, "ice", e.candidate.toJSON()).catch(() => {}); };
    pc.ontrack = (e) => { const v = vids.current[id]; if (v) { v.srcObject = e.streams[0]; v.play().catch(() => {}); } };
    pc.onconnectionstatechange = () => setStatus((s) => ({ ...s, [id]: pc.connectionState === "connected" ? "Connected" : pc.connectionState === "failed" ? "Failed" : "Connecting…" }));
    setStatus((s) => ({ ...s, [id]: "Waiting for them to be in the call…" }));
    const offer = await pc.createOffer(); await pc.setLocalDescription(offer); await sig(id, "offer", offer);
  }
  useEffect(() => {
    let live = true; targets.forEach(([id]) => id && dial(id).catch((e) => setStatus((s) => ({ ...s, [id]: e.message }))));
    const poll = async () => {
      try {
        const d = await api(`/appointments/${appt._id}/call-signals?after=${encodeURIComponent(after.current)}`);
        for (const s of d.signals || []) {
          if (!live || seen.current.has(s._id)) continue; seen.current.add(s._id); if (s.createdAt > after.current) after.current = s.createdAt;
          const pc = peers.current[s.senderId]; if (!pc) continue;
          if (s.type === "answer" && !pc.remoteDescription) await pc.setRemoteDescription(new RTCSessionDescription(s.payload));
          else if (s.type === "ice" && s.payload && pc.remoteDescription) await pc.addIceCandidate(new RTCIceCandidate(s.payload)).catch(() => {});
        }
      } catch {}
    };
    const t = setInterval(poll, 1500);
    return () => { live = false; clearInterval(t); targets.forEach(([id]) => { if (id) { sig(id, "hangup").catch(() => {}); } peers.current[id]?.close(); }); };
  }, [appt._id]);
  return <div className="observer">
    <p className="muted">You are watching and listening. Both doctor and patient must be in the call; if one shows “Waiting”, press Retry.</p>
    <div className="obsgrid">{targets.map(([id, name]) => id && <div key={id} className="obscell"><video ref={(el) => { vids.current[id] = el; }} autoPlay playsInline controls />
      <div className="row"><b>{name}</b><small>{status[id] || ""}</small><button className="outline" onClick={() => dial(id).catch(() => {})}>Retry</button></div></div>)}</div>
    <button className="danger" onClick={onLeave}>Leave call</button></div>;
}
