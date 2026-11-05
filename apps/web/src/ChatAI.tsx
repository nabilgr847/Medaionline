// © 2026 MD Gausur Rahman Nabil. All rights reserved. MedAI Hospital.
import { useCallback, useEffect, useRef, useState } from "react";
import { API, json, postForm, downloadFile } from "./api";
import type { Api } from "./api";

type Msg = { role: "user" | "assistant"; content: string; level?: string; report?: any; file?: string; error?: boolean; preview?: string };

/** Shrink phone photos so AI analysis finishes before server timeout. */
async function compressImage(file: File, maxSide = 1600, quality = 0.72): Promise<File> {
  if (!file.type.startsWith("image/") || file.type === "image/gif") return file;
  if (file.size < 450_000) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close?.();
    const blob: Blob | null = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg", lastModified: Date.now() });
  } catch {
    return file;
  }
}


const STATUS: Record<string, { label: string; cls: string }> = {
  high: { label: "HIGH", cls: "high" }, low: { label: "LOW", cls: "low" }, normal: { label: "NORMAL", cls: "normal" }, unclear: { label: "CHECK", cls: "unclear" },
};
const URGENCY: Record<string, string> = { routine: "Routine", see_doctor_soon: "See a doctor soon", urgent: "Urgent: see a doctor promptly" };
const TYPE_LABEL: Record<string, string> = { lab: "📄 Lab report analysis", imaging: "🩻 Imaging report analysis", prescription: "💊 Prescription reading" };
const CHIPS = ["জ্বর হলে কী করবো?", "What does a high HbA1c mean?", "Paracetamol কীসের জন্য ব্যবহার হয়?", "Upload my blood test report"];

