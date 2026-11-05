// © 2026 MD Gausur Rahman Nabil. All rights reserved. MedAI Hospital.
import { useEffect, useState } from "react";
import { Api, json, downloadFile, fmtDate, fmtDay, label, parseCsv } from "./api";
import { useBadges, Tabs, ChangePassword } from "./common";

export default function AdminPanel({ api, token, onToken, setMessage }: { api: Api; token: string; onToken: (t: string) => void; setMessage: (s: string) => void }) {
  const [tab, setTab] = useState("doctors");
  const badges = useBadges(api, "admin");
  return <div>
    <Tabs badges={badges} tab={tab} setTab={setTab} tabs={[["doctors", "Doctor verification"], ["reports", "Reports"], ["resets", "Requests"], ["users", "Users"], ["monitor", "Live monitoring"], ["medicines", "Medicine review"], ["import", "Import medicines"], ["banner", "Banner"], ["security", "Password & audit"]]} />
    {tab === "doctors" && <><Overview api={api} setMessage={setMessage} /><DoctorQueue api={api} token={token} setMessage={setMessage} /></>}
    {tab === "reports" && <ReportsPanel api={api} token={token} setMessage={setMessage} />}
    {tab === "resets" && <RequestsPanel api={api} setMessage={setMessage} />}
    {tab === "users" && <Users api={api} setMessage={setMessage} />}
    {tab === "monitor" && <LiveMonitoring api={api} setMessage={setMessage} />}
    {tab === "medicines" && <MedicineReview api={api} setMessage={setMessage} />}
    {tab === "import" && <ImportMedicines api={api} setMessage={setMessage} />}
    {tab === "banner" && <BannerEditor api={api} setMessage={setMessage} />}
    {tab === "security" && <Security api={api} onToken={onToken} setMessage={setMessage} />}
  </div>;
}

const REVIEW_LABEL: Record<string, string> = { pending: "⏳ Pending", approved: "✅ Approved", rejected: "❌ Rejected", not_submitted: "— Not submitted" };
const ANALYSIS_LABEL: Record<string, string> = { completed: "✅ Completed", processing: "⏳ Processing", not_analyzed: "— Not analyzed" };

function ReportsPanel({ api, token, setMessage }: { api: Api; token: string; setMessage: (s: string) => void }) {
  const [rows, setRows] = useState<any[]>([]); const [doctors, setDoctors] = useState<any[]>([]); const [filter, setFilter] = useState("all"); const [q, setQ] = useState("");
  const [pick, setPick] = useState<Record<string, string>>({}); const [busy, setBusy] = useState("");
  async function load() {
    try {
      const qs = new URLSearchParams(); if (filter === "unassigned") qs.set("unassigned", "1"); else if (filter !== "all") qs.set("review", filter); if (q.trim()) qs.set("q", q.trim());
      const d = await api("/admin/reports?" + qs.toString()); setRows(d.reports || []); setDoctors(d.doctors || []);
    } catch (e: any) { setMessage(e.message); }
  }
  useEffect(() => { load(); }, [filter]);
  async function dl(id: string, name: string) { try { await downloadFile(token, id, name); } catch (e: any) { setMessage(e.message); } }
  async function assign(id: string) {
    if (!pick[id]) { setMessage("Choose a doctor first."); return; }
    setBusy(id); try { const r = await api(`/admin/reports/${id}/assign`, { method: "POST", body: json({ doctorId: pick[id] }) }); setMessage(r.message); load(); } catch (e: any) { setMessage(e.message); } setBusy("");
  }
  return <div className="grid">
    <article className="full"><h3>📄 Patient reports</h3>
      <p className="muted">Every uploaded report with its AI analysis and doctor review. Opening a patient file is recorded in the audit log.</p>
      <div className="row"><select value={filter} onChange={(e) => setFilter(e.target.value)}><option value="all">All reports</option><option value="pending">Doctor review: Pending</option><option value="approved">Doctor review: Approved</option><option value="rejected">Doctor review: Rejected</option><option value="unassigned">No doctor assigned</option></select>
        <input placeholder="Search patient name or email" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && load()} /><button className="outline" onClick={load}>Search</button></div>
    </article>
    {!rows.length && <article className="full"><p className="muted">No reports found.</p></article>}
    {rows.map((r) => <article className="full" key={r._id}>
      <h3>{r.patient?.name || "Unknown patient"} <span className="muted">· {r.patient?.email || ""}{r.patient?.phone ? " · " + r.patient.phone : ""}</span></h3>
      <p className="muted">Uploaded: {fmtDate(r.createdAt)} · Status: {label(r.status)}{r.urgencyLevel ? " · Priority: " + r.urgencyLevel : ""}</p>
      <p><b>AI analysis:</b> {ANALYSIS_LABEL[r.analysisState] || r.analysisState} &nbsp; <b>Doctor review:</b> {REVIEW_LABEL[r.reviewState] || r.reviewState}</p>
      <p><b>Doctor:</b> {r.doctor ? `Dr. ${r.doctor.name}${r.doctor.specialty ? " (" + r.doctor.specialty + ")" : ""}` : "Not assigned yet"}</p>
      {r.reviewComment && <p className="muted">Doctor comment: {r.reviewComment}</p>}
      {r.rejectionReason && <p className="warn">Rejection reason: {r.rejectionReason}</p>}
      <div className="row">
        {r.files.original && <button className="outline" onClick={() => dl(r.files.original.id, r.files.original.name || "patient-report")}>⬇️ Patient report</button>}
        {r.files.aiPdf && <button className="outline" onClick={() => dl(r.files.aiPdf, "AI-report-analysis.pdf")}>🤖 AI PDF</button>}
        {r.files.finalPdf && <button className="outline" onClick={() => dl(r.files.finalPdf, "doctor-approved-report.pdf")}>✅ Doctor-approved PDF</button>}
      </div>
      {r.reviewState !== "approved" && r.reviewState !== "rejected" && <div className="row">
        <select value={pick[r._id] || ""} onChange={(e) => setPick({ ...pick, [r._id]: e.target.value })}><option value="">{r.doctor ? "Change doctor…" : "Assign a doctor…"}</option>{doctors.map((d) => <option key={d._id} value={d._id}>Dr. {d.name}{d.specialty ? " · " + d.specialty : ""}</option>)}</select>
        <button className="primary" disabled={busy === r._id} onClick={() => assign(r._id)}>{r.doctor ? "Reassign" : "Assign"}</button></div>}
    </article>)}
  </div>;
}

