// © 2026 MD Gausur Rahman Nabil. All rights reserved. MedAI Hospital.
import { useEffect, useState } from "react";
import { Api, json, downloadFile, postForm, fmtDate, fmtDay, fmtSize, label } from "./api";
import { Notifications, Seq, useBadges, Tabs, Chat, ChangePassword, SlotPicker } from "./common";
import { printRx } from "./print";
import TeleVisitCall from "./TeleVisitCall";
import { DoctorPhoto } from "./extras";

const PRESCRIBABLE = ["awaiting_records", "awaiting_tests", "confirmed", "waiting_room", "in_progress", "completed", "follow_up_required"];
const SCHEDULABLE = ["requested", "awaiting_records", "awaiting_tests", "follow_up_required"];
const CLOSED = ["completed", "cancelled", "rejected"];
const NEXT: [string, string][] = [["waiting_room", "Waiting room"], ["in_progress", "In progress"], ["completed", "Completed"], ["awaiting_records", "Need records"], ["awaiting_tests", "Need tests"], ["follow_up_required", "Follow-up needed"], ["rejected", "Reject request"], ["cancelled", "Cancel"]];
const emptyItem = () => ({ brand: "", generic: "", strength: "", form: "Tablet", dose: "", frequency: "", duration: "", instructions: "", medicineId: "" });

export default function DoctorPanel({ api, token, user, onToken, setMessage }: { api: Api; token: string; user: any; onToken: (t: string) => void; setMessage: (s: string) => void }) {
  const [tab, setTab] = useState("appointments");
  const badges = useBadges(api, "doctor");
  useEffect(() => { const f = () => setTab("appointments"); window.addEventListener("medai-open", f); return () => window.removeEventListener("medai-open", f); }, []);
  return <div>
    <Tabs strip="doctor" badges={badges} tab={tab} setTab={setTab} tabs={[["appointments", "Appointments"], ["requests", "New requests"], ["rx", "Prescriptions"], ["reports", "Report review"], ["notifications", "Notifications"], ["profile", "My doctor profile"]]} />
    {tab === "appointments" && <MyAppointments api={api} token={token} user={user} setMessage={setMessage} />}
    {tab === "requests" && <Requests api={api} setMessage={setMessage} />}
    {tab === "rx" && <PrescriptionList api={api} token={token} setMessage={setMessage} />}
    {tab === "reports" && <DoctorReportReview api={api} token={token} setMessage={setMessage} />}
    {tab === "notifications" && <Notifications api={api} setMessage={setMessage} />}
    {tab === "profile" && <DoctorProfile api={api} token={token} onToken={onToken} setMessage={setMessage} />}
  </div>;
}

function Requests({ api, setMessage }: { api: Api; setMessage: (s: string) => void }) {
  const [list, setList] = useState<any[]>([]);
  async function load() { try { const d = await api("/doctor/unassigned-appointment-requests"); setList(d.requests || []); } catch (e: any) { setMessage(e.message); } }
  useEffect(() => { load(); }, []);
  async function claim(id: string) { try { await api(`/appointments/${id}/claim`, { method: "POST", body: json({}) }); setMessage("Request assigned to you. Open Appointments to schedule it."); load(); } catch (e: any) { setMessage(e.message); load(); } }
  return <div className="grid"><article className="full"><h3>New patient requests</h3><div className="muted"><p><b>What is this page?</b> These are patients who asked for an appointment but did not choose a doctor. Any doctor can take them.</p><ol><li>Read the patient's problem below.</li><li>Press <b>Accept this patient</b>. The first doctor to press it gets the patient (others will see "already assigned").</li><li>The patient moves to your <b>Appointments</b> tab. There, suggest a visit time, then start the chat or call.</li></ol><p>If you do not want the patient, simply do nothing. Nothing is sent to the patient until you accept.</p></div><button className="outline" onClick={load}>↻ Refresh</button>
    {list.length === 0 && <p className="muted">No new requests right now. New ones will show a red number on this tab.</p>}
    {list.map((a) => <div className="item" key={a._id}><b>{a.patientId?.name || "Patient"}</b> · {fmtDate(a.createdAt)} · {label(a.consultationType)}{a.preferredAt && <> · 🕒 wants {fmtDate(a.preferredAt)}</>}<p>{a.problem}</p><button className="primary" onClick={() => claim(a._id)}>✅ Accept this patient</button></div>)}</article></div>;
}

