// © 2026 MD Gausur Rahman Nabil. All rights reserved. MedAI Hospital.
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Api, json, postForm, downloadFile, fmtDay, fmtSize } from "./api";
import { Chat } from "./common";

// Bangla <-> English phrases a doctor/patient can send into the call chat with one tap.
const PHRASES: [string, string][] = [
  ["Where does it hurt?", "কোথায় ব্যথা করছে?"],
  ["How long have you had this problem?", "এই সমস্যা কতদিন ধরে হচ্ছে?"],
  ["Do you have a fever?", "জ্বর আছে কি?"],
  ["Are you allergic to any medicine?", "কোনো ওষুধে অ্যালার্জি আছে কি?"],
  ["Are you taking any medicine now?", "এখন কি কোনো ওষুধ খাচ্ছেন?"],
  ["Please show the area to the camera.", "অনুগ্রহ করে ক্যামেরায় জায়গাটি দেখান।"],
  ["Please send a photo or report in the chat.", "অনুগ্রহ করে চ্যাটে ছবি বা রিপোর্ট পাঠান।"],
  ["I cannot hear you.", "আমি আপনার কথা শুনতে পাচ্ছি না।"],
  ["Please speak slowly.", "অনুগ্রহ করে আস্তে বলুন।"],
  ["Can you repeat that?", "আবার বলবেন কি?"],
  ["Thank you, doctor.", "ধন্যবাদ ডাক্তার সাহেব।"],
];
const fmtTime = (s: number) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

/** WhatsApp/Zoom-style call: ringing screen, full-screen call (rendered on document.body so no page layout can break it),
 *  in-call chat with photo/audio/video/PDF sharing, Bangla<->English help, optional new window. Audio recording needs consent from both. */