function LiveMonitoring({ api, setMessage }: { api: Api; setMessage: (s: string) => void }) {
  const [data, setData] = useState<any>(null); const [updated, setUpdated] = useState("");
  async function load() { try { const d = await api("/admin/monitoring"); setData(d); setUpdated(new Date().toLocaleTimeString()); } catch (e: any) { setMessage(e.message); } }
  useEffect(() => { load(); const t = window.setInterval(load, 10000); return () => window.clearInterval(t); }, []);
  const counts = Object.fromEntries((data?.onlineCounts || []).map((x: any) => [x._id, x.count]));
  return <div className="grid">
    <article className="full"><h3>Live platform activity</h3><p className="muted">Auto-refreshes every 10 seconds. A user is considered online after a heartbeat within 75 seconds. Offline status is approximate and depends on browser/network connectivity. Last refresh: {updated || "Loading…"}</p>
      <div className="row"><b>Online patients: {counts.patient || 0}</b><b>Online doctors: {counts.doctor || 0}</b><b>Active calls: {data?.activeCalls?.length || 0}</b><button className="outline" onClick={load}>Refresh now</button></div>
    </article>
    <article className="full"><h3>Online users</h3>{!data?.onlineUsers?.length && <p className="muted">No recent user heartbeats.</p>}
      {(data?.onlineUsers || []).map((u: any) => <div className="item" key={u._id}><b>{u.name}</b> · {u.role} · {u.email}<p className="muted">Last seen: {fmtDate(u.lastSeenAt)} · Last login: {fmtDate(u.lastLoginAt)}</p></div>)}
    </article>
    <article className="full"><h3>Live call sessions</h3><p className="muted">Only operational metadata is shown. No call audio, video, messages, transcript, or private call content is accessible here. A session may remain visible briefly if a device disconnects without sending hangup.</p>
      {!data?.activeCalls?.length && <p className="muted">No active call sessions detected.</p>}
      {(data?.activeCalls || []).map((c: any) => <div className="item" key={c._id}><b>Appointment {c.appointmentId?._id || c.appointmentId}</b> · {c.lastConnectionState}<p>Patient: {c.patientId?.name || "—"} · Doctor: {c.doctorId?.name || "—"}</p><p className="muted">Started: {fmtDate(c.startedAt)} · Last heartbeat: {fmtDate(c.lastHeartbeatAt)}</p></div>)}
    </article>
    <article className="full"><h3>Recent activity</h3>{(data?.recentActivity || []).map((ev: any) => <p className="item" key={ev._id}>{fmtDate(ev.createdAt)} · <b>{ev.action}</b> · {ev.actorId?.name || "System"} ({ev.actorId?.role || "system"}) · {ev.targetType || ""}</p>)}</article>
  </div>;
}

function Overview({ api, setMessage }: { api: Api; setMessage: (s: string) => void }) {
  const [o, setO] = useState<any>(null);
  useEffect(() => { api("/admin/overview").then(setO).catch((e) => setMessage(e.message)); }, []);
  return <div className="grid"><article className="full"><h3>Overview</h3>{o ? <p>Patients: {o.patients} · Doctors: {o.doctors} · Pending doctors: {o.pendingDoctors} · Appointments: {o.appointments} · Reports: {o.uploadedReports}</p> : <p className="muted">Loading…</p>}</article></div>;
}