function MyAppointments({ api, token, user, setMessage }: { api: Api; token: string; user: any; setMessage: (s: string) => void }) {
  const [list, setList] = useState<any[]>([]); const [booked, setBooked] = useState<any[]>([]); const [open, setOpen] = useState<{ id: string; kind: string }>({ id: "", kind: "" });
  async function load() {
    try {
      const d = await api("/appointments"); setList(d.appointments || []);
      const av = await api(`/doctors/${user.id}/availability`); setBooked(av.bookedSlots || []);
    } catch (e: any) { setMessage(e.message); }
  }
  useEffect(() => { load(); }, []);
  useEffect(() => { const f = () => { const x = (window as any).__medaiOpen; if (!x) return; setOpen({ id: x.appointmentId, kind: x.kind }); load(); (window as any).__medaiOpen = null; }; f(); window.addEventListener("medai-open", f); return () => window.removeEventListener("medai-open", f); }, []);
  const toggle = (id: string, kind: string) => setOpen(open.id === id && open.kind === kind ? { id: "", kind: "" } : { id, kind });
  return <div className="grid">
    <article className="full"><h3>My appointments</h3><button className="outline" onClick={load}>Refresh</button>
      {booked.length > 0 && <p className="muted">Already booked: {booked.map((b) => fmtDate(b.scheduledAt)).join(" · ")}</p>}
      {list.length === 0 && <p className="muted">No assigned appointments. Accept a request from “New requests”.</p>}
      {list.map((a) => <div className="item" key={a._id}>
        <b>{a.patientId?.name || "Patient"}</b> · {label(a.status)}{a.scheduledAt && <> · {fmtDate(a.scheduledAt)}</>} · {label(a.consultationType)}
        <p>{a.problem}</p>
        {!CLOSED.includes(a.status) && <ScheduleBox api={api} appt={a} doctorId={user.id} reload={load} setMessage={setMessage} />}
        <div className="row">
          <button className="outline" onClick={() => toggle(a._id, "record")}>🗂️ Patient record</button>
          <button className="outline" onClick={() => toggle(a._id, "chat")}>💬 Chat</button>
          {a.consultationType === "online" && <button className="outline" onClick={() => toggle(a._id, "call")}>🎥 Audio / Video call</button>}
          {PRESCRIBABLE.includes(a.status) && <button className="outline" onClick={() => toggle(a._id, "rx")}>✍️ Write prescription</button>}
        </div>
        {open.id === a._id && open.kind === "record" && <PatientRecord api={api} token={token} id={a._id} setMessage={setMessage} />}
        {open.id === a._id && open.kind === "chat" && <Chat api={api} appointmentId={a._id} meId={user.id} />}
        {open.id === a._id && open.kind === "call" && <TeleVisitCall api={api} token={token} appointmentId={a._id} user={user} setMessage={setMessage} />}
        {open.id === a._id && open.kind === "rx" && <RxEditor api={api} appointmentId={a._id} onSaved={() => { setOpen({ id: "", kind: "" }); setMessage("Draft saved. Open the Prescriptions tab to review and sign it."); }} setMessage={setMessage} />}
      </div>)}</article></div>;
}

