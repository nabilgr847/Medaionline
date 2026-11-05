// © 2026 MD Gausur Rahman Nabil. All rights reserved. MedAI Hospital.
import { useEffect, useRef, useState } from "react";
import { makeApi, json } from "./api";

type Role = "guest" | "doctor" | "admin";
const LABEL: Record<string, string> = { guest: "Patient", doctor: "Doctor", admin: "Admin" };

export default function GuestConsultRoom() {
  const token = new URLSearchParams(location.search).get("consult") || "";
  const [name, setName] = useState("");
  const [room, setRoom] = useState<any>(null);
  const [session, setSession] = useState("");
  const [myRole, setMyRole] = useState<Role>("guest");
  const [messages, setMessages] = useState<any[]>([]);
  const [body, setBody] = useState("");
  const [error, setError] = useState("");
  const [calling, setCalling] = useState(false);
  const [connected, setConnected] = useState(false);
  const [full, setFull] = useState(false);
  const [muted, setMuted] = useState(false);
  const [camOff, setCamOff] = useState(false);
  const [showLogin, setShowLogin] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const iceConfig = useRef<RTCIceServer[]>([{ urls: "stun:stun.l.google.com:19302" }]);
  const localVideo = useRef<HTMLVideoElement>(null);
  const remoteVideo = useRef<HTMLVideoElement>(null);
  const pc = useRef<RTCPeerConnection | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const after = useRef(new Date(Date.now() - 60000).toISOString());
  const seen = useRef(new Set<string>());
  const iceQueue = useRef<RTCIceCandidateInit[]>([]);
  const logEnd = useRef<HTMLDivElement>(null);

  const isClinician = myRole !== "guest";
  const api = makeApi(session);
  const base = room?.id ? `/temporary-consults/${room.id}/room` : "";
  const messagesPath = isClinician ? `${base}/doctor-messages` : `${base}/messages`;
  const signalsPath = isClinician ? `${base}/doctor-signals` : `${base}/signals`;

  async function loadMessages() {
    if (!base || !session) return;
    try { const d = await api(messagesPath); setMessages(d.messages || []); } catch (e: any) { setError(e.message); }
  }
  async function send(e: any) {
    e.preventDefault();
    const text = body.trim(); if (!text) return;
    try { await api(messagesPath, { method: "POST", body: json({ body: text }) }); setBody(""); loadMessages(); } catch (x: any) { setError(x.message); }
  }
  async function signal(type: string, payload: any = {}) { await api(signalsPath, { method: "POST", body: json({ type, payload }) }); }

  function ensurePeer() {
    if (pc.current) return pc.current;
    const peer = new RTCPeerConnection({ iceServers: iceConfig.current });
    pc.current = peer;
    stream.current?.getTracks().forEach(t => peer.addTrack(t, stream.current!));
    peer.ontrack = e => { if (remoteVideo.current) remoteVideo.current.srcObject = e.streams[0]; setConnected(true); setFull(true); };
    peer.onicecandidate = e => { if (e.candidate) signal("ice", e.candidate.toJSON()).catch(() => {}); };
    peer.onconnectionstatechange = () => {
      setConnected(peer.connectionState === "connected");
      if (["failed", "closed", "disconnected"].includes(peer.connectionState)) { setCalling(false); if (peer.connectionState !== "disconnected") setFull(false); }
    };
    return peer;
  }
  async function getMedia() {
    if (stream.current) return stream.current;
    const media = await navigator.mediaDevices.getUserMedia({ audio: true, video: { facingMode: "user" } });
    stream.current = media;
    if (localVideo.current) localVideo.current.srcObject = media;
    return media;
  }
  async function handleSignal(s: any) {
    if (s.type === "hangup") { cleanupCall(false); return; }
    if (s.type === "offer") {
      setCalling(true); setFull(true);
      await getMedia();
      pc.current?.close(); pc.current = null;
      const peer = ensurePeer();
      await peer.setRemoteDescription(new RTCSessionDescription(s.payload));
      for (const c of iceQueue.current.splice(0)) await peer.addIceCandidate(new RTCIceCandidate(c)).catch(() => {});
      const answer = await peer.createAnswer(); await peer.setLocalDescription(answer); await signal("answer", answer);
    } else if (s.type === "answer" && pc.current) {
      await pc.current.setRemoteDescription(new RTCSessionDescription(s.payload));
      for (const c of iceQueue.current.splice(0)) await pc.current.addIceCandidate(new RTCIceCandidate(c)).catch(() => {});
    } else if (s.type === "ice" && s.payload) {
      if (pc.current?.remoteDescription) await pc.current.addIceCandidate(new RTCIceCandidate(s.payload)).catch(() => {});
      else iceQueue.current.push(s.payload);
    }
  }
  async function startCall() {
    setError("");
    try {
      await getMedia();
      pc.current?.close(); pc.current = null;
      const peer = ensurePeer();
      const offer = await peer.createOffer(); await peer.setLocalDescription(offer); await signal("offer", offer);
      setCalling(true); setFull(true);
    } catch (e: any) { setError(e.message || "Camera/microphone permission failed"); }
  }
  function cleanupCall(stopMedia = true) {
    pc.current?.close(); pc.current = null; iceQueue.current = [];
    if (stopMedia) { stream.current?.getTracks().forEach(t => t.stop()); stream.current = null; if (localVideo.current) localVideo.current.srcObject = null; }
    if (remoteVideo.current) remoteVideo.current.srcObject = null;
    setCalling(false); setConnected(false); setFull(false); setMuted(false); setCamOff(false);
  }
  async function endCall() { try { await signal("hangup"); } catch { /* room may already be closed */ } cleanupCall(true); }
  function toggleMic() { const t = stream.current?.getAudioTracks()[0]; if (!t) return; t.enabled = !t.enabled; setMuted(!t.enabled); }
  function toggleCam() { const t = stream.current?.getVideoTracks()[0]; if (!t) return; t.enabled = !t.enabled; setCamOff(!t.enabled); }

  // Switch this page from "patient" to doctor/admin once we hold a valid clinician token.
  async function enterAsClinician(tok: string, consultId: string) {
    const r = await makeApi(tok)(`/temporary-consults/${consultId}/doctor-session`, { method: "POST", body: json({}) });
    cleanupCall(true);
    seen.current.clear(); after.current = new Date(Date.now() - 60000).toISOString(); setMessages([]);
    if (Array.isArray(r.iceServers) && r.iceServers.length) iceConfig.current = r.iceServers;
    setRoom((v: any) => ({ ...v, ...r.room }));
    setMyRole(r.role === "admin" ? "admin" : "doctor");
    setSession(tok); setShowLogin(false); setError("");
  }
  async function clinicianLogin(e: any) {
    e.preventDefault(); setError(""); setBusy(true);
    try {
      const d = await makeApi("")("/auth/login", { method: "POST", body: json({ email, password }) });
      if (!["doctor", "admin"].includes(d.user?.role)) throw new Error("This account is not a doctor or admin account.");
      await enterAsClinician(d.token, room.id);
      localStorage.setItem("medai_token", d.token); setPassword("");
    } catch (x: any) { setError(x.message); }
    finally { setBusy(false); }
  }

  useEffect(() => {
    let dead = false;
    async function init() {
      try {
        const d = await makeApi("")(`/temporary-consults/${encodeURIComponent(token)}`);
        if (dead) return;
        const id = d.consultation.id;
        setRoom({ id, patientName: d.consultation.patientName, doctor: d.consultation.doctor, expiresAt: d.consultation.expiresAt });
        const existing = localStorage.getItem("medai_token");
        if (existing) {
          try {
            const a = await makeApi(existing)("/auth/me");
            if (["doctor", "admin"].includes(a.user?.role)) {
              try { await enterAsClinician(existing, id); return; }
              catch (x: any) { if (!dead) { setError(x.message); setShowLogin(true); } }
            }
          } catch { /* stale token: continue as guest */ }
        }
        const g = await makeApi("")(`/temporary-consults/${encodeURIComponent(token)}/join`, { method: "POST", body: json({ name: name || d.consultation.patientName }) });
        if (!dead) { setSession(g.token); setMyRole("guest"); setName(g.name); if (Array.isArray(g.iceServers) && g.iceServers.length) iceConfig.current = g.iceServers; }
      } catch (e: any) { if (!dead) setError(e.message); }
    }
    if (token) init(); else setError("Consultation link is missing.");
    return () => { dead = true; };
  }, [token]);

  useEffect(() => {
    if (!base || !session) return;
    loadMessages();
    const m = window.setInterval(loadMessages, 3000);
    let polling = false;
    const poll = window.setInterval(async () => {
      if (polling) return; polling = true;
      try {
        const d = await api(`${signalsPath}?after=${encodeURIComponent(after.current)}`);
        for (const s of d.signals || []) {
          const key = String(s._id || `${s.createdAt}-${s.type}-${s.senderRole}`);
          if (seen.current.has(key)) continue;
          seen.current.add(key); after.current = s.createdAt;
          try { await handleSignal(s); } catch (e: any) { setError(e.message); }
        }
      } catch (e: any) { setError(e.message); }
      finally { polling = false; }
    }, 1500);
    return () => { clearInterval(m); clearInterval(poll); };
  }, [base, session, myRole]);

  useEffect(() => { logEnd.current?.scrollIntoView({ block: "end" }); }, [messages.length]);
  useEffect(() => () => { pc.current?.close(); stream.current?.getTracks().forEach(t => t.stop()); }, []);

  const doctorName = room?.doctor?.name || room?.doctorName;
  return <main className="shell">
    <header><img src="/branding/medai-logo.svg" alt="MedAI Hospital" /><span className="role">Temporary consultation · {LABEL[myRole]}</span></header>
    <section className="dashboard">
      <h1>Secure consultation room</h1>
      <p className="muted">{doctorName ? `Assigned doctor: ${doctorName}` : "A doctor will join this room."} · Expires {room?.expiresAt ? new Date(room.expiresAt).toLocaleString() : "when link expires"}</p>
      {error && <p className="warn" role="alert" onClick={() => setError("")}>{error} <small>(tap to dismiss)</small></p>}
      {!isClinician && <p className="muted">Are you the doctor or admin? <button type="button" className="link" onClick={() => setShowLogin(v => !v)}>Sign in as doctor / admin</button></p>}
      {showLogin && !isClinician && <article><h3>Doctor / admin sign-in</h3>
        <form onSubmit={clinicianLogin}>
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="Email" autoComplete="username" required />
          <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Password" autoComplete="current-password" required />
          <button className="primary" disabled={busy}>{busy ? "Signing in…" : "Sign in and join room"}</button>
        </form></article>}
      <div className="grid">
        <article>
          <h3>Messages {isClinician && <span className="role">You: {LABEL[myRole]}</span>}</h3>
          <div className="chatlog">
            {messages.length === 0 && <p className="muted">No messages yet.</p>}
            {messages.map((m: any, i: number) => <div className={"bubble" + (m.senderRole === myRole ? " me" : "")} key={m._id || i}><b>{m.senderName} · {LABEL[m.senderRole] || m.senderRole}</b><span>{m.body}</span><small>{new Date(m.createdAt).toLocaleString()}</small></div>)}
            <div ref={logEnd} />
          </div>
          <form className="row" onSubmit={send}>
            <input value={body} onChange={e => setBody(e.target.value)} maxLength={3000} placeholder={isClinician ? `Write as ${LABEL[myRole]}…` : "Write a message…"} disabled={!session} />
            <button className="primary" disabled={!session || !body.trim()}>Send</button>
          </form>
        </article>
        <article>
          <h3>Audio / video call</h3>
          <div className={"callstage" + (calling && full ? " callfs" : "")}>
            <div className="callvideos">
              <div className="call-local"><video ref={localVideo} autoPlay playsInline muted /><small>You</small></div>
              <div className="call-remote" onClick={() => calling && setFull(f => !f)} style={{ cursor: calling ? "zoom-in" : "default" }}><video ref={remoteVideo} autoPlay playsInline /><small>{connected ? "Connected · tap to enlarge" : "Waiting for other participant"}</small></div>
            </div>
            {calling && full && <>
              <div className="calltop"><span className={"callstatus" + (connected ? " on" : "")}>{connected ? "● Connected" : "○ Connecting…"}</span><span className="callhint">MedAI video visit</span></div>
              <div className="callbar">
                <button type="button" className={"roundbtn" + (muted ? " off" : "")} onClick={toggleMic} aria-label={muted ? "Unmute" : "Mute"}>{muted ? "🔇" : "🎤"}</button>
                <button type="button" className={"roundbtn" + (camOff ? " off" : "")} onClick={toggleCam} aria-label={camOff ? "Camera on" : "Camera off"}>{camOff ? "📷" : "📹"}</button>
                <button type="button" className="roundbtn" onClick={() => setFull(false)} aria-label="Minimize">—</button>
                <button type="button" className="roundbtn end" onClick={endCall} aria-label="End call">📞</button>
              </div>
            </>}
          </div>
          {calling && !full && <div className="callmini"><span>{connected ? "● Call connected" : "○ Call in progress"}</span><button type="button" className="primary" onClick={() => setFull(true)}>⛶ Full screen</button></div>}
          <p className="muted">Use HTTPS and allow camera/microphone access. Direct connections may fail on restrictive networks unless TURN is configured.</p>
          <div className="row"><button className="primary" disabled={!session || calling} onClick={startCall}>Start / join video</button><button className="danger" disabled={!calling} onClick={endCall}>End call</button></div>
        </article>
      </div>
      <p className="warn">Do not use this room for emergencies. Do not share sensitive identity or payment information. This temporary room is not a substitute for a verified clinical record.</p>
    </section>
  </main>;
}