function DoctorQueue({ api, token, setMessage }: { api: Api; token: string; setMessage: (s: string) => void }) {
  const [apps, setApps] = useState<any[]>([]);
  async function load() { try { const d = await api("/admin/doctors/pending"); setApps(d.applications || []); } catch (e: any) { setMessage(e.message); } }
  useEffect(() => { load(); }, []);
  return <div className="grid"><article className="full"><h3>Doctor verification queue</h3><button className="outline" onClick={load}>Refresh</button>
    <p className="muted">Open every document and compare the BMDC number with the official BMDC register before approving.</p>
    {apps.length === 0 && <p className="muted">No pending applications.</p>}
    {apps.map((x) => <Review key={x.doctor._id} x={x} api={api} token={token} done={load} setMessage={setMessage} />)}</article></div>;
}

function Review({ x, api, token, done, setMessage }: { x: any; api: Api; token: string; done: () => void; setMessage: (s: string) => void }) {
  const [note, setNote] = useState(""); const d = x.doctor; const p = d.doctorProfile || {};
  async function decide(decision: string) {
    if (decision !== "approve" && !note.trim()) { setMessage("Write a note for the doctor first (what is wrong or what is missing)."); return; }
    if (decision === "approve" && !confirm(`Approve Dr. ${d.name} (BMDC ${p.bmdcNumber})? They will be able to prescribe.`)) return;
    try { await api(`/admin/doctors/${d._id}/decision`, { method: "POST", body: json({ decision, note }) }); setMessage("Decision saved."); done(); } catch (e: any) { setMessage(e.message); }
  }
  return <div className="item"><b>{d.name}</b> · {d.email} · {d.phone}
    <p>BMDC: <b>{p.bmdcNumber}</b> · {p.specialty} · {(p.qualifications || []).join(", ")} · {p.experienceYears} yrs</p>
    {p.verificationNote && <p className="muted">Earlier note: {p.verificationNote}</p>}
    <b>Documents ({x.documents.length})</b>
    {x.documents.map((f: any) => <p key={f._id}>{label(f.category)} — {f.originalName} <button className="outline" onClick={() => downloadFile(token, f._id, f.originalName).catch((e) => setMessage(e.message))}>Open</button></p>)}
    <textarea placeholder="Note to the doctor (required for reject / request info)" value={note} onChange={(e) => setNote(e.target.value)} />
    <div className="row"><button className="primary" onClick={() => decide("approve")}>Approve</button><button className="outline" onClick={() => decide("request_info")}>Request info</button><button className="danger" onClick={() => decide("reject")}>Reject</button></div></div>;
}

function Users({ api, setMessage }: { api: Api; setMessage: (s: string) => void }) {
  const [role, setRole] = useState("doctor"); const [users, setUsers] = useState<any[]>([]);
  async function load() { try { const d = await api(`/admin/users?role=${role}`); setUsers(d.users || []); } catch (e: any) { setMessage(e.message); } }
  useEffect(() => { load(); }, [role]);
  async function setStatus(id: string, status: string) { if (status === "suspended" && !confirm("Suspend this account? They will be signed out immediately.")) return; try { await api(`/admin/users/${id}/status`, { method: "POST", body: json({ status }) }); load(); } catch (e: any) { setMessage(e.message); } }
  async function resetPassword(id:string){if(!confirm("Reset this user's password? A temporary password will be shown once."))return;try{const d=await api(`/admin/users/${id}/reset-password`,{method:"POST",body:json({})});window.prompt("Copy this temporary password and share it securely. It will not be shown again:",d.temporaryPassword);setMessage("Password reset completed and audit event recorded.");}catch(e:any){setMessage(e.message);}}
  return <div className="grid"><article className="full"><h3>Users</h3>
    <div className="row"><button className={role === "doctor" ? "primary" : "outline"} onClick={() => setRole("doctor")}>Doctors</button><button className={role === "patient" ? "primary" : "outline"} onClick={() => setRole("patient")}>Patients</button></div>
    {users.length === 0 && <p className="muted">No users.</p>}
    {users.map((u) => <div className="item" key={u._id}><b>{u.name}</b> · {u.email} · {label(u.status)}<p className="muted">User ID: {u._id}</p>
      {u.role === "doctor" && <p className="muted">BMDC {u.doctorProfile?.bmdcNumber} · {u.doctorProfile?.specialty}</p>}
      <p className="muted">Joined {fmtDay(u.createdAt)}</p>
      <div className="row">{u.status === "active" ? <button className="danger" onClick={() => setStatus(u._id, "suspended")}>Suspend</button> : <button className="primary" onClick={() => setStatus(u._id, "active")}>Reactivate</button>}<button className="outline" onClick={()=>resetPassword(u._id)}>Reset password</button></div></div>)}</article></div>;
}