function ScheduleBox({ api, appt, doctorId, reload, setMessage }: { api: Api; appt: any; doctorId: string; reload: () => void; setMessage: (s: string) => void }) {
  const [when, setWhen] = useState(appt.preferredAt && SCHEDULABLE.includes(appt.status) ? new Date(appt.preferredAt).toISOString() : ""); const [next, setNext] = useState(""); const [note, setNote] = useState("");
  async function patch(body: any, ok: string) { try { await api(`/appointments/${appt._id}`, { method: "PATCH", body: json(body) }); setMessage(ok); reload(); } catch (e: any) { setMessage(e.message); reload(); } }
  async function propose() { try { await api(`/appointments/${appt._id}/propose-time`, { method: "POST", body: json({ at: when, note }) }); setMessage("Time suggested. The patient will be asked to accept or decline."); setNote(""); reload(); } catch (e: any) { setMessage(e.message); reload(); } }
  const minNow = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  const pending = appt.proposal?.status === "pending";
  return <div>
    {SCHEDULABLE.includes(appt.status) && <>
      {appt.preferredAt && <p className="muted">🕒 Patient asked for {fmtDate(appt.preferredAt)} <button type="button" className="link" onClick={() => setWhen(new Date(appt.preferredAt).toISOString())}>Use this time</button></p>}
      {pending && <p className="notice">⏳ Waiting for the patient to answer your suggestion for {fmtDate(appt.proposal.at)}.</p>}
      {appt.proposal?.status === "declined" && <p className="muted">The patient declined your last suggestion.</p>}
      <SlotPicker api={api} doctorId={doctorId} value={when} onChange={setWhen} fallback={<div className="row"><input type="datetime-local" min={minNow} onChange={(e) => setWhen(e.target.value ? new Date(e.target.value).toISOString() : "")} /><span className="muted">No weekly hours published. Add them in “My doctor profile” to offer slot selection.</span></div>} />
      <input placeholder="Optional note to the patient (for a suggested time)" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
      <div className="row"><button className="primary" disabled={!when} onClick={() => patch({ status: "confirmed", scheduledAt: when }, "Appointment confirmed.")}>✅ Confirm time</button>
        <button className="outline" disabled={!when || pending} onClick={propose}>🔁 Suggest this time to patient</button></div></>}
    <div className="row"><select value={next} onChange={(e) => setNext(e.target.value)}><option value="">Change status…</option>{NEXT.filter(([s]) => s !== appt.status).map(([s, t]) => <option key={s} value={s}>{t}</option>)}</select>
      <button className="outline" disabled={!next} onClick={() => { if (["rejected", "cancelled"].includes(next) && !confirm("Close this appointment?")) return; patch({ status: next }, "Status updated."); setNext(""); }}>Update</button></div>
  </div>;
}

function PatientRecord({ api, token, id, setMessage }: { api: Api; token: string; id: string; setMessage: (s: string) => void }) {
  const [d, setD] = useState<any>(null);
  useEffect(() => { api(`/appointments/${id}/patient-record`).then(setD).catch((e) => setMessage(e.message)); }, [id]);
  if (!d) return <p className="muted">Loading record…</p>;
  const p = d.patient || {};
  return <div className="record">
    <p><b>{p.name}</b> · {p.gender || "—"} · {p.bloodGroup || "blood group unknown"} · DOB {fmtDay(p.dateOfBirth)} · {p.phone || "no phone"}</p>
    <p className={(p.allergies || []).length ? "warn" : "muted"}>Allergies: {(p.allergies || []).join(", ") || "none recorded"}</p>
    <p>Current medicines: {(p.currentMedicines || []).join(", ") || "none recorded"}</p>
    <p>History: {p.medicalHistory || "none recorded"}</p>
    <p className="muted">Emergency contact: {p.emergencyContact?.name || "—"} {p.emergencyContact?.phone || ""} {p.emergencyContact?.relationship ? "(" + p.emergencyContact.relationship + ")" : ""}</p>
    <b>Reports</b>{(d.files || []).length === 0 && <p className="muted">No reports uploaded.</p>}
    {(d.files || []).map((f: any) => <p key={f._id}>{f.originalName} <span className="muted">{fmtDay(f.createdAt)} · {fmtSize(f.size)}</span> <button className="outline" onClick={() => downloadFile(token, f._id, f.originalName).catch((e) => setMessage(e.message))}>Download</button></p>)}
    <p className="muted">Viewing this record is logged.</p>
  </div>;
}


