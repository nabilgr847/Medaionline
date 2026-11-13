// © 2026 MD Gausur Rahman Nabil. All rights reserved. MedAI Hospital.
import { useEffect, useState } from "react";
import { Api, downloadFile, fmtDate, label } from "./api";
import { SecretQr } from "./qr";

/** Doctor: every assigned patient with ALL their reports, prescriptions and uploaded files. */
export function DoctorPatients({ api, token, setMessage }: { api: Api; token: string; setMessage: (s: string) => void }) {
  const [list, setList] = useState<any[]>([]); const [sel, setSel] = useState(""); const [rec, setRec] = useState<any>(null); const [q, setQ] = useState("");
  useEffect(() => { api("/doctor/patients").then((d) => setList(d.patients || [])).catch((e) => setMessage(e.message)); }, []);
  async function open(id: string) { setSel(id); setRec(null); try { setRec(await api(`/doctor/patients/${id}/records`)); } catch (e: any) { setMessage(e.message); } }
  const dl = (id: string, name: string) => downloadFile(token, id, name).catch((e) => setMessage(e.message));
  const shown = list.filter((p) => !q.trim() || (p.name + " " + (p.email || "")).toLowerCase().includes(q.trim().toLowerCase()));
  return <div className="grid">
    <article className="full"><h3>My patients</h3>
      <p className="muted">Patients assigned to you. Open one to see all earlier reports, prescriptions and uploaded files.</p>
      <input placeholder="Search patient name or email" value={q} onChange={(e) => setQ(e.target.value)} />
      {shown.length === 0 && <p className="muted">No assigned patients yet.</p>}
      <div className="row">{shown.map((p) => <button key={p._id} className={sel === p._id ? "primary" : "outline"} onClick={() => open(p._id)}>{p.name}</button>)}</div>
    </article>
    {sel && !rec && <article className="full"><p className="muted">Loading…</p></article>}
    {rec && <>
      <article className="full"><h3>{rec.patient?.name}</h3><p className="muted">{[rec.patient?.email, rec.patient?.phone, rec.patient?.gender].filter(Boolean).join(" · ")}</p>
        <b>Appointments ({rec.appointments.length})</b>
        {rec.appointments.map((a: any) => <p key={a._id} className="muted">{fmtDate(a.scheduledAt || a.createdAt)} · {label(a.status)} · {a.problem}{a.doctorId?.name ? " · Dr. " + a.doctorId.name : ""}</p>)}</article>
      <article className="full"><h3>Reports ({rec.reports.length})</h3>
        {rec.reports.length === 0 && <p className="muted">No analysed reports.</p>}
        {rec.reports.map((r: any) => <div className="item" key={r._id}>
          <b>{label(r.docType || "report")}</b> · {label(r.status)} · <time>{fmtDate(r.createdAt)}</time>{r.doctorId?.name ? ` · Dr. ${r.doctorId.name}` : ""}
          <div className="row">
            {r.originalFileId && <button className="outline" onClick={() => dl(r.originalFileId, "report")}>Original</button>}
            {r.aiPdfFileId && <button className="outline" onClick={() => dl(r.aiPdfFileId, "ai-analysis.pdf")}>AI PDF</button>}
            {r.finalPdfFileId && <button className="outline" onClick={() => dl(r.finalPdfFileId, "approved-report.pdf")}>Approved PDF</button>}
            <SecretQr api={api} kind="report" id={r._id} />
          </div>
          {(r.findings || []).length > 0 && <details><summary>Test results ({r.findings.length})</summary>{r.findings.map((f: any, i: number) => <p key={i} className="muted">{f.name}: {f.value} {f.unit} · <b>{f.status}</b></p>)}</details>}
          {(r.doctorExplanation || r.aiExplanation) && <details><summary>Analysis</summary><p style={{ whiteSpace: "pre-wrap" }}>{r.doctorExplanation || r.aiExplanation}</p></details>}
          {r.advisedTests && <p><b>Tests advised:</b> {r.advisedTests}</p>}
          {r.reviewComment && <p className="muted">Doctor comment: {r.reviewComment}</p>}
        </div>)}</article>
      <article className="full"><h3>Prescriptions ({rec.prescriptions.length})</h3>
        {rec.prescriptions.length === 0 && <p className="muted">No prescriptions.</p>}
        {rec.prescriptions.map((x: any) => <div className="item" key={x._id}>
          <b>{label(x.status)}</b> · Dr. {x.doctorId?.name || "—"} · <time>{x.signedAt ? "Signed " + fmtDate(x.signedAt) : fmtDate(x.createdAt)}</time>
          {(x.items || []).map((i: any, n: number) => <p key={n} className="muted">• {i.generic} {i.strength} — {i.dose}, {i.frequency}, {i.duration}</p>)}
          {x.clinical?.diagnosis && <p><b>Diagnosis:</b> {x.clinical.diagnosis}</p>}
          {x.advisedTests && <p><b>Tests advised:</b> {x.advisedTests}</p>}
          {x.status !== "draft" && <div className="row">{x.pdfFileId && <button className="outline" onClick={() => dl(x.pdfFileId, "prescription.pdf")}>Prescription PDF</button>}<SecretQr api={api} kind="rx" id={x._id} /></div>}
        </div>)}</article>
      <article className="full"><h3>Uploaded files ({rec.files.length})</h3>
        {rec.files.map((f: any) => <p key={f._id}><button className="outline" onClick={() => dl(f._id, f.originalName)}>{f.originalName}</button> <span className="muted">{fmtDate(f.createdAt)}</span></p>)}</article>
    </>}
  </div>;
}

/** Admin: all prescriptions with signing time, PDF and QR. */
export function AdminRx({ api, token, setMessage }: { api: Api; token: string; setMessage: (s: string) => void }) {
  const [list, setList] = useState<any[]>([]);
  useEffect(() => { api("/prescriptions/mine").then((d) => setList((d.prescriptions || []).filter((x: any) => x.status !== "draft"))).catch((e) => setMessage(e.message)); }, []);
  return <article className="full"><h3>💊 Prescriptions</h3>
    {list.length === 0 && <p className="muted">No signed prescriptions yet.</p>}
    {list.map((x) => <div className="item" key={x._id}>
      <b>{x.patientId?.name || "Patient"}</b> · Dr. {x.doctorId?.name || "—"} · {label(x.status)} · <time>{x.signedAt ? "Signed " + fmtDate(x.signedAt) : fmtDate(x.createdAt)}</time>
      <div className="row">{x.pdfFileId && <button className="outline" onClick={() => downloadFile(token, x.pdfFileId, "prescription.pdf").catch((e) => setMessage(e.message))}>Prescription PDF</button>}<SecretQr api={api} kind="rx" id={x._id} /></div>
    </div>)}</article>;
}