const MED_FIELDS: [string, string][] = [["brand", "Brand name"], ["generic", "Generic name"], ["strength", "Strength"], ["form", "Form"], ["manufacturer", "Manufacturer"]];
const MED_LONG: [string, string][] = [["uses", "Used for"], ["benefits", "Benefits (good side)"], ["sideEffects", "Side effects (bad side)"], ["precautions", "Precautions"], ["interactions", "Interactions"], ["whenToTake", "When to take"]];
function MedicineForm({ api, setMessage, initial, onDone }: { api: Api; setMessage: (s: string) => void; initial?: any; onDone: () => void }) {
  const [f, setF] = useState<any>(() => Object.fromEntries([...MED_FIELDS, ...MED_LONG].map(([k]) => [k, initial?.[k] || ""]))); const [busy, setBusy] = useState(false);
  async function submit(e: any) {
    e.preventDefault(); setBusy(true);
    try { await api(initial ? `/admin/medicines/${initial._id}` : "/admin/medicines", { method: initial ? "PATCH" : "POST", body: json(f) }); setMessage(initial ? "Medicine updated." : "Medicine added and verified."); onDone(); } catch (x: any) { setMessage(x.message); }
    setBusy(false);
  }
  return <form className="record" onSubmit={submit}>
    <div className="cols">{MED_FIELDS.map(([k, t]) => <label key={k}>{t}<input value={f[k]} required={k === "brand" || k === "generic"} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></label>)}</div>
    {MED_LONG.map(([k, t]) => <label key={k}>{t}<textarea value={f[k]} maxLength={1200} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></label>)}
    <button className="primary" disabled={busy}>{initial ? "Save changes" : "Add medicine"}</button></form>;
}

function MedicineReview({ api, setMessage }: { api: Api; setMessage: (s: string) => void }) {
  const [d, setD] = useState<any>({ records: [], total: 0, page: 1, pages: 1 }); const [page, setPage] = useState(1); const [q, setQ] = useState(""); const [sel, setSel] = useState<string[]>([]); const [status, setStatus] = useState("needs_review"); const [edit, setEdit] = useState<any>(null); const [adding, setAdding] = useState(false);
  async function load(p = page, text = q, st = status) { try { const r = await api(`/admin/medicines/review?page=${p}&q=${encodeURIComponent(text)}&status=${st}`); setD(r); setSel([]); } catch (e: any) { setMessage(e.message); } }
  useEffect(() => { load(page); }, [page, status]);
  async function del(id: string, name: string) { if (!confirm(`Delete ${name}? This cannot be undone.`)) return; try { await api(`/admin/medicines/${id}`, { method: "DELETE" }); setMessage("Medicine deleted."); load(); } catch (e: any) { setMessage(e.message); } }
  async function bulk(ids: string[], status: string) { if (!ids.length) return; try { const r = await api("/admin/medicines/review-bulk", { method: "POST", body: json({ ids, status }) }); setMessage(`${r.updated} medicine(s) marked ${status}.`); load(); } catch (e: any) { setMessage(e.message); } }
  const toggle = (id: string) => setSel(sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id]);
  const ids = d.records.map((m: any) => m._id);
  return <div className="grid"><article className="full"><h3>Medicine catalogue review</h3>
    <p className="muted">Only “verified” medicines appear in the doctor’s prescription search. {d.total} waiting for review.</p>
    <div className="row"><button className="primary" onClick={() => { setAdding(!adding); setEdit(null); }}>{adding ? "Close" : "➕ Add medicine"}</button>
      <select value={status} onChange={(e) => { setPage(1); setStatus(e.target.value); }}><option value="needs_review">Waiting for review</option><option value="verified">Verified</option><option value="rejected">Rejected</option><option value="all">All uploaded medicines</option></select></div>
    {adding && <MedicineForm api={api} setMessage={setMessage} onDone={() => { setAdding(false); load(); }} />}
    <form className="row" onSubmit={(e) => { e.preventDefault(); setPage(1); load(1, q); }}><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search brand or generic" /><button className="outline">Search</button></form>
    <div className="row"><button className="primary" disabled={!sel.length} onClick={() => bulk(sel, "verified")}>Verify selected ({sel.length})</button><button className="outline" onClick={() => setSel(sel.length === ids.length ? [] : ids)}>{sel.length === ids.length && ids.length ? "Clear" : "Select all on page"}</button><button className="danger" disabled={!sel.length} onClick={() => bulk(sel, "rejected")}>Reject selected</button></div>
    {d.records.map((m: any) => <div className="item" key={m._id}>
      <label className="check"><input type="checkbox" checked={sel.includes(m._id)} onChange={() => toggle(m._id)} /><span><b>{m.brand}</b> — {m.generic} {m.strength} {m.form}<br /><span className="muted">{m.manufacturer} · {m.sourceName} · {label(m.reviewStatus)}</span></span></label>
      <div className="row"><button className="outline" onClick={() => { setEdit(edit?._id === m._id ? null : m); setAdding(false); }}>✏️ Edit</button><button className="danger" onClick={() => del(m._id, m.brand)}>🗑️ Delete</button></div>
      {edit?._id === m._id && <MedicineForm api={api} setMessage={setMessage} initial={m} onDone={() => { setEdit(null); load(); }} />}</div>)}
    <div className="row"><button className="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button><span className="muted">Page {d.page} of {d.pages}</span><button className="outline" disabled={page >= d.pages} onClick={() => setPage(page + 1)}>Next</button></div></article></div>;
}