function AiSuggest({ api, appointmentId, reportId, onUse, setMessage }: { api: Api; appointmentId?: string; reportId?: string; onUse: (item: any) => void; setMessage: (s: string) => void }) {
  const [dx, setDx] = useState(""); const [busy, setBusy] = useState(false); const [res, setRes] = useState<any>(null);
  async function run() { if (!appointmentId && !reportId) { setMessage("Save the prescription from an appointment or report first."); return; } setBusy(true); setRes(null); try { setRes(await api("/ai/medicine-suggestions", { method: "POST", body: json({ diagnosis: dx, appointmentId, reportId }) })); } catch (e: any) { setMessage(e.message); } finally { setBusy(false); } }
  const use = (s: any, b?: any) => onUse({ ...emptyItem(), generic: b?.generic || s.generic, brand: b?.brand || "", strength: b?.strength || "", form: b?.form || "Tablet", medicineId: b?._id || "" });
  return <div className="aisugg"><b>✨ AI medicine ideas <span className="muted">(for your review only)</span></b>
    <div className="row"><input value={dx} onChange={(e) => setDx(e.target.value)} placeholder="Diagnosis / problem, e.g. acute pharyngitis" /><button type="button" className="outline" disabled={busy || dx.trim().length < 3} onClick={run}>{busy ? "Thinking…" : "Suggest"}</button></div>
    {res && <>{res.suggestions.length === 0 && <p className="muted">No suggestions returned. Try a clearer diagnosis.</p>}
      {res.suggestions.map((s: any, i: number) => <div key={i} className={"sgitem" + (s.allergyConflict ? " bad" : "")}>
        <b>{s.generic}</b> <span className="muted">{s.class}</span>
        {s.allergyConflict && <p className="warn">⚠️ Matches a recorded allergy. Do not prescribe.</p>}{s.alreadyTaking && <p className="warn">Patient already lists this medicine.</p>}
        <p>{s.reason}</p>{s.cautions && <p className="muted">Cautions: {s.cautions}</p>}
        <div className="row">{s.brands.slice(0, 5).map((b: any) => <button type="button" key={b._id} className="suggestion" disabled={s.allergyConflict} onClick={() => use(s, b)}>+ {b.brand} {b.strength || ""}</button>)}
          {s.brands.length === 0 && <button type="button" className="outline" disabled={s.allergyConflict} onClick={() => use(s)}>+ Add generic only</button>}</div></div>)}
      <p className="muted">{res.disclaimer}</p></>}
  </div>;
}

function RxEditor({ api, appointmentId, reportId, rx, onSaved, setMessage }: { api: Api; appointmentId?: string; reportId?: string; rx?: any; onSaved: () => void; setMessage: (s: string) => void }) {
  const [items, setItems] = useState<any[]>(rx ? rx.items.map((i: any) => ({ ...emptyItem(), ...i, medicineId: i.medicineId || "" })) : [emptyItem()]);
  const [notes, setNotes] = useState<string>(rx?.notes || ""); const [sugg, setSugg] = useState<{ i: number; list: any[] }>({ i: -1, list: [] });
  const upd = (i: number, k: string, v: string) => setItems(items.map((x, n) => (n === i ? { ...x, [k]: v } : x)));
  async function search(i: number, v: string) {
    setItems(items.map((x, n) => (n === i ? { ...x, generic: v, medicineId: "" } : x)));
    if (v.trim().length < 2) { setSugg({ i, list: [] }); return; }
    try { const d = await api(`/medicines?q=${encodeURIComponent(v)}`); setSugg({ i, list: d.medicines || [] }); } catch { setSugg({ i, list: [] }); }
  }
  function pick(i: number, m: any) { setItems(items.map((x, n) => (n === i ? { ...x, brand: m.brand, generic: m.generic, strength: m.strength || "", form: m.form || x.form, medicineId: m._id } : x))); setSugg({ i: -1, list: [] }); }
  async function save(e: any) {
    e.preventDefault();
    try {
      const body = json({ items: items.map((x) => ({ ...x, medicineId: x.medicineId || undefined })), notes });
      if (rx) await api(`/prescriptions/${rx._id}`, { method: "PATCH", body }); else if (reportId) await api(`/reports/${reportId}/prescriptions`, { method: "POST", body }); else await api(`/appointments/${appointmentId}/prescriptions`, { method: "POST", body });
      onSaved();
    } catch (x: any) { setMessage(x.message); }
  }
  return <form onSubmit={save} className="record">
    <p className="muted">Doses are entered by you. Check the patient’s allergies and current medicines in “Patient record” before prescribing.</p>
    <AiSuggest api={api} reportId={reportId || rx?.reportId} appointmentId={appointmentId || rx?.appointmentId?._id || rx?.appointmentId} onUse={(m) => setItems((cur) => (cur.length === 1 && !cur[0].generic ? [m] : [...cur, m]))} setMessage={setMessage} />
    {items.map((it, i) => <div className="item" key={i}>
      <label>Medicine (brand or generic name)<input value={it.generic} onChange={(e) => search(i, e.target.value)} placeholder="Type at least 2 letters" required />
        {it.brand && <span className="muted">Selected: {it.brand}</span>}</label>
      {sugg.i === i && sugg.list.length > 0 && <div className="suggestions">{sugg.list.map((m) => <button type="button" className="suggestion" key={m._id} onClick={() => pick(i, m)}><b>{m.brand}</b> <span className="muted">({m.generic})</span> {m.strength || ""} {m.form || ""}</button>)}</div>}
      <div className="cols">
        <label>Strength<input value={it.strength} onChange={(e) => upd(i, "strength", e.target.value)} /></label>
        <label>Form<select value={it.form} onChange={(e) => upd(i, "form", e.target.value)}>{["Tablet", "Capsule", "Syrup", "Injection", "Cream", "Eye drops", "Other"].map((f) => <option key={f}>{f}</option>)}</select></label>
        <label>Dose<input list={`dose-options-${i}`} value={it.dose} onChange={(e) => upd(i, "dose", e.target.value)} placeholder="Enter clinician-decided dose" required /><datalist id={`dose-options-${i}`}><option value="As directed by clinician" /><option value="1 tablet" /><option value="1 capsule" /><option value="5 mL" /><option value="1 drop" /></datalist></label>
        <label>Frequency<input list={`frequency-options-${i}`} value={it.frequency} onChange={(e) => upd(i, "frequency", e.target.value)} placeholder="Enter frequency" required /><datalist id={`frequency-options-${i}`}><option value="Once daily" /><option value="Twice daily" /><option value="Three times daily" /><option value="Every 8 hours" /><option value="As needed (specify maximum)" /></datalist></label>
        <label>Duration<input list={`duration-options-${i}`} value={it.duration} onChange={(e) => upd(i, "duration", e.target.value)} placeholder="Enter duration" required /><datalist id={`duration-options-${i}`}><option value="1 day" /><option value="3 days" /><option value="5 days" /><option value="7 days" /><option value="14 days" /></datalist></label>
        <label>Instructions<input value={it.instructions} onChange={(e) => upd(i, "instructions", e.target.value)} /></label>
      </div>
      {items.length > 1 && <button type="button" className="danger" onClick={() => setItems(items.filter((_, n) => n !== i))}>Remove medicine</button>}
    </div>)}
    <button type="button" className="outline" onClick={() => setItems([...items, emptyItem()])}>+ Add another medicine</button>
    <label>Notes for patient<textarea value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
    <button className="primary">{rx ? "Save changes" : "Save prescription draft"}</button>
  </form>;
}

