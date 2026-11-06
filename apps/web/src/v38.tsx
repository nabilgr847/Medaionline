// © 2026 MD Gausur Rahman Nabil. All rights reserved. MedAI Hospital.
// V3.8: combined multi-report analysis (patient + doctor), admin System tab, admin recovery page.
import { useEffect, useState } from "react";
import { Api, json, fmtDay, fmtDate, label, makeApi } from "./api";

const URG: Record<string, string> = { routine: "🟢 Routine", soon: "🟠 See a doctor soon", urgent: "🔴 Urgent - see a doctor today" };
const LIKE: Record<string, string> = { low: "Low", moderate: "Moderate", high: "High" };

function Trends({ trends }: { trends: any[] }) {
  if (!trends?.length) return null;
  const arrow: Record<string, string> = { rising: "↗", falling: "↘", stable: "→", unknown: "·" };
  return <div><b>Changes between reports</b>{trends.slice(0, 12).map((t: any, i: number) => <p key={i} className={t.stillAbnormal ? "warn" : "muted"}>{arrow[t.direction]} {t.name}: {t.points.map((p: any) => p.value).join(" → ")} {t.unit} {t.changePct != null ? `(${t.changePct > 0 ? "+" : ""}${t.changePct}%)` : ""}{t.stillAbnormal ? " · still outside range" : ""}</p>)}</div>;
}

function AiView({ ai }: { ai: any }) {
  if (!ai) return null;
  return <div>
    <p style={{ whiteSpace: "pre-wrap" }}>{ai.summary}</p>
    {ai.urgency && <p><b>{URG[ai.urgency]}</b></p>}
    {(ai.redFlags || []).map((r: string, i: number) => <p key={i} className="warn">⚠️ {r}</p>)}
    {(ai.patterns || []).length > 0 && <><b>Patterns found</b>{ai.patterns.map((x: string, i: number) => <p key={i}>• {x}</p>)}</>}
    {(ai.possibleConditions || []).length > 0 && <><b>Possible conditions to discuss with a doctor</b>{ai.possibleConditions.map((c: any, i: number) => <div key={i} className="sgitem"><b>{c.name}</b> <span className="muted">likelihood: {LIKE[c.likelihood] || c.likelihood}</span>{(c.evidence || []).map((e: string, j: number) => <p key={j} className="muted">– {e}</p>)}{c.note && <p>{c.note}</p>}</div>)}</>}
    {ai.suggestedSpecialty && <p><b>Suggested specialist:</b> {ai.suggestedSpecialty}</p>}
    {(ai.suggestedTests || []).length > 0 && <><b>Tests worth discussing</b>{ai.suggestedTests.map((t: any, i: number) => <p key={i}>• {t.name} <span className="muted">{t.reason}</span></p>)}</>}
  </div>;
}

function FinalView({ f }: { f: any }) {
  if (!f) return null;
  return <div>
    <p style={{ whiteSpace: "pre-wrap" }}>{f.summary}</p>{f.urgency && <p><b>{URG[f.urgency]}</b></p>}
    {(f.conditions || []).map((c: any, i: number) => <div key={i} className="sgitem"><b>{c.name}</b> {c.likelihood && <span className="muted">({c.likelihood})</span>}{c.note && <p>{c.note}</p>}</div>)}
    {f.specialty && <p><b>Specialist:</b> {f.specialty}</p>}{(f.tests || []).length > 0 && <p><b>Tests:</b> {f.tests.join(", ")}</p>}{f.advice && <p><b>Advice:</b> {f.advice}</p>}
  </div>;
}