const MED_TEMPLATE = [{
  brand: "Napa", generic: "Paracetamol", strength: "500 mg", form: "Tablet", manufacturer: "Beximco Pharmaceuticals", registrationNumber: "",
  uses: "Fever and mild to moderate pain (headache, toothache, body ache).",
  benefits: "Lowers fever and relieves pain; usually gentle on the stomach.",
  sideEffects: "Rare at normal doses. Overdose can seriously damage the liver. Rarely skin rash.",
  precautions: "Do not exceed the daily limit set by your doctor. Take care with liver disease or regular alcohol use. Check other medicines for hidden paracetamol.",
  interactions: "Warfarin (bleeding risk may increase with regular high use); other paracetamol-containing products.",
  whenToTake: "Can be taken with or without food, as directed by your doctor."
}];
const MED_PROMPT = `You are a careful pharmacology data assistant for a Bangladesh hospital app.
I will give you a list of medicines (brand and/or generic names). For EACH medicine return one JSON object.
Return ONLY a valid JSON array, with no explanation and no markdown fences.
Each object must have exactly these string fields:
brand, generic, strength, form, manufacturer, registrationNumber, uses, benefits, sideEffects, precautions, interactions, whenToTake
Rules:
- uses = what condition(s) the medicine is used for, in simple language.
- benefits = the positive / good effects.
- sideEffects = the negative / bad effects and warning signs.
- precautions = who should avoid it or be careful (pregnancy, kidney/liver disease, allergies, children).
- interactions = important medicines or foods it should not be mixed with.
- whenToTake = before/after food, time of day, general guidance (no personal doses).
- If you are not sure about a field, use "" instead of guessing. Never invent registration numbers.
- Do not give personal dose advice. Keep each field under 300 characters.
Medicines:
[PASTE YOUR MEDICINE LIST HERE]`;

function ImportMedicines({ api, setMessage }: { api: Api; setMessage: (s: string) => void }) {
  const [file, setFile] = useState<File | null>(null); const [src, setSrc] = useState({ name: "", url: "", license: "" }); const [busy, setBusy] = useState(false); const [log, setLog] = useState("");
  function downloadTemplate() {
    const blob = new Blob([JSON.stringify(MED_TEMPLATE, null, 2)], { type: "application/json" }); const u = URL.createObjectURL(blob);
    const el = document.createElement("a"); el.href = u; el.download = "medai_medicine_template.json"; document.body.appendChild(el); el.click(); el.remove(); setTimeout(() => URL.revokeObjectURL(u), 5000);
  }
  async function copyPrompt() { try { await navigator.clipboard.writeText(MED_PROMPT); setMessage("AI prompt copied. Paste it into any AI together with your medicine list."); } catch { setMessage("Copy failed. Select the prompt text below and copy it manually."); } }
  async function run(e: any) {
    e.preventDefault(); if (!file) return; setBusy(true); setLog("");
    try {
      const raw = await file.text(); let rows: any[]; if (file.name.toLowerCase().endsWith(".json")) { const parsed = JSON.parse(raw); rows = Array.isArray(parsed) ? parsed : parsed?.medicines; } else { rows = parseCsv(raw); } if (!Array.isArray(rows) || !rows.length) throw new Error("No rows found. Expected JSON array or CSV columns: brand,generic,strength,form,manufacturer,registrationNumber");
      let done = 0;
      for (let i = 0; i < rows.length; i += 500) {
        const r = await api("/admin/medicines/import", { method: "POST", body: json({ records: rows.slice(i, i + 500), sourceName: src.name, sourceUrl: src.url, sourceLicense: src.license }) });
        done += r.imported; setLog(`Imported ${done} of ${rows.length}…`);
      }
      setLog(`Done: ${done} of ${rows.length} rows imported. Review them in “Medicine review”.`); setMessage("Import finished.");
    } catch (x: any) { setMessage(x.message); } finally { setBusy(false); }
  }
  return <div className="grid"><article className="full"><h3>Import medicines (CSV / JSON)</h3>
    <p className="muted">JSON object fields: brand, generic, strength, form, manufacturer, registrationNumber, uses, benefits, sideEffects, precautions, interactions, whenToTake. Download the template, give the prompt to an AI with your medicine list, then upload the JSON it returns. Use only data you are authorised to use. Existing verified entries keep their status.</p>
    <div className="row"><button type="button" className="outline" onClick={downloadTemplate}>⬇️ Download JSON template</button><button type="button" className="outline" onClick={copyPrompt}>📋 Copy AI prompt</button></div>
    <details><summary className="muted">Show AI prompt</summary><pre className="item" style={{ whiteSpace: "pre-wrap" }}>{MED_PROMPT}</pre></details>
    <form onSubmit={run}><input type="file" accept=".csv,.json,application/json,text/csv" onChange={(e) => setFile(e.target.files?.[0] || null)} required />
      <input placeholder="Source name" value={src.name} onChange={(e) => setSrc({ ...src, name: e.target.value })} required />
      <input placeholder="Source URL" value={src.url} onChange={(e) => setSrc({ ...src, url: e.target.value })} required />
      <input placeholder="Data-use / licence basis" value={src.license} onChange={(e) => setSrc({ ...src, license: e.target.value })} required />
      <button className="primary" disabled={busy}>{busy ? "Importing…" : "Import"}</button></form>
    {log && <p className="notice">{log}</p>}</article></div>;
}