function PrescriptionList({ api, token, setMessage }: { api: Api; token: string; setMessage: (s: string) => void }) {
  const [list, setList] = useState<any[]>([]); const [edit, setEdit] = useState(""); const [check, setCheck] = useState<Record<string, string>>({});
  async function load() { try { const d = await api("/prescriptions/mine"); setList(d.prescriptions || []); } catch (e: any) { setMessage(e.message); } }
  useEffect(() => { load(); }, []);
  async function sign(id: string) { if (!confirm("Sign this prescription? After signing it cannot be edited, only voided.")) return; try { await api(`/prescriptions/${id}/sign`, { method: "POST", body: json({}) }); setMessage("Prescription signed."); load(); } catch (e: any) { setMessage(e.message); } }
  async function del(id: string) { if (!confirm("Delete this draft?")) return; try { await api(`/prescriptions/${id}`, { method: "DELETE" }); load(); } catch (e: any) { setMessage(e.message); } }
  async function voidRx(id: string) { const reason = prompt("Reason for voiding (shown to the patient):"); if (!reason) return; try { await api(`/prescriptions/${id}/void`, { method: "POST", body: json({ reason }) }); setMessage("Prescription voided. Write a corrected one."); load(); } catch (e: any) { setMessage(e.message); } }
  async function verify(id: string) { try { const d = await api(`/prescriptions/${id}/verify`); setCheck({ ...check, [id]: d.valid ? "✔ Signature valid and content unchanged" : "✖ Not valid: " + (d.reason || "content or signature mismatch") }); } catch (e: any) { setMessage(e.message); } }
  return <div className="grid"><article className="full"><h3>Prescriptions</h3><button className="outline" onClick={load}>Refresh</button>
    {list.length === 0 && <p className="muted">No prescriptions yet. Create one from an appointment.</p>}
    {list.map((rx, idx) => <div className="item numbered" key={rx._id}>
      <div className="itemhead"><Seq n={idx + 1} /><b>{label(rx.status)}</b><span>{rx.patientId?.name}</span><time>{fmtDate(rx.signedAt || rx.createdAt)}</time><span className="muted">{rx.reportId ? "from report" : "from appointment"}</span></div>
      {rx.items.map((i: any, n: number) => <p key={n}>• {i.brand ? i.brand + " — " : ""}{i.generic} {i.strength} {i.form} — {i.dose}, {i.frequency}, {i.duration}</p>)}
      {rx.signatureHash && <p className="muted">Hash: {rx.signatureHash}</p>}
      <div className="row">
        {rx.status === "draft" && <><button className="outline" onClick={() => setEdit(edit === rx._id ? "" : rx._id)}>Edit</button><button className="primary" onClick={() => sign(rx._id)}>Review &amp; sign</button><button className="danger" onClick={() => del(rx._id)}>Delete draft</button></>}
        {rx.status === "signed" && <><button className="outline" onClick={() => verify(rx._id)}>Verify</button><button className="outline" onClick={() => printRx(rx)}>Print</button>{rx.pdfFileId && <button className="outline" onClick={() => downloadFile(token, rx.pdfFileId, "signed-prescription.pdf").catch((e) => setMessage(e.message))}>Download PDF</button>}<button className="danger" onClick={() => voidRx(rx._id)}>Void</button></>}
      </div>
      {check[rx._id] && <p className="notice">{check[rx._id]}</p>}
      {edit === rx._id && <RxEditor api={api} rx={rx} onSaved={() => { setEdit(""); setMessage("Draft updated."); load(); }} setMessage={setMessage} />}
    </div>)}
    <p className="muted">Signing creates an in-app Ed25519 signature and content hash. It is not a government-issued qualified digital certificate.</p></article></div>;
}