// Very small markdown: **bold**, "- " bullets, line breaks.
function inline(t: string) { return t.split(/(\*\*[^*]+\*\*)/g).map((p, i) => (p.startsWith("**") && p.endsWith("**") ? <b key={i}>{p.slice(2, -2)}</b> : <span key={i}>{p}</span>)); }
export function Md({ text }: { text: string }) {
  const lines = String(text || "").split("\n"); const out: any[] = []; let bullets: string[] = [];
  const flush = () => { if (bullets.length) { out.push(<ul key={"u" + out.length}>{bullets.map((b, i) => <li key={i}>{inline(b)}</li>)}</ul>); bullets = []; } };
  lines.forEach((l, i) => { const m = l.match(/^\s*(?:[-*•]|\d+[.)])\s+(.*)$/); if (m) bullets.push(m[1]); else { flush(); if (l.trim()) out.push(<p key={i}>{inline(l.replace(/^#+\s*/, ""))}</p>); } });
  flush(); return <>{out}</>;
}

export function FindingsList({ findings }: { findings: any[] }) {
  const [open, setOpen] = useState("");
  if (!findings?.length) return null;
  const c: Record<string, number> = { high: 0, low: 0, normal: 0, unclear: 0 }; findings.forEach((f) => { c[STATUS[f.status] ? f.status : "unclear"]++; });
  return <div className="findings">
    <div className="fsum">{(["high", "low", "normal", "unclear"] as const).map((k) => <span key={k} className={"fpill " + STATUS[k].cls}><b>{c[k]}</b> {k === "unclear" ? "needs check" : k}</span>)}</div>
    {findings.map((f, i) => { const s = STATUS[f.status] || STATUS.unclear; const has = f.measures || f.meaning || f.conflict || (f.status === "unclear" && f.check); return <div key={i} className={"frow " + s.cls}>
      <button type="button" className="fhead" onClick={() => setOpen(open === String(i) ? "" : String(i))} aria-expanded={open === String(i)}>
        <span className="fname">{f.name}</span><span className="fval">{f.value} {f.unit}</span><span className={"fstat " + s.cls}>{s.label}</span></button>
      <div className="frange">Range: {f.rangeUsed || f.normalRange || "n/a"}{f.rangeSource ? ` · ${f.rangeSource}` : ""}</div>
      {open === String(i) && has && <div className="fmore">{f.measures && <p><b>What it measures:</b> {f.measures}</p>}{f.meaning && <p><b>What this may mean:</b> {f.meaning}</p>}{f.conflict && <p className="warn">{f.conflict}</p>}{f.status === "unclear" && f.check && <p className="muted">{f.check}</p>}</div>}
    </div>; })}
  </div>;
}

const URGENCY_TITLE: Record<string, string> = { routine: "Routine follow-up", see_doctor_soon: "See a doctor soon", urgent: "Urgent: see a doctor promptly" };
const TYPE_WORD: Record<string, string> = { lab: "Lab report", imaging: "Imaging", prescription: "Prescription" };
const SOURCES: [string, string][] = [["MedlinePlus (NIH)", "https://medlineplus.gov"], ["NHS", "https://www.nhs.uk"], ["WHO", "https://www.who.int"], ["FDA Drug Information", "https://www.fda.gov/drugs"], ["DailyMed", "https://dailymed.nlm.nih.gov"], ["DGDA Bangladesh", "https://dgda.gov.bd"], ["MedEx Bangladesh", "https://medex.com.bd"]];

function flowOf(r: any) {
  const doc = r.doctorName || r.doctorId?.name || ""; const s = r.status;
  const approved = ["approved", "signed", "delivered"].includes(s); const rejected = s === "rejected";
  let tone = "warn"; let text = "";
  if (approved) { tone = "ok"; text = `✅ Approved by Dr. ${doc}. You can download the doctor-approved report below.`; }
  else if (rejected) { tone = "bad"; text = `❌ Dr. ${doc} did not approve this report.${r.rejectionReason ? " Reason: " + r.rejectionReason : ""}`; }
  else if (s === "changes_requested") text = `✏️ Dr. ${doc} asked for changes.${r.reviewComment ? " " + r.reviewComment : ""} Do not take any medicine yet.`;
  else if (s === "under_review") text = `🔎 Dr. ${doc} is reviewing your report now. Do not take any medicine yet.`;
  else if (doc) text = `⏳ AI DRAFT sent to Dr. ${doc}. Waiting for approval. Do not take any medicine yet.`;
  else text = "⏳ AI DRAFT created. Waiting for an admin to assign a doctor. Do not take any medicine yet.";
  const steps = [
    { label: "AI analysis", sub: "Done", st: "done" },
    { label: "Sent to doctor", sub: doc ? `Dr. ${doc}` : "Waiting for assignment", st: doc ? "done" : "current" },
    { label: "Doctor approval", sub: approved ? "Approved" : rejected ? "Not approved" : s === "changes_requested" ? "Changes requested" : s === "under_review" ? "In review" : "Waiting", st: approved ? "done" : rejected ? "bad" : doc ? "current" : "todo" },
  ];
  return { tone, text, steps };
}

export function ReportView({ api, token, report, previewUrl, onError }: { api: Api; token: string; report: any; previewUrl?: string; onError?: (s: string) => void }) {
  const [r, setR] = useState<any>(report); const [img, setImg] = useState<string>(previewUrl || "");
  const rid = r.id || r._id;
  const refresh = useCallback(async () => {
    try { const d = await api(`/reports/${rid}`); setR((o: any) => ({ ...o, ...d.report, doctorName: d.report?.doctorId?.name || o.doctorName })); } catch { /* keep what we already have */ }
  }, [api, rid]);
  useEffect(() => { refresh(); const t = setInterval(refresh, 30000); return () => clearInterval(t); }, [refresh]);
  useEffect(() => {
    if (img || !r.originalFileId) return; let dead = false;
    fetch(`${API}/api/files/${r.originalFileId}/download`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (res) => { if (!res.ok) return; const b = await res.blob(); if (!dead && b.type.startsWith("image/")) setImg(URL.createObjectURL(b)); })
      .catch(() => {});
    return () => { dead = true; };
  }, [r.originalFileId, img, token]);

  const st = r.aiStructured || {}; const type: string = r.docType || "lab"; const findings: any[] = r.findings || []; const flow = flowOf(r);
  const meta = [TYPE_WORD[type], st.report_date, st.facility, st.patientName || r.patientId?.name].filter(Boolean).join(" · ");
  const cnt = { normal: 0, high: 0, low: 0 }; findings.forEach((f) => { if (f.status === "normal") cnt.normal++; else if (f.status === "high") cnt.high++; else if (f.status === "low") cnt.low++; });
  const list = (v: any): string[] => (Array.isArray(v) ? v : []).map((x: any) => (typeof x === "string" ? x : [x?.name, x?.why].filter(Boolean).join(" – "))).filter(Boolean);
  const dl = (id: string, name: string) => downloadFile(token, id, name).catch((e) => onError?.(e.message));
  return <div className="rv">
    {img && <figure className="rv-img"><img src={img} alt="Your original file" /><figcaption>Your original file</figcaption></figure>}
    {type === "lab" && r.urgencyLevel && <div className={"rv-urg " + r.urgencyLevel}>{URGENCY_TITLE[r.urgencyLevel] || r.urgencyLevel}</div>}
    <div className="rv-meta">{meta}</div>
    {type === "lab" && findings.length > 0 && <div className="rv-counts"><div><b className="n">{cnt.normal}</b><span>Normal</span></div><div><b className="h">{cnt.high}</b><span>High</span></div><div><b className="l">{cnt.low}</b><span>Low</span></div></div>}
    <h3>Summary</h3><p>{st.summary || r.aiExplanation}</p>
    {list(st.stands_out).length > 0 && <><h3>What stands out</h3>{list(st.stands_out).map((s, i) => <blockquote key={i}>{s}</blockquote>)}</>}
    <h3>What to do next</h3>
    <ol className="rv-steps">{flow.steps.map((s, i) => <li key={i} className={s.st}><i>{s.st === "done" ? "✓" : s.st === "bad" ? "✕" : i + 1}</i><b>{s.label}</b><span>{s.sub}</span></li>)}</ol>
    <div className={"rv-status " + flow.tone}>{flow.text}</div>
    {st.bangla_summary && <><h3>বাংলা সারসংক্ষেপ</h3><p>{st.bangla_summary}</p></>}
    {list(st.tests_to_do).length > 0 && <><h3>Tests to do</h3><ul>{list(st.tests_to_do).map((s, i) => <li key={i}>{s}</li>)}</ul></>}
    <h3>Medicines</h3>
    {type === "prescription" && st.medicines?.length > 0
      ? <ul>{st.medicines.map((m: any, i: number) => <li key={i}><b>{m.name}</b>{[m.dose, m.frequency, m.duration].filter(Boolean).length > 0 && " · " + [m.dose, m.frequency, m.duration].filter(Boolean).join(" · ")}{m.purpose ? " — " + m.purpose : ""}</li>)}</ul>
      : <p>No medicine suggested. A doctor must examine first.</p>}
    {st.when_to_see_doctor && <><h3>When to see a doctor</h3><p>{st.when_to_see_doctor}</p></>}
    <h3>Medical information sources</h3><p className="rv-src">{SOURCES.map(([n, u]) => <a key={n} href={u} target="_blank" rel="noopener noreferrer">{n} ↗</a>)}</p>
    {findings.length > 0 && <><h3>All results and ranges ({findings.length})</h3><FindingsList findings={findings} /></>}
    {list(st.questions_to_ask).length > 0 && <><h3>Questions to ask your doctor</h3><ul>{list(st.questions_to_ask).map((s, i) => <li key={i}>{s}</li>)}</ul></>}
    {list(st.general_tips).length > 0 && <><h3>General tips</h3><ul>{list(st.general_tips).map((s, i) => <li key={i}>{s}</li>)}</ul></>}
    <p className="muted">AI information only. Not a diagnosis. A registered doctor decides your tests and medicines. Emergency: call 999. The AI can misread a file, so always compare with your original report.</p>
    <div className="row">
      {r.aiPdfFileId && <button className="primary" onClick={() => dl(r.aiPdfFileId, "MedAI-report-analysis.pdf")}>⬇️ Download PDF</button>}
      {r.finalPdfFileId && <button className="primary" onClick={() => dl(r.finalPdfFileId, "doctor-approved-report.pdf")}>⬇️ Doctor-approved PDF</button>}
      <button className="outline" onClick={refresh}>↻ Check status</button>
    </div>
  </div>;
}

export default function ChatAI({ api, token, setMessage }: { api: Api; token: string; setMessage: (s: string) => void }) {
  const [msgs, setMsgs] = useState<Msg[]>([]); const [text, setText] = useState(""); const [busy, setBusy] = useState(false); const [file, setFile] = useState<File | null>(null); const [listening, setListening] = useState(false);
  const [chatId, setChatId] = useState(""); const [chats, setChats] = useState<{ _id: string; title: string; updatedAt: string }[]>([]); const [hist, setHist] = useState(false); const skipSave = useRef(true);
  const loadChats = useCallback(async () => { try { const d = await api("/ai/chats"); setChats(d.chats || []); } catch { /* history is best-effort */ } }, [api]);
  useEffect(() => { loadChats(); }, []);
  useEffect(() => {
    if (busy || !msgs.length) return; if (skipSave.current) { skipSave.current = false; return; }
    const t = setTimeout(async () => {
      try {
        if (chatId) await api(`/ai/chats/${chatId}`, { method: "PUT", body: json({ messages: msgs }) });
        else { const d = await api("/ai/chats", { method: "POST", body: json({ messages: msgs }) }); skipSave.current = true; setChatId(d.chat._id); }
        loadChats();
      } catch { /* keep chatting even if saving fails */ }
    }, 400);
    return () => clearTimeout(t);
  }, [msgs, busy]);
  function newChat() { skipSave.current = true; setChatId(""); setMsgs([]); setFile(null); setText(""); setHist(false); }
  async function openChat(id: string) {
    try { const d = await api(`/ai/chats/${id}`); skipSave.current = true; setChatId(id); setMsgs(d.chat.messages || []); setFile(null); setHist(false); } catch (e: any) { setMessage(e.message); }
  }
  async function delChat(id: string) {
    if (!confirm("Delete this chat?")) return;
    try { await api(`/ai/chats/${id}`, { method: "DELETE" }); if (id === chatId) newChat(); loadChats(); } catch (e: any) { setMessage(e.message); }
  }
  const endRef = useRef<HTMLDivElement>(null); const fileRef = useRef<HTMLInputElement>(null); const taRef = useRef<HTMLTextAreaElement>(null); const recRef = useRef<any>(null);
  const SR: any = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [msgs, busy]);
  useEffect(() => { const t = taRef.current; if (t) { t.style.height = "auto"; t.style.height = Math.min(t.scrollHeight, 140) + "px"; } }, [text]);

  async function send(preset?: string) {
    const q = (preset ?? text).trim(); if (busy || (!q && !file)) return;
    if (!file && preset === CHIPS[3]) { fileRef.current?.click(); return; }
    const f = file; setText(""); setFile(null); setBusy(true); skipSave.current = false;
    const history = msgs.filter((m) => !m.report && !m.error).slice(-8).map((m) => ({ role: m.role, content: m.content }));
    setMsgs((m) => [...m, { role: "user", content: q || "Please analyse this report", file: f?.name }]);
    try {
      if (f) {
        const ready = await compressImage(f);
        const fd = new FormData(); fd.append("file", ready); fd.append("category", "patient_report");
        const up = await postForm("/files/upload", fd, token);
        const an = await api(`/reports/${up.file.id}/analyze`, { method: "POST", body: json({}) });
        setMsgs((m) => [...m, { role: "assistant", content: "I read your report. Here is a simple summary:", report: an.report, preview: ready.type.startsWith("image/") ? URL.createObjectURL(ready) : "" }]);
        if (q) { const d = await api("/ai/health-information", { method: "POST", body: json({ question: q + "\n\n(Context: the patient just uploaded a lab report; summary is shown above.)", history }) }); setMsgs((m) => [...m, { role: "assistant", content: d.answer, level: d.level }]); }
      } else {
        const d = await api("/ai/health-information", { method: "POST", body: json({ question: q, history }) });
        setMsgs((m) => [...m, { role: "assistant", content: d.answer, level: d.level }]);
      }
    } catch (e: any) {
      const tip = (e?.message || "").toLowerCase().includes("timeout") || (e?.message || "").toLowerCase().includes("timed out")
        ? " Tip: take a closer, clearer photo of only the result table and try again."
        : (e?.message || "").toLowerCase().includes("not configured")
        ? " The hospital AI key may be missing on the server."
        : " You can also open My reports and use Analyze there, or paste the values as text.";
      setMsgs((m) => [...m, { role: "assistant", content: (e.message || "Could not analyse this report.") + tip, error: true }]);
    }
    finally { setBusy(false); taRef.current?.focus(); }
  }
  function mic() {
    if (!SR) return; if (listening) { recRef.current?.stop(); return; }
    const r = new SR(); r.lang = "bn-BD"; r.interimResults = false; r.onresult = (e: any) => setText((t) => (t ? t + " " : "") + e.results[0][0].transcript); r.onend = () => setListening(false); r.onerror = () => setListening(false);
    recRef.current = r; setListening(true); r.start();
  }
  return <div className={"chatapp" + (hist ? " histopen" : "")}>
    <aside className="chathist" aria-label="Previous chats">
      <div className="histtop"><button type="button" className="primary" onClick={newChat}>＋ New chat</button></div>
      <div className="histlist">{chats.length === 0 && <p className="muted">No saved chats yet.</p>}
        {chats.map((c) => <div key={c._id} className={"histitem" + (c._id === chatId ? " on" : "")}><button type="button" className="histbtn" onClick={() => openChat(c._id)} title={c.title}><span>{c.title}</span><small>{new Date(c.updatedAt).toLocaleDateString()}</small></button><button type="button" className="histdel" aria-label="Delete chat" onClick={() => delChat(c._id)}>🗑</button></div>)}</div>
    </aside>
    <div className="chatmain">
    <div className="chathead"><button type="button" className="outline histtoggle" onClick={() => setHist(!hist)} aria-label="Chat history">☰</button><img src="/branding/favicon.svg" alt="" /><div><b>MedAI Assistant</b><small><i className="dot" /> Ask about health, medicines or upload a lab report</small></div>
      <button className="outline" onClick={newChat}>＋ New chat</button></div>
    <div className="chatlog2" aria-live="polite">
      {msgs.length === 0 && <div className="chatempty"><img src="/branding/favicon.svg" alt="" /><h3>How can I help today?</h3><p>বাংলা বা English, যেকোনো ভাষায় লিখুন। I can explain symptoms, medicines and lab reports in simple words.</p>
        <div className="chips">{CHIPS.map((c) => <button key={c} type="button" className="chip" onClick={() => send(c)}>{c}</button>)}</div></div>}
      {msgs.map((m, i) => <div key={i} className={"cmsg " + m.role + (m.level === "emergency" ? " emergency" : "") + (m.error ? " err" : "")}>
        {m.role === "assistant" && <img className="av" src="/branding/favicon.svg" alt="" />}
        <div className="cbub">{m.file && <div className="cfile">📎 {m.file}</div>}<Md text={m.content} />{m.report && <ReportView api={api} token={token} report={m.report} previewUrl={m.preview} onError={setMessage} />}</div></div>)}
      {busy && <div className="cmsg assistant"><img className="av" src="/branding/favicon.svg" alt="" /><div className="cbub typing"><i /><i /><i /></div></div>}
      <div ref={endRef} />
    </div>
    <p className="cnote">AI can make mistakes. For emergencies call 999. It does not replace a doctor.</p>
    {file && <div className="attached">📎 {file.name} <button type="button" onClick={() => setFile(null)} aria-label="Remove file">✕</button></div>}
    <div className="composer">
      <input ref={fileRef} type="file" hidden accept=".pdf,.jpg,.jpeg,.png,.webp" onChange={(e) => { setFile(e.target.files?.[0] || null); e.target.value = ""; }} />
      <button type="button" className="cbtn" onClick={() => fileRef.current?.click()} aria-label="Attach lab report" title="Attach lab report (PDF/image)">＋</button>
      <textarea ref={taRef} rows={1} value={text} placeholder={file ? "Add a question about this report (optional)…" : "Message MedAI…"} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} />
      {SR && <button type="button" className={"cbtn" + (listening ? " rec" : "")} onClick={mic} aria-label="Voice input" title="Voice input (Bangla)">🎤</button>}
      <button type="button" className="cbtn send" onClick={() => send()} disabled={busy || (!text.trim() && !file)} aria-label="Send">↑</button>
    </div>
  </div>
  </div>;
}