function Security({ api, onToken, setMessage }: { api: Api; onToken: (t: string) => void; setMessage: (s: string) => void }) {
  const [events, setEvents] = useState<any[]>([]); const [errors, setErrors] = useState<any[]>([]);
  async function loadErrors() { try { const d = await api("/admin/system/errors?resolved=false&limit=100"); setErrors(d.errors || []); } catch (e: any) { setMessage(e.message); } }
  async function resolveError(id: string) { try { await api(`/admin/system/errors/${id}/resolve`, { method: "POST", body: json({}) }); setMessage("System error marked resolved."); loadErrors(); } catch (e: any) { setMessage(e.message); } }
  async function audit() { try { const d = await api("/admin/audit"); setEvents(d.events || []); } catch (e: any) { setMessage(e.message); } }
  useEffect(() => { audit(); loadErrors(); }, []);
  return <div className="grid">
    <article className="full"><h3>Admin password</h3><p className="muted">Sign in with the Admin ID and password. No OTP or authenticator code is required. You can change the password here.</p>
      <ChangePassword api={api} onToken={onToken} setMessage={setMessage} /></article>
    <article className="full"><h3>Activity log</h3><button className="outline" onClick={audit}>Refresh</button>
      {events.map((ev) => <p className="item" key={ev._id}>{fmtDate(ev.createdAt)} · <b>{ev.action}</b> · {ev.actorId?.email || "system"} · {ev.targetType} {ev.ip ? "· " + ev.ip : ""}</p>)}</article>
    <article className="full"><h3>System errors</h3><p className="muted">API errors are logged with request ID, route, status and actor. Sensitive request bodies and credentials are not stored.</p><button className="outline" onClick={loadErrors}>Refresh errors</button>
      {errors.length === 0 && <p className="muted">No unresolved system errors.</p>}
      {errors.map((er) => <div className="item" key={er._id}><b>{er.severity?.toUpperCase()} · HTTP {er.statusCode}</b> · {fmtDate(er.createdAt)}<p>{er.errorName}: {er.message}</p><p className="muted">{er.method} {er.route} · {er.actorId?.email || "Unauthenticated/system"} · Request {er.requestId}</p><button className="outline" onClick={() => resolveError(er._id)}>Mark resolved</button></div>)}
    </article>
  </div>;
}

function shrinkImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image(); const url = URL.createObjectURL(file);
    img.onload = () => {
      const max = 1200; const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement("canvas"); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
      resolve(c.toDataURL("image/jpeg", 0.78));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Could not read the image")); };
    img.src = url;
  });
}

const BLANK_SLIDE = { eyebrow: "", title: "New slide", subtitle: "", pills: [] as string[], linkText: "", linkUrl: "", image: "", placement: "all" };