const REVIEW_OPEN = ["pending_doctor_review", "under_review", "changes_requested"];
const REVIEW_DONE = ["approved", "signed", "delivered"];
function DoctorReportReview({ api, token, setMessage }: { api: Api; token: string; setMessage: (s: string) => void }) {
  const [reports, setReports] = useState<any[]>([]); const [comments, setComments] = useState<Record<string, string>>({}); const [rxFor, setRxFor] = useState(""); const [show, setShow] = useState<"todo" | "done" | "all">("todo");
  async function load() { try { const d = await api("/reports/mine"); setReports((d.reports || []).filter((r: any) => r.doctorId)); } catch (e: any) { setMessage(e.message); } }
  useEffect(() => { load(); }, []);
  async function review(id: string, action: string) { try { await api(`/reports/${id}/review`, { method: "POST", body: json({ action, comment: comments[id] || "" }) }); setMessage(action === "approve" ? "Report approved. You can now write a prescription from it." : `Report ${action.replace("_", " ")} successfully.`); load(); } catch (e: any) { setMessage(e.message); } }
  const list = reports.filter((r) => (show === "all" ? true : show === "todo" ? REVIEW_OPEN.includes(r.status) : REVIEW_DONE.includes(r.status) || r.status === "rejected"));
  const dl = (id: string, name: string) => downloadFile(token, id, name).catch((e) => setMessage(e.message));
  return <div className="grid"><article className="full"><h3>Reports</h3>
    <div className="row"><button className={show === "todo" ? "primary" : "outline"} onClick={() => setShow("todo")}>To review ({reports.filter((r) => REVIEW_OPEN.includes(r.status)).length})</button><button className={show === "done" ? "primary" : "outline"} onClick={() => setShow("done")}>Reviewed / prescribe</button><button className={show === "all" ? "primary" : "outline"} onClick={() => setShow("all")}>All</button><button className="outline" onClick={load}>↻ Refresh</button></div>
    {list.length === 0 && <p className="muted">No reports here.</p>}
    {list.map((r, idx) => { const open = REVIEW_OPEN.includes(r.status); const done = REVIEW_DONE.includes(r.status); return <div className="item numbered" key={r._id}>
      <div className="itemhead"><Seq n={idx + 1} /><b>{r.patientId?.name || "Patient"}</b><span className={"statuschip " + (done ? "ok" : r.status === "rejected" ? "bad" : "warn")}>{label(r.status)}</span><time>{fmtDate(r.createdAt)}</time></div>
      <p className="muted">{done ? "Doctor-approved report" : "AI-generated analysis — not doctor-approved"}</p>
      <div className="row"><button className="outline" onClick={() => dl(r.originalFileId?._id || r.originalFileId, "original-report")}>Open original report</button>{r.aiPdfFileId && <button className="outline" onClick={() => dl(r.aiPdfFileId, "ai-analysis.pdf")}>AI PDF</button>}{r.finalPdfFileId && <button className="outline" onClick={() => dl(r.finalPdfFileId, "doctor-approved-report.pdf")}>Approved PDF</button>}</div>
      {(open || rxFor === r._id) && <>{(r.findings || []).map((f: any, i: number) => <p key={i}>{f.name}: {f.value} {f.unit} · <b>{f.status}</b> · {f.check}</p>)}<pre className="answer">{r.aiExplanation}</pre></>}
      {open && <><textarea rows={3} value={comments[r._id] || ""} onChange={(e) => setComments({ ...comments, [r._id]: e.target.value })} placeholder="Review comments / rejection reason / requested correction" />
        <div className="row"><button className="outline" onClick={() => review(r._id, "start")}>Start review</button><button className="outline" onClick={() => review(r._id, "comment")}>Save comment</button><button className="outline" onClick={() => review(r._id, "request_changes")}>Request changes</button><button className="danger" onClick={() => review(r._id, "reject")}>Reject</button><button className="primary" onClick={() => review(r._id, "approve")}>Approve &amp; sign</button></div></>}
      {done && <div className="row"><button className="primary" onClick={() => setRxFor(rxFor === r._id ? "" : r._id)}>💊 {rxFor === r._id ? "Close prescription" : "Write prescription / medicines"}</button></div>}
      {rxFor === r._id && <RxEditor api={api} reportId={r._id} onSaved={() => { setRxFor(""); setMessage("Prescription draft saved. Open the Prescriptions tab to review and sign it."); }} setMessage={setMessage} />}
    </div>; })}</article></div>;
}