/** Patient tab: pick 2+ analysed reports, get a combined analysis, see doctor-approved result. */
export function PatientCombined({ api, setMessage }: { api: Api; setMessage: (s: string) => void }) {
  const [reports, setReports] = useState<any[]>([]); const [list, setList] = useState<any[]>([]); const [sel, setSel] = useState<string[]>([]); const [busy, setBusy] = useState(false); const [lang, setLang] = useState("en");
  async function load() { try { const r = await api("/reports/mine"); setReports((r.reports || []).filter((x: any) => (x.findings || []).length > 0 || x.status !== "uploaded")); const m = await api("/multi-analyses/mine"); setList(m.analyses || []); } catch (e: any) { setMessage(e.message); } }
  useEffect(() => { load(); }, []);
  const toggle = (id: string) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  async function run() { setBusy(true); try { await api("/ai/multi-report-analysis", { method: "POST", body: json({ reportIds: sel, lang }) }); setSel([]); setMessage("Combined analysis ready. It is sent to a doctor for review."); await load(); } catch (e: any) { setMessage(e.message); } finally { setBusy(false); } }
  return <div className="grid"><article className="full"><h3>🔬 Combined report analysis</h3>
    <p className="muted">Choose two or more of your reports (for example the same test on different dates, or blood + urine + X-ray). AI looks at all of them together, shows how values changed, and lists possible conditions to discuss with a doctor. A doctor then reviews it. This is not a diagnosis.</p>
    {reports.length < 2 && <p className="notice">Upload and analyse at least 2 reports in “My reports” first.</p>}
    {reports.map((r) => <label key={r._id} className="row" style={{ alignItems: "center", gap: 8 }}><input type="checkbox" style={{ width: "auto" }} checked={sel.includes(r._id)} onChange={() => toggle(r._id)} /> {label(r.docType)} · {fmtDay(r.createdAt)} · <span className="muted">{label(r.status)}</span></label>)}
    <div className="row"><select value={lang} onChange={(e) => setLang(e.target.value)}><option value="en">English</option><option value="bn">বাংলা</option></select><button className="primary" disabled={busy || sel.length < 2} onClick={run}>{busy ? "Analysing…" : `Analyse ${sel.length || ""} reports together`}</button></div>
  </article>
    {list.map((a) => <article className="full" key={a._id}>
      <div className="itemhead"><b>{a.status === "approved" ? "✅ Doctor approved" : a.status === "rejected" ? "↩ Doctor could not confirm" : "⏳ AI draft - waiting for doctor"}</b><time>{fmtDate(a.createdAt)}</time><span>{(a.reportIds || []).length} reports</span></div>
      {a.status === "approved" ? <><FinalView f={a.doctorFinal} />{a.doctorNote && <p className="muted">Doctor’s note: {a.doctorNote}</p>}{a.doctorId?.name && <p className="muted">Reviewed by Dr. {a.doctorId.name}</p>}</>
        : a.status === "rejected" ? <p>{a.doctorNote || "Please book an appointment so your doctor can discuss these reports with you."}</p>
          : <><p className="notice">This is an AI draft and has not been checked by a doctor yet.</p><AiView ai={a.draft} /></>}
      <Trends trends={a.trends} />
    </article>)}
  </div>;
}

/** Doctor tab: review patients' combined analyses, or start one for your own patient. */
export function DoctorCombined({ api, setMessage }: { api: Api; setMessage: (s: string) => void }) {
  const [list, setList] = useState<any[]>([]); const [pats, setPats] = useState<any[]>([]); const [pid, setPid] = useState(""); const [sel, setSel] = useState<string[]>([]); const [busy, setBusy] = useState(false); const [open, setOpen] = useState("");
  async function load() { try { setList((await api("/doctor/multi-analyses")).analyses || []); setPats((await api("/doctor/patients-with-reports")).patients || []); } catch (e: any) { setMessage(e.message); } }
  useEffect(() => { load(); }, []);
  const p = pats.find((x) => x._id === pid);
  async function run() { setBusy(true); try { await api("/ai/multi-report-analysis", { method: "POST", body: json({ patientId: pid, reportIds: sel }) }); setSel([]); setMessage("Combined analysis created. Review and approve it below."); await load(); } catch (e: any) { setMessage(e.message); } finally { setBusy(false); } }
  return <div className="grid"><article className="full"><h3>🔬 Combined report analysis</h3>
    <p className="muted">Patients can analyse several reports together; those requests appear below for your review. You can also start one for your own patient.</p>
    <div className="row"><select value={pid} onChange={(e) => { setPid(e.target.value); setSel([]); }}><option value="">Choose a patient with 2+ analysed reports…</option>{pats.map((x) => <option key={x._id} value={x._id}>{x.name} ({x.reports.length} reports)</option>)}</select></div>
    {p && p.reports.map((r: any) => <label key={r._id} className="row" style={{ alignItems: "center", gap: 8 }}><input type="checkbox" style={{ width: "auto" }} checked={sel.includes(r._id)} onChange={() => setSel((s) => (s.includes(r._id) ? s.filter((x) => x !== r._id) : [...s, r._id]))} /> {label(r.docType)} · {fmtDay(r.createdAt)}</label>)}
    {p && <button className="primary" disabled={busy || sel.length < 2} onClick={run}>{busy ? "Analysing…" : `Analyse ${sel.length || ""} reports together`}</button>}
  </article>
    {list.length === 0 && <article className="full"><p className="muted">No combined analyses yet.</p></article>}
    {list.map((a) => <article className="full" key={a._id}>
      <div className="itemhead"><b>{a.patientId?.name || "Patient"}</b><span>{a.status === "pending_doctor_review" ? "⏳ Needs review" : a.status === "approved" ? "✅ Approved" : "↩ Rejected"}</span><time>{fmtDate(a.createdAt)}</time></div>
      {a.status === "pending_doctor_review" ? (open === a._id ? <ReviewBox api={api} a={a} done={() => { setOpen(""); load(); }} setMessage={setMessage} /> : <><AiView ai={a.ai} /><Trends trends={a.trends} /><button className="primary" onClick={() => setOpen(a._id)}>Review &amp; approve</button></>)
        : <><FinalView f={a.doctorFinal} /><Trends trends={a.trends} /></>}
    </article>)}
  </div>;
}