function BannerEditor({ api, setMessage }: { api: Api; setMessage: (s: string) => void }) {
  const [b, setB] = useState<any>(null); const [n, setN] = useState(0); const [busy, setBusy] = useState(false);
  useEffect(() => { api("/banner").then((d) => setB(d.banner)).catch((e) => setMessage(e.message)); }, []);
  if (!b) return <p className="muted">Loading banner…</p>;
  const s = b.slides[Math.min(n, b.slides.length - 1)];
  const setS = (k: string, v: any) => setB({ ...b, slides: b.slides.map((x: any, idx: number) => (idx === n ? { ...x, [k]: v } : x)) });
  async function save(e: any) {
    e.preventDefault(); setBusy(true);
    try { const d = await api("/admin/banner", { method: "PUT", body: json(b) }); setB(d.banner); setMessage(d.message); } catch (x: any) { setMessage(x.message); }
    setBusy(false);
  }
  async function reset() {
    if (!confirm("Reset the banner to the default design?")) return;
    try { const d = await api("/admin/banner", { method: "DELETE" }); setB(d.banner); setN(0); setMessage(d.message); } catch (x: any) { setMessage(x.message); }
  }
  function add() { if (b.slides.length >= 10) return setMessage("Maximum 10 slides."); setB({ ...b, slides: [...b.slides, { ...BLANK_SLIDE }] }); setN(b.slides.length); }
  function remove() { if (b.slides.length <= 1) return setMessage("Keep at least one slide."); setB({ ...b, slides: b.slides.filter((_: any, idx: number) => idx !== n) }); setN(0); }
  async function pick(f?: File) { if (!f) return; try { setS("image", await shrinkImage(f)); } catch (x: any) { setMessage(x.message); } }
  return <div className="grid"><article className="full"><h3>Banner slideshow (home, patient and doctor)</h3>
    <p className="muted">Slides change automatically on the home page, the top of the patient and doctor dashboards, and as a slim strip above the tabs. Pick where each slide shows. You can add, edit and delete slides here. Changes go live after you press Save.</p>
    <form onSubmit={save}>
      <div className="cols"><label className="check"><input type="checkbox" checked={b.active} onChange={(e) => setB({ ...b, active: e.target.checked })} /> Show banner</label>
        <label>Seconds per slide (3–30)<input type="number" min={3} max={30} value={b.intervalSec} onChange={(e) => setB({ ...b, intervalSec: Math.min(30, Math.max(3, Number(e.target.value) || 5)) })} /></label></div>
      <div className="tabs">{b.slides.map((_: any, idx: number) => <button type="button" key={idx} className={idx === n ? "active" : ""} onClick={() => setN(idx)}>Slide {idx + 1}</button>)}
        <button type="button" className="outline" onClick={add}>➕ Add slide</button></div>
      <label>Where to show this slide<select value={s.placement || "all"} onChange={(e) => setS("placement", e.target.value)}><option value="all">Everywhere (home, patient, doctor, every tab)</option><option value="home">Home / login page only</option><option value="patient">Patient portal only</option><option value="doctor">Doctor portal only</option></select></label>
      <label>Small heading<input value={s.eyebrow} maxLength={80} onChange={(e) => setS("eyebrow", e.target.value)} /></label>
      <label>Title<input value={s.title} maxLength={140} required onChange={(e) => setS("title", e.target.value)} /></label>
      <label>Description<textarea value={s.subtitle} maxLength={400} onChange={(e) => setS("subtitle", e.target.value)} /></label>
      <label>Tags (comma separated, up to 5)<input defaultValue={(s.pills || []).join(", ")} key={"p" + n} onBlur={(e) => setS("pills", e.target.value.split(",").map((x: string) => x.trim()).filter(Boolean).slice(0, 5))} /></label>
      <div className="cols"><label>Button text (optional)<input value={s.linkText} maxLength={40} onChange={(e) => setS("linkText", e.target.value)} /></label>
        <label>Button link (https://…)<input value={s.linkUrl} maxLength={300} onChange={(e) => setS("linkUrl", e.target.value)} /></label></div>
      <label>Slide image (PNG, JPG or WEBP; auto-resized)<input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => pick(e.target.files?.[0])} /></label>
      {s.image && <div className="row"><img src={s.image} alt="" style={{ maxWidth: 260, borderRadius: 12 }} /><button type="button" className="outline" onClick={() => setS("image", "")}>Use default image</button></div>}
      <div className="row"><button className="primary" disabled={busy}>💾 Save banner</button><button type="button" className="danger" onClick={remove}>🗑️ Delete this slide</button><button type="button" className="outline" onClick={reset}>Reset to default</button></div>
    </form></article></div>;
}