function DoctorProfile({ api, token, onToken, setMessage }: { api: Api; token: string; onToken: (t: string) => void; setMessage: (s: string) => void }) {
  const [d, setD] = useState<any>(null); const [bio, setBio] = useState(""); const [phone, setPhone] = useState(""); const [clinic, setClinic] = useState(""); const [signature, setSignature] = useState<File | null>(null); const [signatureInfo, setSignatureInfo] = useState<any>(null); const [sigBusy, setSigBusy] = useState(false); const [photo, setPhoto] = useState<File | null>(null); const [photoBusy, setPhotoBusy] = useState(false); const [photoV, setPhotoV] = useState(1); const [slots,setSlots]=useState<any[]>([]); const [slotDay,setSlotDay]=useState("1"); const [slotStart,setSlotStart]=useState("09:00"); const [slotEnd,setSlotEnd]=useState("17:00");
  async function load() { try { const r = await api("/doctor/me"); setD(r); setPhone(r.user.phone || ""); setBio(r.user.doctorProfile?.bio || ""); setClinic(r.user.doctorProfile?.clinicName || ""); setSlots(r.user.doctorProfile?.availabilitySlots || []); const sig = await api("/doctor/signature"); setSignatureInfo(sig.signature); } catch (e: any) { setMessage(e.message); } }
  useEffect(() => { load(); }, []);
  async function save(e: any) { e.preventDefault(); try { await api("/doctor/profile", { method: "PATCH", body: json({ phone, clinicName: clinic, bio }) }); setMessage("Profile updated."); load(); } catch (x: any) { setMessage(x.message); } }
  const u = d?.user; const p = u?.doctorProfile || {};
  return <div className="grid">
    <article><h3>Doctor ID</h3>{!u ? <p className="muted">Loading…</p> : <>
      <p><b>Dr. {u.name}</b></p><p>{p.specialty} · {(p.qualifications || []).join(", ")}</p>
      <p>BMDC: <b>{p.bmdcNumber}</b> · {p.experienceYears ?? 0} years</p><p>{u.email}</p>
      <p className="notice">{u.status === "active" ? "Verified" + (p.verifiedAt ? " on " + fmtDay(p.verifiedAt) : "") : label(u.status)}</p>
      <b>Submitted documents</b>{(d.documents || []).map((f: any) => <p key={f._id}>{label(f.category)} — {f.originalName} <button className="outline" onClick={() => downloadFile(token, f._id, f.originalName).catch((e) => setMessage(e.message))}>Download</button></p>)}</>}</article>
    <article><h3>Profile photo</h3><p className="muted">This photo is shown beside your name when patients choose a doctor.</p>{u && <DoctorPhoto token={token} doctor={{ _id: u._id || u.id, name: u.name, hasPhoto: true }} size={96} v={photoV} />}<input type="file" accept="image/jpeg,image/png,image/webp" onChange={e => setPhoto(e.target.files?.[0] || null)} /><button className="primary" disabled={!photo || photoBusy} onClick={async()=>{if(!photo)return;const fd=new FormData();fd.append("file",photo);setPhotoBusy(true);try{await postForm("/doctor/photo",fd,token);setPhoto(null);setPhotoV(Date.now());setMessage("Profile photo updated.");}catch(e:any){setMessage(e.message);}finally{setPhotoBusy(false);}}}>{photoBusy?"Saving…":"Upload / replace photo"}</button></article>
    <article><h3>Permanent signature</h3><p className="muted">Upload a clear PNG, JPG or WEBP signature once. It is stored privately and a historical snapshot is attached when you sign a prescription or approve a report.</p><input type="file" accept="image/png,image/jpeg" onChange={e => setSignature(e.target.files?.[0] || null)} /><button className="primary" disabled={!signature || sigBusy} onClick={async()=>{if(!signature)return;const fd=new FormData();fd.append("file",signature);setSigBusy(true);try{const r=await postForm("/doctor/signature",fd,token);setSignatureInfo(r.signature);setSignature(null);setMessage("Permanent signature saved securely.");}catch(e:any){setMessage(e.message);}finally{setSigBusy(false);}}}>{sigBusy?"Saving…":signatureInfo?"Replace saved signature":"Save signature"}</button>{signatureInfo&&<p className="notice">Signature saved · {fmtDay(signatureInfo.updatedAt)}</p>}</article>
    <article><h3>Weekly availability</h3><p className="muted">Publish the hours when patients may be scheduled. Times are interpreted in the hospital server's configured timezone.</p><div className="row"><select value={slotDay} onChange={e=>setSlotDay(e.target.value)}><option value="0">Sunday</option><option value="1">Monday</option><option value="2">Tuesday</option><option value="3">Wednesday</option><option value="4">Thursday</option><option value="5">Friday</option><option value="6">Saturday</option></select><input type="time" value={slotStart} onChange={e=>setSlotStart(e.target.value)}/><input type="time" value={slotEnd} onChange={e=>setSlotEnd(e.target.value)}/><button className="outline" onClick={()=>{if(slotStart>=slotEnd){setMessage("End time must be after start time.");return;}setSlots([...slots,{day:Number(slotDay),start:slotStart,end:slotEnd}]);}}>Add</button></div>{slots.map((x,i)=><p key={i} className="muted">{["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][x.day]} · {x.start}–{x.end} <button className="outline" onClick={()=>setSlots(slots.filter((_,n)=>n!==i))}>Remove</button></p>)}<button className="primary" onClick={async()=>{try{await api("/doctor/availability",{method:"PATCH",body:json({slots})});setMessage("Availability published.");}catch(e:any){setMessage(e.message);}}}>Save availability</button></article>
    <article><h3>Edit contact details</h3><form onSubmit={save}>
      <label>About me / doctor details (patients can read this)<textarea value={bio} maxLength={1000} onChange={(e) => setBio(e.target.value)} placeholder="Experience, areas of interest, languages, chamber details…" /></label>
      <label>Phone<input value={phone} onChange={(e) => setPhone(e.target.value)} /></label>
      <label>Clinic / hospital<input value={clinic} onChange={(e) => setClinic(e.target.value)} /></label>
      <button className="primary">Save</button></form>
      <p className="muted">Name, BMDC number and specialty can only be changed by the admin team after verification.</p></article>
    <ChangePassword api={api} onToken={onToken} setMessage={setMessage} />
  </div>;
}
