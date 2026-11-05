import { useEffect, useRef, useState } from "react";
import { json, postForm, downloadFile } from "./api";
import type { Api } from "./api";

type Msg = { role: "user" | "assistant"; content: string; level?: string; report?: any; file?: string; error?: boolean };

const STATUS: Record<string, { label: string; cls: string }> = {
  high: { label: "HIGH", cls: "high" }, low: { label: "LOW", cls: "low" }, normal: { label: "NORMAL", cls: "normal" }, unclear: { label: "CHECK", cls: "unclear" },
};
const URGENCY: Record<string, string> = { routine: "Routine", see_doctor_soon: "See a doctor soon", urgent: "Urgent: see a doctor promptly" };
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

function ReportCard({ r, token, setMessage }: { r: any; token: string; setMessage: (s: string) => void }) {
  return <div className="reportcard">
    <div className="rchead"><b>📄 Lab report analysis</b>{r.urgencyLevel && <span className={"fpill urg " + r.urgencyLevel}>{URGENCY[r.urgencyLevel] || r.urgencyLevel}</span>}</div>
    <FindingsList findings={r.findings} />
    {r.aiExplanation && <div className="rexp"><Md text={r.aiExplanation} /></div>}
    <div className="row">{r.aiPdfFileId && <button className="primary" onClick={() => downloadFile(token, r.aiPdfFileId, "MedAI-report-analysis.pdf").catch((e) => setMessage(e.message))}>⬇️ Download PDF</button>}</div>
    <p className="muted">{r.doctorAssigned ? "Sent to your doctor for review." : "No doctor assigned yet: an admin will assign one for review."} AI-generated; not a diagnosis.</p>
  </div>;
}

export default function ChatAI({ api, token, setMessage }: { api: Api; token: string; setMessage: (s: string) => void }) {
  const [msgs, setMsgs] = useState<Msg[]>([]); const [text, setText] = useState(""); const [busy, setBusy] = useState(false); const [file, setFile] = useState<File | null>(null); const [listening, setListening] = useState(false);
  const endRef = useRef<HTMLDivElement>(null); const fileRef = useRef<HTMLInputElement>(null); const taRef = useRef<HTMLTextAreaElement>(null); const recRef = useRef<any>(null);
  const SR: any = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [msgs, busy]);
  useEffect(() => { const t = taRef.current; if (t) { t.style.height = "auto"; t.style.height = Math.min(t.scrollHeight, 140) + "px"; } }, [text]);

  async function send(preset?: string) {
    const q = (preset ?? text).trim(); if (busy || (!q && !file)) return;
    if (!file && preset === CHIPS[3]) { fileRef.current?.click(); return; }
    const f = file; setText(""); setFile(null); setBusy(true);
    const history = msgs.filter((m) => !m.report && !m.error).slice(-8).map((m) => ({ role: m.role, content: m.content }));
    setMsgs((m) => [...m, { role: "user", content: q || "Please analyse this report", file: f?.name }]);
    try {
      if (f) {
        const fd = new FormData(); fd.append("file", f); fd.append("category", "patient_report");
        const up = await postForm("/files/upload", fd, token);
        const an = await api(`/reports/${up.file.id}/analyze`, { method: "POST", body: json({}) });
        setMsgs((m) => [...m, { role: "assistant", content: "I read your report. Here is a simple summary:", report: an.report }]);
        if (q) { const d = await api("/ai/health-information", { method: "POST", body: json({ question: q + "\n\n(Context: the patient just uploaded a lab report; summary is shown above.)", history }) }); setMsgs((m) => [...m, { role: "assistant", content: d.answer, level: d.level }]); }
      } else {
        const d = await api("/ai/health-information", { method: "POST", body: json({ question: q, history }) });
        setMsgs((m) => [...m, { role: "assistant", content: d.answer, level: d.level }]);
      }
    } catch (e: any) { setMsgs((m) => [...m, { role: "assistant", content: e.message || "Something went wrong. Please try again.", error: true }]); }
    finally { setBusy(false); taRef.current?.focus(); }
  }
  function mic() {
    if (!SR) return; if (listening) { recRef.current?.stop(); return; }
    const r = new SR(); r.lang = "bn-BD"; r.interimResults = false; r.onresult = (e: any) => setText((t) => (t ? t + " " : "") + e.results[0][0].transcript); r.onend = () => setListening(false); r.onerror = () => setListening(false);
    recRef.current = r; setListening(true); r.start();
  }
  return <div className="chatapp">
    <div className="chathead"><img src="/branding/favicon.svg" alt="" /><div><b>MedAI Assistant</b><small><i className="dot" /> Ask about health, medicines or upload a lab report</small></div>
      {msgs.length > 0 && <button className="outline" onClick={() => { setMsgs([]); setFile(null); }}>＋ New chat</button>}</div>
    <div className="chatlog2" aria-live="polite">
      {msgs.length === 0 && <div className="chatempty"><img src="/branding/favicon.svg" alt="" /><h3>How can I help today?</h3><p>বাংলা বা English, যেকোনো ভাষায় লিখুন। I can explain symptoms, medicines and lab reports in simple words.</p>
        <div className="chips">{CHIPS.map((c) => <button key={c} type="button" className="chip" onClick={() => send(c)}>{c}</button>)}</div></div>}
      {msgs.map((m, i) => <div key={i} className={"cmsg " + m.role + (m.level === "emergency" ? " emergency" : "") + (m.error ? " err" : "")}>
        {m.role === "assistant" && <img className="av" src="/branding/favicon.svg" alt="" />}
        <div className="cbub">{m.file && <div className="cfile">📎 {m.file}</div>}<Md text={m.content} />{m.report && <ReportCard r={m.report} token={token} setMessage={setMessage} />}</div></div>)}
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
  </div>;
}