export default function TeleVisitCall({ api, token, appointmentId, user, setMessage, standalone }: { api: Api; token: string; appointmentId: string; user: any; setMessage: (s: string) => void; standalone?: boolean }) {
  const localVideo = useRef<HTMLVideoElement>(null); const remoteVideo = useRef<HTMLVideoElement>(null); const hostRef = useRef<HTMLDivElement>(null);
  const iceConfig = useRef<RTCIceServer[]>([{ urls: "stun:stun.l.google.com:19302" }]);
  const pc = useRef<RTCPeerConnection | null>(null); const local = useRef<MediaStream | null>(null); const remote = useRef<MediaStream | null>(null);
  const camTrack = useRef<MediaStreamTrack | null>(null); const screenTrack = useRef<MediaStreamTrack | null>(null); const facing = useRef<"user" | "environment">("user");
  const seen = useRef<Set<string>>(new Set()); const after = useRef(new Date(Date.now() - 60000).toISOString()); const queuedIce = useRef<RTCIceCandidateInit[]>([]);
  const recorder = useRef<MediaRecorder | null>(null); const audioContext = useRef<AudioContext | null>(null); const chunks = useRef<Blob[]>([]); const speechRecognition = useRef<any>(null);
  const incoming = useRef<any>(null); const ringTimer = useRef<any>(null); const ringCtx = useRef<AudioContext | null>(null); const toastTimer = useRef<any>(null); const connectedAt = useRef(0); const wakeLock = useRef<any>(null);
  const lastSeen = useRef(-1); const cleaner = useRef<{ track: MediaStreamTrack; stop: () => void } | null>(null);
  const [consent, setConsent] = useState({ patient: false, doctor: false }); const [connected, setConnected] = useState(false); const [callStarted, setCallStarted] = useState(false); const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false); const [recordings, setRecordings] = useState<any[]>([]); const [transcript, setTranscript] = useState(""); const [summary, setSummary] = useState(""); const [speechOn, setSpeechOn] = useState(false); const [speechLang, setSpeechLang] = useState("en-US");
  const myRole = user?.role === "doctor" ? "doctor" : "patient";
  const [minimized, setMinimized] = useState(false); const [muted, setMuted] = useState(false); const [camOff, setCamOff] = useState(false); const [sharing, setSharing] = useState(false);
  const [ringing, setRinging] = useState<{ video: boolean } | null>(null); const [callMode, setCallMode] = useState<"audio" | "video">("video"); const [hasVideo, setHasVideo] = useState(false);
  const [sheet, setSheet] = useState<null | "chat" | "help" | "record">(null); const [unread, setUnread] = useState(0); const [secs, setSecs] = useState(0); const [toast, setToast] = useState(""); const [popped, setPopped] = useState(false);
  const [trIn, setTrIn] = useState(""); const [trOut, setTrOut] = useState(""); const [trBusy, setTrBusy] = useState(false); const [connState, setConnState] = useState("new"); const [strongNoise, setStrongNoise] = useState(false); const [fit, setFit] = useState<"contain" | "cover">("cover"); const fitManual = useRef(false);
  const activeRef = useRef(false); activeRef.current = callStarted;
  const canShare = typeof navigator !== "undefined" && !!(navigator.mediaDevices as any)?.getDisplayMedia && !/Android|iPhone|iPad/i.test(navigator.userAgent);
  // Messages show in the page behind the call; while the call is full screen they also appear as a toast on top of it.
  function say(s: string) { setMessage(s); setToast(s); clearTimeout(toastTimer.current); toastTimer.current = setTimeout(() => setToast(""), 4500); }
  async function refreshConsent() { try { const d = await api(`/appointments/${appointmentId}/call-state`); setConsent(d.consent); } catch {} }
  async function loadRecordings() { try { const d = await api(`/appointments/${appointmentId}/recordings`); setRecordings(d.recordings || []); } catch {} }
  async function signal(type: string, payload: any = {}, to?: string) { await api(`/appointments/${appointmentId}/call-signals`, { method: "POST", body: json({ type, payload, ...(to ? { to } : {}) }) }); }
  const beat = (active: boolean, connectionState = "starting") => api(`/appointments/${appointmentId}/call-heartbeat`, { method: "POST", body: json({ active, connectionState }) }).catch(() => {});

  // ---- ringing (patient side) ----
  function startRing() {
    stopRing();
    const tick = () => {
      try { navigator.vibrate?.([400, 200, 400]); } catch {}
      try {
        const AC = (window as any).AudioContext || (window as any).webkitAudioContext; if (!AC) return;
        const ctx = ringCtx.current || (ringCtx.current = new AC());
        [0, 0.5].forEach((d, i) => { const o = ctx.createOscillator(); const g = ctx.createGain(); o.frequency.value = i ? 480 : 440; g.gain.value = 0.08; o.connect(g); g.connect(ctx.destination); o.start(ctx.currentTime + d); o.stop(ctx.currentTime + d + 0.4); });
      } catch {}
    };
    tick(); ringTimer.current = setInterval(tick, 2200);
  }
  function stopRing() { clearInterval(ringTimer.current); ringTimer.current = null; try { navigator.vibrate?.(0); } catch {} ringCtx.current?.close().catch(() => {}); ringCtx.current = null; }

  // ---- admin observers (silent) ----
  const adminPeers = useRef<Record<string, RTCPeerConnection>>({}); const adminIce = useRef<Record<string, RTCIceCandidateInit[]>>({});
  async function handleAdminSignal(s: any) {
    const id = String(s.senderId);
    if (s.type === "admin_end") { if (activeRef.current || local.current || incoming.current) { cleanupCall(); say("This call was ended by an administrator."); } return; }
    if (s.type === "hangup") { adminPeers.current[id]?.close(); delete adminPeers.current[id]; return; }
    if (s.type === "offer") {
      if (!local.current) return;
      adminPeers.current[id]?.close();
      const peer = new RTCPeerConnection({ iceServers: iceConfig.current }); adminPeers.current[id] = peer;
      local.current.getTracks().forEach((tr) => peer.addTrack(tr, local.current!));
      peer.onicecandidate = (e) => { if (e.candidate) signal("ice", e.candidate.toJSON(), id).catch(() => {}); };
      await peer.setRemoteDescription(new RTCSessionDescription(s.payload));
      for (const ice of (adminIce.current[id] || []).splice(0)) await peer.addIceCandidate(new RTCIceCandidate(ice)).catch(() => {});
      const answer = await peer.createAnswer(); await peer.setLocalDescription(answer); await signal("answer", answer, id);
    } else if (s.type === "ice" && s.payload) {
      const peer = adminPeers.current[id];
      if (peer?.remoteDescription) await peer.addIceCandidate(new RTCIceCandidate(s.payload)).catch(() => {}); else (adminIce.current[id] = adminIce.current[id] || []).push(s.payload);
    }
  }
  useEffect(() => { api("/webrtc/ice-servers").then((d: any) => { if (Array.isArray(d.iceServers) && d.iceServers.length) iceConfig.current = d.iceServers; }).catch(() => {}); }, []);

  // ---- peer + media ----
  function ensurePeer() {
    if (pc.current) return pc.current;
    const peer = new RTCPeerConnection({ iceServers: iceConfig.current });
    peer.onicecandidate = (e) => { if (e.candidate) signal("ice", e.candidate.toJSON()).catch(() => {}); };
    peer.ontrack = (e) => { remote.current = e.streams[0]; if (remoteVideo.current) { remoteVideo.current.srcObject = e.streams[0]; remoteVideo.current.play().catch(() => {}); } };
    peer.onconnectionstatechange = () => {
      const state = peer.connectionState; setConnected(state === "connected"); setConnState(state);
      if (state === "connected" && !connectedAt.current) connectedAt.current = Date.now();
      beat(true, ["connected", "disconnected", "failed"].includes(state) ? state : "starting");
      if (state === "failed") say("Connection lost. End the call and start it again, or switch to audio-only.");
    };
    pc.current = peer; return peer;
  }
  async function acquire(mode: "audio" | "video") {
    if (local.current) return local.current;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 }, video: mode === "video" ? { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" } : false });
    local.current = stream; camTrack.current = stream.getVideoTracks()[0] || null; setHasVideo(!!camTrack.current); setCallMode(mode);
    if (localVideo.current) { localVideo.current.srcObject = stream; localVideo.current.muted = true; }
    const peer = ensurePeer(); stream.getTracks().forEach(t => peer.addTrack(t, stream)); return stream;
  }
  async function startCall(mode: "audio" | "video") {
    if (myRole === "doctor" || ringing) enterFs();
    setBusy(true);
    try {
      if (ringing) { await acceptCall(); return; }
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("This browser/device does not support secure audio/video calling. Open the site over HTTPS.");
      if (myRole === "doctor") { await acquire(mode); const offer = await ensurePeer().createOffer(); await ensurePeer().setLocalDescription(offer); await signal("offer", offer); setCallStarted(true); setMinimized(false); say("Calling the patient…"); }
      else say("Ready. The call screen opens automatically when the doctor starts the call. Keep this page open.");
    } catch (e: any) { cleanupCall(); say(e?.name === "NotAllowedError" ? "Camera/microphone permission is blocked. Allow it in the browser settings and try again." : e.message || "Could not start the call. Check camera/microphone permissions."); }
    finally { setBusy(false); }
  }
  async function acceptCall() {
    const offer = incoming.current; if (!offer) return; enterFs(); stopRing(); setBusy(true);
    try {
      await acquire(ringing?.video ? "video" : "audio");
      const peer = ensurePeer(); await peer.setRemoteDescription(new RTCSessionDescription(offer));
      for (const ice of queuedIce.current.splice(0)) await peer.addIceCandidate(new RTCIceCandidate(ice)).catch(() => {});
      const answer = await peer.createAnswer(); await peer.setLocalDescription(answer); await signal("answer", answer);
      incoming.current = null; setRinging(null); setCallStarted(true); setMinimized(false); beat(true);
    } catch (e: any) { cleanupCall(); say(e?.name === "NotAllowedError" ? "Camera/microphone permission is blocked. Allow it in the browser settings." : e.message || "Could not join the call."); }
    finally { setBusy(false); }
  }
  function declineCall() { stopRing(); incoming.current = null; queuedIce.current = []; setRinging(null); signal("hangup").catch(() => {}); }
  function cleanupCall() {
    stopRecording(); stopRing(); speechRecognition.current?.stop(); speechRecognition.current = null; setSpeechOn(false);
    pc.current?.close(); pc.current = null; Object.values(adminPeers.current).forEach((p) => p.close()); adminPeers.current = {};
    local.current?.getTracks().forEach(t => t.stop()); local.current = null; camTrack.current?.stop(); camTrack.current = null; screenTrack.current?.stop(); screenTrack.current = null;
    cleaner.current?.stop(); cleaner.current = null; setStrongNoise(false); exitFs();
    remote.current = null; queuedIce.current = []; incoming.current = null; connectedAt.current = 0; lastSeen.current = -1;
    if (localVideo.current) localVideo.current.srcObject = null; if (remoteVideo.current) remoteVideo.current.srcObject = null;
    setConnected(false); setConnState("new"); setCallStarted(false); setRinging(null); setSheet(null); setSharing(false); setHasVideo(false); setUnread(0); setSecs(0);
  }
  async function hangup() { try { await signal("hangup"); await beat(false, "ended"); } catch {} cleanupCall(); }
  async function handleSignal(s: any) {
    if (s.senderRole === "admin") { await handleAdminSignal(s); return; }
    if (s.type === "hangup") { const was = activeRef.current || !!incoming.current; cleanupCall(); if (was) say("The call has ended."); return; }
    if (s.type === "offer" && myRole === "patient") {
      if (!standalone && Date.now() - Number(localStorage.getItem("medai_callwin_" + appointmentId) || 0) < 6000) return; // the call window is handling it
      if (pc.current || local.current) cleanupCall();
      incoming.current = s.payload; setRinging({ video: String(s.payload?.sdp || "").includes("m=video") }); setMinimized(false); startRing(); return;
    }
    if (s.type === "answer" && myRole === "doctor" && pc.current && !pc.current.remoteDescription) {
      await pc.current.setRemoteDescription(new RTCSessionDescription(s.payload));
      for (const ice of queuedIce.current.splice(0)) await pc.current.addIceCandidate(new RTCIceCandidate(ice)).catch(() => {});
    } else if (s.type === "ice" && s.payload) {
      if (pc.current?.remoteDescription) await pc.current.addIceCandidate(new RTCIceCandidate(s.payload)).catch(() => {}); else queuedIce.current.push(s.payload);
    }
  }
  useEffect(() => { if (!standalone) return; const k = "medai_callwin_" + appointmentId; const t = setInterval(() => localStorage.setItem(k, String(Date.now())), 2000); localStorage.setItem(k, String(Date.now())); return () => { clearInterval(t); localStorage.removeItem(k); }; }, [appointmentId, standalone]);
  // Poll for call signals. Not while the call lives in another window.
  useEffect(() => {
    if (popped) return;
    refreshConsent(); loadRecordings(); const c = setInterval(refreshConsent, 3000);
    let active = true;
    const poll = async () => {
      if (!active) return;
      try {
        const d = await api(`/appointments/${appointmentId}/call-signals?after=${encodeURIComponent(new Date(new Date(after.current).getTime() - 1000).toISOString())}`);
        for (const s of d.signals || []) {
          if (!active || seen.current.has(s._id)) continue; seen.current.add(s._id);
          if (s.createdAt && new Date(s.createdAt) > new Date(after.current)) after.current = s.createdAt;
          await handleSignal(s);
        }
      } catch {}
    };
    const timer = setInterval(poll, 1500); poll();
    return () => { active = false; clearInterval(timer); clearInterval(c); cleanupCall(); audioContext.current?.close().catch(() => {}); };
  }, [appointmentId, myRole, popped]);
  useEffect(() => {
    if (!callStarted) return;
    const t = window.setInterval(() => beat(true, connected ? "connected" : "starting"), 15000); beat(true, connected ? "connected" : "starting");
    return () => window.clearInterval(t);
  }, [appointmentId, callStarted, connected]);
  // Call timer, no-answer timeout (doctor), keep the screen awake, warn before closing the tab mid-call.
  useEffect(() => { if (!connected) return; if (!connectedAt.current) connectedAt.current = Date.now(); const t = setInterval(() => setSecs(Math.floor((Date.now() - connectedAt.current) / 1000)), 1000); return () => clearInterval(t); }, [connected]);
  useEffect(() => { if (!callStarted || connected || myRole !== "doctor") return; const t = setTimeout(() => { say("No answer. The patient will see a missed call."); hangup(); }, 60000); return () => clearTimeout(t); }, [callStarted, connected, myRole]);
  useEffect(() => {
    if (!callStarted) return;
    (navigator as any).wakeLock?.request?.("screen").then((l: any) => { wakeLock.current = l; }).catch(() => {});
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; }; window.addEventListener("beforeunload", warn);
    return () => { window.removeEventListener("beforeunload", warn); wakeLock.current?.release?.().catch(() => {}); wakeLock.current = null; };
  }, [callStarted]);
  useEffect(() => { if (!callStarted) { setMinimized(false); setMuted(false); setCamOff(false); } }, [callStarted]);
  const full = (callStarted || !!ringing) && !minimized;
  // Stable full screen (Zoom-like): the call always fills the *visible* screen, the page behind cannot scroll or zoom,
  // and mobile address-bar show/hide no longer makes the picture grow and shrink.
  useEffect(() => {
    if (!full) return;
    const de = document.documentElement; const y = window.scrollY;
    const setH = () => { de.style.setProperty("--callh", Math.round(window.visualViewport?.height || window.innerHeight) + "px"); };
    setH(); de.classList.add("callopen"); document.body.style.top = `-${y}px`;
    const meta = document.querySelector('meta[name="viewport"]') as HTMLMetaElement | null; const oldMeta = meta?.content || "";
    if (meta) meta.content = "width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover";
    const noGesture = (e: Event) => e.preventDefault(); const noPinch = (e: TouchEvent) => { if (e.touches.length > 1) e.preventDefault(); };
    document.addEventListener("gesturestart", noGesture); document.addEventListener("touchmove", noPinch, { passive: false });
    window.visualViewport?.addEventListener("resize", setH); window.addEventListener("resize", setH); window.addEventListener("orientationchange", setH);
    return () => {
      window.visualViewport?.removeEventListener("resize", setH); window.removeEventListener("resize", setH); window.removeEventListener("orientationchange", setH);
      document.removeEventListener("gesturestart", noGesture); document.removeEventListener("touchmove", noPinch);
      if (meta) meta.content = oldMeta; de.classList.remove("callopen"); de.style.removeProperty("--callh"); document.body.style.top = ""; window.scrollTo(0, y);
    };
  }, [full]);
  // Remote picture: fill the screen when its shape matches, otherwise show it whole (no heavy cropping/zooming).
  useEffect(() => {
    const v = remoteVideo.current; if (!v) return;
    const upd = () => { if (fitManual.current || !v.videoWidth) return; const ra = v.videoWidth / v.videoHeight; const sa = window.innerWidth / window.innerHeight; setFit(Math.abs(Math.log(ra / sa)) < 0.4 ? "cover" : "contain"); };
    v.addEventListener("resize", upd); v.addEventListener("loadedmetadata", upd); window.addEventListener("resize", upd);
    return () => { v.removeEventListener("resize", upd); v.removeEventListener("loadedmetadata", upd); window.removeEventListener("resize", upd); };
  }, []);
  // Unread badge for the in-call chat.
  useEffect(() => {
    if (!callStarted) return;
    const t = setInterval(async () => {
      try {
        const d = await api(`/appointments/${appointmentId}/messages`); const n = (d.messages || []).filter((m: any) => String(m.senderId?._id) !== String(user?.id)).length;
        if (lastSeen.current < 0 || sheet === "chat") { lastSeen.current = n; setUnread(0); } else setUnread(Math.max(0, n - lastSeen.current));
      } catch {}
    }, 4000);
    return () => clearInterval(t);
  }, [callStarted, sheet, appointmentId]);

  // ---- controls ----
  function toggleMic() { const next = !muted; local.current?.getAudioTracks().forEach(t => { t.enabled = !next; }); setMuted(next); }
  function toggleCam() { const next = !camOff; if (camTrack.current) camTrack.current.enabled = !next; setCamOff(next); }
  function setOutgoingVideo(t: MediaStreamTrack) {
    const stream = local.current; if (!stream) return;
    [pc.current, ...Object.values(adminPeers.current)].forEach((p) => p?.getSenders().filter(x => x.track?.kind === "video").forEach(x => x.replaceTrack(t).catch(() => {})));
    stream.getVideoTracks().forEach(o => stream.removeTrack(o)); stream.addTrack(t); if (localVideo.current) localVideo.current.srcObject = stream;
  }
  // Optional "strong noise filter": high-pass/low-pass + soft noise gate + compressor on top of the browser's own noise suppression.
  function buildCleaner(raw: MediaStream) {
    const AC = (window as any).AudioContext || (window as any).webkitAudioContext; const ctx: AudioContext = new AC(); ctx.resume().catch(() => {});
    const src = ctx.createMediaStreamSource(new MediaStream(raw.getAudioTracks()));
    const hp = ctx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 120;
    const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 7500;
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -30; comp.knee.value = 20; comp.ratio.value = 4; comp.attack.value = 0.005; comp.release.value = 0.2;
    const gate = ctx.createGain(); const an = ctx.createAnalyser(); an.fftSize = 1024; const dest = ctx.createMediaStreamDestination();
    src.connect(hp); hp.connect(lp); lp.connect(an); lp.connect(gate); gate.connect(comp); comp.connect(dest);
    const buf = new Float32Array(an.fftSize);
    const timer = setInterval(() => { an.getFloatTimeDomainData(buf); let sum = 0; for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i]; const open = Math.sqrt(sum / buf.length) > 0.012; gate.gain.setTargetAtTime(open ? 1 : 0.12, ctx.currentTime, open ? 0.01 : 0.15); }, 50);
    return { track: dest.stream.getAudioTracks()[0], stop: () => { clearInterval(timer); ctx.close().catch(() => {}); } };
  }
  function swapOutgoingAudio(t: MediaStreamTrack) { [pc.current, ...Object.values(adminPeers.current)].forEach((p) => p?.getSenders().filter(x => x.track?.kind === "audio").forEach(x => x.replaceTrack(t).catch(() => {}))); }
  function toggleStrongNoise() {
    const raw = local.current?.getAudioTracks()[0]; if (!raw) return;
    if (cleaner.current) { swapOutgoingAudio(raw); cleaner.current.stop(); cleaner.current = null; setStrongNoise(false); say("Strong noise filter off (browser noise suppression stays on)."); return; }
    try { const c = buildCleaner(local.current!); cleaner.current = c; swapOutgoingAudio(c.track); setStrongNoise(true); say("Strong noise filter on. If your voice sounds cut, turn it off."); }
    catch { say("Strong noise filter is not supported on this device."); }
  }
  async function flipCamera() {
    try {
      const next = facing.current === "user" ? "environment" : "user";
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: next } }, audio: false }); const t = s.getVideoTracks()[0];
      const old = camTrack.current; camTrack.current = t; facing.current = next; t.enabled = !camOff; if (!sharing) setOutgoingVideo(t); old?.stop();
    } catch { say("Could not switch the camera."); }
  }
  async function toggleShare() {
    const stop = () => { screenTrack.current?.stop(); screenTrack.current = null; if (camTrack.current) setOutgoingVideo(camTrack.current); setSharing(false); };
    if (sharing) { stop(); return; }
    try {
      const s = await (navigator.mediaDevices as any).getDisplayMedia({ video: true }); const t: MediaStreamTrack = s.getVideoTracks()[0];
      screenTrack.current = t; t.onended = () => { if (screenTrack.current === t) stop(); }; setOutgoingVideo(t); setSharing(true);
    } catch {}
  }
  function enterFs() { try { if (!document.fullscreenElement) (document.documentElement as any).requestFullscreen?.({ navigationUI: "hide" })?.catch?.(() => {}); } catch {} }
  function exitFs() { try { if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); } catch {} }
  function toggleFullscreen() { if (document.fullscreenElement) exitFs(); else enterFs(); }
  function toggleFit() { fitManual.current = true; setFit(fit === "cover" ? "contain" : "cover"); }
  function openSheet(tab: "chat" | "help" | "record") { setSheet(sheet === tab ? null : tab); if (tab === "chat") setUnread(0); }
  function popOut() {
    const w = window.open(`/?call=${appointmentId}`, `medai_call_${appointmentId}`, "popup,width=1100,height=760");
    if (!w) { say("The browser blocked the new window. Allow pop-ups for this site and try again."); return; }
    cleanupCall(); setPopped(true); say("The call page opened in a new window.");
  }
  async function setMyConsent(accepted: boolean) {
    try { const d = await api(`/appointments/${appointmentId}/recording-consent`, { method: "POST", body: json({ accepted }) }); setConsent(d.consent); }
    catch (e: any) { say(e.message); }
  }
  async function startRecording() {
    try {
      if (!consent.patient || !consent.doctor) throw new Error("Both patient and doctor must consent first.");
      if (!local.current || !remote.current) throw new Error("Connect the call before recording.");
      const ctx = new AudioContext(); audioContext.current = ctx; const destination = ctx.createMediaStreamDestination();
      for (const stream of [local.current, remote.current]) { const tracks = stream.getAudioTracks(); if (tracks.length) ctx.createMediaStreamSource(new MediaStream(tracks)).connect(destination); }
      if (!destination.stream.getAudioTracks().length) throw new Error("No call audio track is available.");
      const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find(x => MediaRecorder.isTypeSupported(x));
      const r = new MediaRecorder(destination.stream, mime ? { mimeType: mime } : undefined); chunks.current = [];
      r.ondataavailable = e => { if (e.data.size) chunks.current.push(e.data); };
      r.onstop = async () => {
        try {
          const blob = new Blob(chunks.current, { type: r.mimeType || "audio/webm" });
          if (!blob.size) throw new Error("Recording was empty.");
          const fd = new FormData(); fd.append("file", blob, `consultation-${appointmentId}.webm`);
          const d = await postForm(`/appointments/${appointmentId}/recording`, fd, token); say(`${d.message}. It is private to the appointment participants.`);
        } catch (e: any) { say(`Recording could not be saved: ${e.message}`); }
        finally { await ctx.close().catch(() => {}); audioContext.current = null; loadRecordings(); }
      };
      recorder.current = r; r.start(1000); setRecording(true); say("Audio recording started. Video is not recorded.");
    } catch (e: any) { say(e.message); }
  }
  function stopRecording() { if (recorder.current?.state === "recording") { recorder.current.stop(); setRecording(false); } }
  function startSpeechTranscript() {
    const W = window as any; const Ctor = W.SpeechRecognition || W.webkitSpeechRecognition;
    if (!Ctor) { say("Speech recognition is not supported in this browser. You can type/edit the transcript manually."); return; }
    if (speechOn) { speechRecognition.current?.stop(); speechRecognition.current = null; setSpeechOn(false); return; }
    const recognition = new Ctor(); recognition.continuous = true; recognition.interimResults = false; recognition.lang = speechLang;
    recognition.onresult = (event: any) => { let add = ""; for (let i = event.resultIndex; i < event.results.length; i++) add += event.results[i][0].transcript + " "; setTranscript(old => (old + " " + add).trim()); };
    recognition.onerror = () => { setSpeechOn(false); speechRecognition.current = null; }; recognition.onend = () => { setSpeechOn(false); speechRecognition.current = null; };
    speechRecognition.current = recognition; recognition.start(); setSpeechOn(true); say("Speech recognition started; accuracy varies by language. Review and correct the transcript.");
  }
  async function analyzeTranscript() {
    setBusy(true); try { const d = await api(`/appointments/${appointmentId}/recording-analysis`, { method: "POST", body: json({ transcript }) }); setSummary(d.summary + "\n\n" + d.disclaimer); }
    catch (e: any) { say(e.message); } finally { setBusy(false); }
  }
  async function translate(to: "bn" | "en") {
    if (!trIn.trim()) return; setTrBusy(true);
    try { const d = await api(`/appointments/${appointmentId}/translate`, { method: "POST", body: json({ text: trIn.trim(), to }) }); setTrOut(d.translation || ""); }
    catch (e: any) { say(e.message); } finally { setTrBusy(false); }
  }
  async function sendChat(text: string) { try { await api(`/appointments/${appointmentId}/messages`, { method: "POST", body: json({ body: text, attachments: [] }) }); say("Sent in the call chat."); } catch (e: any) { say(e.message); } }

  // ---- UI pieces ----
  const recordPanel = <div className="consentbox"><b>Recording consent</b><p className="muted">Only audio is recorded (not video). Do not record unless both people explicitly agree. Saved audio is private to this appointment.</p>
    <div className="row"><button className={consent[myRole] ? "primary" : "outline"} onClick={() => setMyConsent(!consent[myRole])}>{consent[myRole] ? "Withdraw my consent" : "I consent to audio recording"}</button><span className="muted">Patient: {consent.patient ? "consented" : "not consented"} · Doctor: {consent.doctor ? "consented" : "not consented"}</span></div>
    <div className="row"><button className="outline" disabled={recording || !connected || !consent.patient || !consent.doctor} onClick={startRecording}>Start audio recording</button><button className="danger" disabled={!recording} onClick={stopRecording}>Stop &amp; save recording</button></div>
  </div>;
  const transcriptPanel = <div className="transcriptbox"><h4>Saved audio recordings</h4><button className="outline" onClick={loadRecordings}>Refresh recordings</button>{recordings.length === 0 && <p className="muted">No saved audio recordings for this appointment.</p>}{recordings.map((f: any) => <div className="row" key={f._id}><span>{f.originalName} · {fmtDay(f.createdAt)} · {fmtSize(f.size)}</span><button className="outline" onClick={() => downloadFile(token, f._id, f.originalName).catch((e) => say(e.message))}>Download audio</button></div>)}
    <h4>Transcript &amp; consultation summary</h4><p className="muted">Browser speech recognition or a pasted transcript. It may miss words and must be reviewed by the clinician. AI does not diagnose or prescribe.</p>
    <div className="row"><select value={speechLang} onChange={(e) => setSpeechLang(e.target.value)}><option value="en-US">English</option><option value="bn-BD">বাংলা (Bangla)</option></select><button className="outline" onClick={startSpeechTranscript}>{speechOn ? "Stop speech recognition" : "Start speech recognition"}</button></div>
    <textarea rows={5} value={transcript} onChange={e => setTranscript(e.target.value)} placeholder="Review or paste the consultation transcript…" />
    <button className="primary" disabled={busy || transcript.trim().length < 20 || !consent.patient || !consent.doctor} onClick={analyzeTranscript}>{busy ? "Analyzing…" : "Generate AI consultation summary"}</button>
    {summary && <pre className="answer">{summary}</pre>}</div>;
  const helpPanel = <div className="helpbox">
    <h4>🎙️ Noise cancellation</h4><p className="muted">Browser noise &amp; echo cancellation is always on. Turn on the strong filter in a noisy place (fan, street, crowd). Use headphones to avoid echo.</p>
    <button type="button" className={strongNoise ? "primary" : "outline"} disabled={!callStarted} onClick={toggleStrongNoise}>{strongNoise ? "Strong noise filter: ON" : "Strong noise filter: OFF"}</button>
    <h4>🌐 Translate (Bangla ⇄ English)</h4>
    <textarea rows={3} value={trIn} onChange={(e) => setTrIn(e.target.value)} placeholder="Type or paste text…" maxLength={1500} />
    <div className="row"><button className="outline" disabled={trBusy || !trIn.trim()} onClick={() => translate("bn")}>→ বাংলা</button><button className="outline" disabled={trBusy || !trIn.trim()} onClick={() => translate("en")}>→ English</button></div>
    {trOut && <div className="answer"><p>{trOut}</p><div className="row"><button className="outline" onClick={() => navigator.clipboard?.writeText(trOut).then(() => say("Copied."))}>Copy</button><button className="primary" onClick={() => sendChat(trOut)}>Send in chat</button></div></div>}
    <h4>Quick phrases</h4><p className="muted">Tap to send in the call chat (English + বাংলা).</p>
    {PHRASES.map(([en, bn]) => <button type="button" key={en} className="phrase" onClick={() => sendChat(`${en} / ${bn}`)}><span>{en}</span><span>{bn}</span></button>)}
    <h4>Having trouble?</h4>
    <ul className="muted"><li>No sound: check that you are not muted and the phone volume is up.</li><li>No picture: allow camera permission in the browser, or press 📹.</li><li>Slow or frozen: turn your camera off or end the call and start audio-only.</li><li>Send photos, reports or PDFs in the 💬 chat tab.</li><li>Emergency: hang up and call <b>999</b>.</li></ul>
  </div>;
  const mode = full ? "callfs" : (callStarted && minimized) ? "callpip" : "callhidden";
  const stage = <div ref={hostRef} className={"callstage " + mode + " fit-" + fit + (sheet ? " sheetopen" : "")}>
    <div className="callvideos">
      <div className="call-local"><video ref={localVideo} autoPlay playsInline muted /><small>You</small></div>
      <div className="call-remote"><video ref={remoteVideo} autoPlay playsInline />{callMode === "audio" && <div className="audioface"><span>🎧</span><b>Audio call</b></div>}<small>{connected ? "Connected" : "Connecting…"}</small></div>
    </div>
    {mode === "callfs" && callStarted && <>
      <div className="calltop"><span className={"callstatus" + (connected ? " on" : "")}>{connected ? "● " + fmtTime(secs) : connState === "disconnected" ? "○ Reconnecting…" : "○ Calling…"}</span><span className="callhint">MedAI {callMode} visit</span></div>
      {toast && <div className="calltoast">{toast}</div>}
      <div className="callbar2">
        {hasVideo && <button type="button" className="roundbtn sm" onClick={flipCamera} aria-label="Switch camera" title="Switch camera">🔄</button>}
        {canShare && hasVideo && <button type="button" className={"roundbtn sm" + (sharing ? " off" : "")} onClick={toggleShare} aria-label="Share screen" title="Share screen">🖥️</button>}
        <button type="button" className={"roundbtn sm" + (strongNoise ? " off" : "")} onClick={toggleStrongNoise} aria-label="Strong noise filter" title="Strong noise filter">🎙️</button>
        <button type="button" className={"roundbtn sm" + (sheet === "help" ? " off" : "")} onClick={() => openSheet("help")} aria-label="Help and translation" title="Help & translate">🌐</button>
        <button type="button" className={"roundbtn sm" + (sheet === "record" ? " off" : "")} onClick={() => openSheet("record")} aria-label="Recording" title="Recording & transcript">⏺</button>
        <button type="button" className={"roundbtn sm" + (fitManual.current && fit === "contain" ? " off" : "")} onClick={toggleFit} aria-label="Fit or fill" title="Fit whole picture / fill screen">⤢</button>
        <button type="button" className="roundbtn sm" onClick={toggleFullscreen} aria-label="Browser full screen" title="Full screen">⛶</button>
        <button type="button" className="roundbtn sm" onClick={() => { setSheet(null); setMinimized(true); }} aria-label="Minimize" title="Minimize">—</button>
      </div>
      <div className="callbar">
        <button type="button" className={"roundbtn" + (muted ? " off" : "")} onClick={toggleMic} aria-label={muted ? "Unmute" : "Mute"}>{muted ? "🔇" : "🎤"}</button>
        {hasVideo && <button type="button" className={"roundbtn" + (camOff ? " off" : "")} onClick={toggleCam} aria-label={camOff ? "Camera on" : "Camera off"}>{camOff ? "📷" : "📹"}</button>}
        <button type="button" className={"roundbtn" + (sheet === "chat" ? " off" : "")} onClick={() => openSheet("chat")} aria-label="Chat and files">💬{unread > 0 && <i className="badgedot">{unread}</i>}</button>
        <button type="button" className="roundbtn end" onClick={hangup} aria-label="End call">📞</button>
      </div>
      {sheet && <div className="callsheet">
        <div className="sheethead"><b>{sheet === "chat" ? "💬 Chat & files" : sheet === "help" ? "🌐 Help & translate" : "⏺ Recording"}</b><span style={{ flex: 1 }} />
          {(["chat", "help", "record"] as const).map((t) => <button type="button" key={t} className={sheet === t ? "primary" : "outline"} onClick={() => openSheet(t)}>{t === "chat" ? "💬" : t === "help" ? "🌐" : "⏺"}</button>)}
          <button type="button" className="danger sheetend" onClick={hangup}>End</button><button type="button" className="outline" onClick={() => setSheet(null)} aria-label="Close panel">✕</button></div>
        <div className="sheetbody">
          {sheet === "chat" && <Chat api={api} appointmentId={appointmentId} meId={user.id} token={token} pollMs={3000} />}
          {sheet === "help" && helpPanel}
          {sheet === "record" && <>{recordPanel}{transcriptPanel}</>}
        </div></div>}
    </>}
    {mode === "callpip" && <div className="pipbar"><span>{connected ? "● " + fmtTime(secs) : "○ …"}</span><button type="button" className="roundbtn sm" onClick={() => setMinimized(false)} aria-label="Open call">⛶</button><button type="button" className="roundbtn sm endsm" onClick={hangup} aria-label="End call">📞</button></div>}
  </div>;
  const ringUi = ringing && !callStarted ? <div className="callstage callfs ringscreen">
    <div className="ringbox"><div className="ringicon">{ringing.video ? "📹" : "📞"}</div><h2>{myRole === "patient" ? "Your doctor is calling" : "Incoming call"}</h2><p>{ringing.video ? "MedAI video visit" : "MedAI audio visit"}</p>
      <div className="ringbtns"><button type="button" className="roundbtn end big" disabled={busy} onClick={declineCall} aria-label="Decline">📞</button><button type="button" className="roundbtn accept big" disabled={busy} onClick={acceptCall} aria-label="Accept">{ringing.video ? "📹" : "📞"}</button></div>
      <small>Decline · Accept</small></div></div> : null;

  return <article className="full telecall">
    {createPortal(<>{stage}{ringUi}</>, document.body)}
    <h3>Secure online consultation</h3><p className="muted">Doctor starts the call, the patient gets a ringing screen and can accept. Works on phone and computer over HTTPS. Share photos, audio, video and PDFs in the call chat; use 🌐 for Bangla ⇄ English help.</p>
    {popped ? <div className="callmini"><span>The call is open in another window.</span><button type="button" className="primary" onClick={() => setPopped(false)}>Use the call here instead</button></div> : <>
      {callStarted && minimized && <div className="callmini"><span>{connected ? "● Call connected " + fmtTime(secs) : "○ Call in progress"}</span><button type="button" className="primary" onClick={() => setMinimized(false)}>⛶ Full screen</button><button type="button" className="danger" onClick={hangup}>End</button></div>}
      {ringing && !full && <div className="callmini"><span>📞 Incoming {ringing.video ? "video" : "audio"} call</span><button type="button" className="primary" disabled={busy} onClick={acceptCall}>Accept</button><button type="button" className="danger" onClick={declineCall}>Decline</button></div>}
      <div className="row"><button className="primary" disabled={busy || connected || callStarted} onClick={() => startCall("video")}>{myRole === "doctor" ? "📹 Start video call" : ringing ? "Accept call" : "Join video call"}</button><button className="outline" disabled={busy || connected || callStarted || myRole !== "doctor"} onClick={() => startCall("audio")}>📞 Start audio call</button>{!standalone && <button className="outline" disabled={callStarted || !!ringing} onClick={popOut}>↗ Open in new window</button>}<button className="danger" disabled={!callStarted} onClick={hangup}>End call</button><span className={connected ? "notice" : "muted"}>{connected ? "Connected" : callStarted ? "Connecting…" : "Not connected"}</span></div>
      {recordPanel}{transcriptPanel}</>}
    <p className="warn">Do not use this feature for emergencies — call 999. AI summaries and translations may be inaccurate and are not a substitute for clinician judgment. Recording and transcription may be subject to local laws and institutional policy.</p>
  </article>;
}