function ReviewBox({ api, a, done, setMessage }: { api: Api; a: any; done: () => void; setMessage: (s: string) => void }) {
  const ai = a.ai || {};
  const [f, setF] = useState<Record<string, string>>({ summary: ai.summary || "", urgency: ai.urgency || "routine", specialty: ai.suggestedSpecialty || "", advice: "", tests: (ai.suggestedTests || []).map((t: any) => t.name).join("\n"), conditions: (ai.possibleConditions || []).map((c: any) => `${c.name} | ${c.likelihood} | ${c.note || ""}`).join("\n") });
  const [note, setNote] = useState("");
  async function send(decision: string) {
    const conditions = f.conditions.split("\n").map((l: string) => l.trim()).filter(Boolean).map((l: string) => { const [name, likelihood, ...n] = l.split("|").map((x: string) => x.trim()); return { name, likelihood: likelihood || "", note: n.join(" | ") }; });
    try { await api(`/multi-analyses/${a._id}/review`, { method: "POST", body: json({ decision, note, final: { summary: f.summary, urgency: f.urgency, specialty: f.specialty, advice: f.advice, tests: f.tests.split("\n").map((x: string) => x.trim()).filter(Boolean), conditions } }) }); setMessage(decision === "approve" ? "Approved. The patient can now see it." : "Marked as not confirmed."); done(); } catch (e: any) { setMessage(e.message); }
  }
  return <div className="record"><AiView ai={ai} /><Trends trends={a.trends} /><hr />
    <b>Your final version (edit anything)</b>
    <label>Summary<textarea rows={4} value={f.summary} onChange={(e) => setF({ ...f, summary: e.target.value })} /></label>
    <label>Conditions (one per line: name | likelihood | note)<textarea rows={4} value={f.conditions} onChange={(e) => setF({ ...f, conditions: e.target.value })} /></label>
    <label>Tests (one per line)<textarea rows={3} value={f.tests} onChange={(e) => setF({ ...f, tests: e.target.value })} /></label>
    <div className="cols"><label>Specialist<input value={f.specialty} onChange={(e) => setF({ ...f, specialty: e.target.value })} /></label><label>Urgency<select value={f.urgency} onChange={(e) => setF({ ...f, urgency: e.target.value })}><option value="routine">Routine</option><option value="soon">Soon</option><option value="urgent">Urgent</option></select></label></div>
    <label>Advice for patient<textarea rows={2} value={f.advice} onChange={(e) => setF({ ...f, advice: e.target.value })} /></label>
    <label>Private note / message to patient<input value={note} onChange={(e) => setNote(e.target.value)} /></label>
    <div className="row"><button className="primary" onClick={() => send("approve")}>✅ Approve for patient</button><button className="danger" onClick={() => send("reject")}>Cannot confirm</button><button className="outline" onClick={done}>Close</button></div>
  </div>;
}