function RequestsPanel({ api, setMessage }: { api: Api; setMessage: (s: string) => void }) {
  const [reqs, setReqs] = useState<any[]>([]); const [users, setUsers] = useState<any[]>([]); const [temp, setTemp] = useState(""); const [busy, setBusy] = useState("");
  async function load() { try { const r = await api("/admin/password-requests?status=pending"); setReqs(r.requests || []); const s = await api("/admin/recent-signups"); setUsers(s.users || []); } catch (e: any) { setMessage(e.message); } }
  useEffect(() => { load(); const t = setInterval(load, 30000); return () => clearInterval(t); }, []);
  async function send(id: string, mode: "link" | "password" = "link") { setBusy(id); setTemp(""); try { const r = await api(`/admin/password-requests/${id}/send`, { method: "POST", body: json({ mode }) }); setMessage(r.message); if (r.temporaryPassword) setTemp(r.temporaryPassword); if (r.resetLink) setTemp(r.resetLink); load(); } catch (e: any) { setMessage(e.message); } setBusy(""); }
  const [issue, setIssue] = useState<any>(null); const [loginEmail, setLoginEmail] = useState(""); const [pw, setPw] = useState(""); const [cred, setCred] = useState<any>(null); const [auto, setAuto] = useState(false);
  function openIssue(u: any) { setIssue(u); setAuto(false); setLoginEmail(u.status === "pending_approval" ? (u.contactEmail || u.email) : u.email); setPw(""); setCred(null); }
  async function issueLogin(u: any) { setBusy(u._id); setCred(null); try { const body: any = { loginEmail }; if (pw.trim()) body.password = pw.trim(); else if (auto) body.autoPassword = true; const r = await api(`/admin/users/${u._id}/issue-credentials`, { method: "POST", body: json(body) }); setCred(r); setMessage(r.message); setIssue(null); load(); } catch (e: any) { setMessage(e.message); } setBusy(""); }
  async function quickApprove(u: any) { if (!confirm(`Approve ${u.name}? They will be emailed.`)) return; setBusy(u._id); setCred(null); try { const r = await api(`/admin/users/${u._id}/issue-credentials`, { method: "POST", body: json({}) }); setCred(r); setMessage(r.message); load(); } catch (e: any) { setMessage(e.message); } setBusy(""); }
  async function rejectSignup(id: string) { if (!confirm("Reject this account request?")) return; try { await api(`/admin/users/${id}/reject-signup`, { method: "POST", body: json({}) }); load(); } catch (e: any) { setMessage(e.message); } }
  async function dismiss(id: string) { if (!confirm("Dismiss this request?")) return; try { await api(`/admin/password-requests/${id}/dismiss`, { method: "POST", body: json({}) }); load(); } catch (e: any) { setMessage(e.message); } }
  return <div className="grid">
    <article><h3>🔑 Password reset requests</h3><button className="outline" onClick={load}>Refresh</button>
      {reqs.length === 0 && <p className="muted">No pending requests.</p>}
      {temp && <p className="warn">Shown once (email was not sent): <b style={{ wordBreak: "break-all" }}>{temp}</b></p>}
      {reqs.map((r) => <div className="item" key={r._id}><b>{r.userId?.name || "Unknown"}</b> · {r.userId?.role} · {r.email}<p className="muted">Asked {fmtDate(r.createdAt)}</p>
        <div className="row"><button className="primary" disabled={busy === r._id} onClick={() => send(r._id, "link")}>📧 Send reset link</button><button className="outline" disabled={busy === r._id} onClick={() => send(r._id, "password")}>🔑 Send temporary password</button><button className="outline" onClick={() => dismiss(r._id)}>Dismiss</button></div></div>)}
      <p className="muted">The user gets a one-time link (valid 24 hours) to choose their own password. “Temporary password” emails a random password instead. If email is not configured, it is shown here once.</p></article>
    <article><h3>🆕 New accounts</h3>
      {users.length === 0 && <p className="muted">No accounts yet.</p>}
      {cred && <p className="warn">{cred.message}<br />Login ID: <b>{cred.loginEmail}</b>{cred.password && <> · Password (shown once): <b>{cred.password}</b></>}</p>}
      {users.map((u) => <div className="item" key={u._id}><b>{u.name}</b> · {u.role} · {label(u.status)}<p className="muted">{u.contactEmail || u.email}{u.phone ? " · " + u.phone : ""} · joined {fmtDay(u.createdAt)}</p>
        {u.requestedPassword && <p className="muted">Login ID: <b>{u.email}</b> · The person chose their own password (hidden for security).</p>}
        {u.status === "pending_approval" && <div className="row"><button className="primary" disabled={busy === u._id} onClick={() => quickApprove(u)}>✅ Approve &amp; email</button><button className="outline" onClick={() => openIssue(u)}>Approve with new login…</button><button className="danger" onClick={() => rejectSignup(u._id)}>Reject</button></div>}
        {u.status === "active" && u.role !== "admin" && issue?._id !== u._id && <button className="outline" onClick={() => openIssue(u)}>🔐 New login details</button>}
        {issue?._id === u._id && <div className="item"><label>Login ID (email)<input type="email" value={loginEmail} onChange={(e) => setLoginEmail(e.target.value)} /></label>
          <label>New password (leave empty to keep the one they chose)<input type="text" minLength={12} value={pw} onChange={(e) => { setPw(e.target.value); setAuto(false); }} /></label>
          <label><input type="checkbox" checked={auto} onChange={(e) => { setAuto(e.target.checked); if (e.target.checked) setPw(""); }} /> Create a random new password instead</label>
          <div className="row"><button className="primary" disabled={busy === u._id} onClick={() => issueLogin(u)}>📧 Approve &amp; send to {u.contactEmail || u.email}</button><button className="outline" onClick={() => setIssue(null)}>Cancel</button></div></div>}
      </div>)}
      <p className="muted">Patients request an account with their own email and password. You approve it and they are emailed (or you tell them yourself if email is not set up). You can also give them a new login ID or password. Doctors are approved in “Doctor verification”; after that you can create new login details here.</p></article>
  </div>;
}