/** Admin tab: health checks, one-click fixes, and a "why can't this user get in?" doctor. */
export function AdminSystem({ api, setMessage }: { api: Api; setMessage: (s: string) => void }) {
  const [h, setH] = useState<any>(null); const [busy, setBusy] = useState(""); const [q, setQ] = useState(""); const [users, setUsers] = useState<any[]>([]); const [diag, setDiag] = useState<any>(null); const [uid, setUid] = useState("");
  async function load() { try { setH(await api("/admin/system/health")); } catch (e: any) { setMessage(e.message); } }
  useEffect(() => { load(); }, []);
  async function fix(action: string) { setBusy(action); try { const d = await api("/admin/system/fix", { method: "POST", body: json({ action }) }); setMessage(d.message); load(); } catch (e: any) { setMessage(e.message); } finally { setBusy(""); } }
  async function find() { try { const d = await api("/admin/users" + (q ? `?q=${encodeURIComponent(q)}` : "")); setUsers((d.users || []).filter((u: any) => !q || (u.name + u.email).toLowerCase().includes(q.toLowerCase())).slice(0, 8)); } catch (e: any) { setMessage(e.message); } }
  async function check(id: string) { setUid(id); try { setDiag(await api(`/admin/users/${id}/access-check`)); } catch (e: any) { setMessage(e.message); } }
  async function activate() { try { const d = await api(`/admin/users/${uid}/fix-access`, { method: "POST", body: json({}) }); setMessage(d.message); check(uid); } catch (e: any) { setMessage(e.message); } }
  const FIXES: [string, string][] = [["test_email", "Send test email"], ["test_ai", "Test AI"], ["rebuild_indexes", "Rebuild database indexes"], ["clear_stale_calls", "Clear stuck calls"], ["resolve_all_errors", "Resolve all errors"]];
  return <div className="grid">
    <article className="full"><h3>🛠 System health &amp; recovery</h3>
      <p className="muted">If the website or an app feature is not working, check here first. Each red item says exactly what to change.</p>
      {!h && <p className="muted">Checking…</p>}
      {h && h.checks.map((c: any) => <div key={c.id} className={"sgitem" + (c.ok ? "" : " bad")}><b>{c.ok ? "✅" : "❌"} {c.label}</b> <span className="muted">{c.detail}</span>{!c.ok && <p>{c.fix}</p>}</div>)}
      {h && h.topErrors.length > 0 && <><b>Most frequent errors (24h)</b>{h.topErrors.map((e: any, i: number) => <p key={i} className="muted">{e.count}× {e.message} <small>{e.path}</small></p>)}</>}
      <div className="row">{FIXES.map(([k, t]) => <button key={k} className="outline" disabled={!!busy} onClick={() => fix(k)}>{busy === k ? "Working…" : t}</button>)}<button className="outline" onClick={load}>↻ Re-check</button></div>
    </article>
    <article className="full"><h3>🔑 Someone cannot get in?</h3>
      <p className="muted">Search the user, see why sign-in fails, and fix it.</p>
      <div className="row"><input placeholder="Name or email" value={q} onChange={(e) => setQ(e.target.value)} /><button className="outline" onClick={find}>Search</button></div>
      {users.map((u) => <p key={u._id}>{u.name} <span className="muted">{u.email} · {u.role} · {u.status}</span> <button className="suggestion" onClick={() => check(u._id)}>Check</button></p>)}
      {diag && <div className="notice"><b>{diag.user.name}</b> · {diag.user.role} · {diag.user.status}{diag.user.lastLoginAt ? " · last sign-in " + fmtDate(diag.user.lastLoginAt) : ""}{diag.problems.map((p: string, i: number) => <p key={i}>• {p}</p>)}{diag.actions.map((p: string, i: number) => <p key={i} className="muted">→ {p}</p>)}{diag.canActivate && <button className="primary" onClick={activate}>Unlock / activate account</button>}</div>}
    </article>
    <article className="full"><h3>🚨 Locked out of the admin account?</h3>
      <p className="muted">Open <b>your-site/?recovery=1</b>. It works only if <code>ADMIN_RECOVERY_KEY</code> is set in the Render API environment (24+ characters).</p></article>
  </div>;
}

/** Public page /?recovery=1 : reset the admin password with the server recovery key. */
export function AdminRecovery() {
  const [key, setKey] = useState(""); const [email, setEmail] = useState(""); const [pw, setPw] = useState(""); const [msg, setMsg] = useState("");
  async function go(e: any) { e.preventDefault(); try { const d = await makeApi("")("/auth/admin-recovery", { method: "POST", body: json({ key, email, newPassword: pw }) }); setMsg(d.message + " Go back and sign in."); setKey(""); setPw(""); } catch (x: any) { setMsg(x.message); } }
  return <div className="auth"><div><img src="/branding/medai-logo.svg" alt="MedAI Hospital" style={{ width: 180, marginBottom: 14 }} /><h2>Admin recovery</h2>
    <form onSubmit={go}><input type="password" placeholder="Recovery key (ADMIN_RECOVERY_KEY)" value={key} onChange={(e) => setKey(e.target.value)} required /><input type="email" placeholder="Admin email (leave empty for the default admin)" value={email} onChange={(e) => setEmail(e.target.value)} /><input type="password" placeholder="New password (14+ characters)" value={pw} onChange={(e) => setPw(e.target.value)} minLength={14} required /><button className="primary">Reset admin password</button></form>
    {msg && <p className="notice">{msg}</p>}<p><a href="/">← Back to MedAI</a></p></div></div>;
}
