// © 2026 MD Gausur Rahman Nabil. All rights reserved. MedAI Hospital.
import { useEffect, useRef, useState } from "react";
import { Api, json, postForm, downloadFile, fmtDate, fmtDay, fmtSize, label, listFromText } from "./api";
import ChatAI, { FindingsList, ReportView } from "./ChatAI";
import { Notifications, Seq, useBadges, Tabs, Chat, ChangePassword, SlotPicker } from "./common";
import { PatientCombined } from "./v38";
import { printRx } from "./print";
import { useTabHistory } from "./tabHistory";
import TeleVisitCall from "./TeleVisitCall";
import { DoctorPicker, DirectMessages } from "./extras";

const CANCELLABLE = ["requested", "awaiting_records", "awaiting_tests", "confirmed", "follow_up_required"];
const ACTIVE_CHAT = ["requested", "awaiting_records", "awaiting_tests", "confirmed", "waiting_room", "in_progress", "follow_up_required", "completed"];

export default function PatientPanel({ api, token, user, onToken, setMessage }: { api: Api; token: string; user: any; onToken: (t: string) => void; setMessage: (s: string) => void }) {
  const [tab, setTab] = useTabHistory("appointments", "patientTab");
  const badges = useBadges(api, "patient");
  useEffect(() => { const f = (e: any) => setTab(e.detail?.kind === "direct" ? "messages" : "appointments"); window.addEventListener("medai-open", f); return () => window.removeEventListener("medai-open", f); }, []);
  return <div>
    <Tabs strip="patient" badges={badges} tab={tab} setTab={setTab} tabs={[["appointments", "Appointments"], ["reports", "My reports"], ["combined", "Combined analysis"], ["notifications", "Notifications"], ["messages", "Admin messages"], ["nearby", "Nearby care"], ["rx", "Prescriptions"], ["medicines", "Medicine search"], ["profile", "Health profile"], ["ai", "AI assistant"], ["account", "Account"]]} />
    {tab === "appointments" && <Appointments api={api} token={token} user={user} setMessage={setMessage} />}
    {tab === "reports" && <Reports api={api} token={token} setMessage={setMessage} />}
    {tab === "combined" && <PatientCombined api={api} setMessage={setMessage} />}
    {tab === "notifications" && <Notifications api={api} setMessage={setMessage} />}
    {tab === "messages" && <DirectMessages api={api} token={token} user={user} setMessage={setMessage} />}
    {tab === "nearby" && <NearbyCare />}
    {tab === "rx" && <MyPrescriptions api={api} token={token} user={user} setMessage={setMessage} />}
    {tab === "medicines" && <MedicineSearch api={api} setMessage={setMessage} />}
    {tab === "profile" && <Profile api={api} setMessage={setMessage} />}
    {tab === "ai" && <ChatAI api={api} token={token} setMessage={setMessage} />}
    {tab === "account" && <div className="grid"><ChangePassword api={api} onToken={onToken} setMessage={setMessage} /></div>}
  </div>;
}

function Appointments({ api, token, user, setMessage }: { api: Api; token: string; user: any; setMessage: (s: string) => void }) {
  const [list, setList] = useState<any[]>([]); const [doctors, setDoctors] = useState<any[]>([]); const [specialties, setSpecialties] = useState<string[]>([]);
  const [slot, setSlot] = useState(""); const [problem, setProblem] = useState(""); const [doctorId, setDoctorId] = useState(""); const [type, setType] = useState("online"); const [openChat, setOpenChat] = useState(""); const [openCall, setOpenCall] = useState("");
  const [pastDiseases, setPastDiseases] = useState(""); const [pastInfo, setPastInfo] = useState("");
  async function load() { try { const d = await api("/appointments"); setList(d.appointments || []); } catch (e: any) { setMessage(e.message); } }
  useEffect(() => { const f = () => { const d = (window as any).__medaiOpen; if (!d) return; if (d.kind === "call") { setOpenCall(d.appointmentId); setOpenChat(""); } else { setOpenChat(d.appointmentId); } load(); (window as any).__medaiOpen = null; }; f(); window.addEventListener("medai-open", f); return () => window.removeEventListener("medai-open", f); }, []);
  useEffect(() => { load(); api("/doctors").then((d) => { setDoctors(d.doctors || []); setSpecialties(d.specialties || []); }).catch(() => {}); }, []);
  async function book(e: any) {
    e.preventDefault();
    try {
      await api("/appointments", { method: "POST", body: json({ problem, consultationType: type, pastDiseases, pastInfo, ...(doctorId ? { doctorId } : {}), ...(doctorId && slot ? { preferredAt: slot } : {}) }) });
      setProblem(""); setDoctorId(""); setSlot(""); setPastDiseases(""); setPastInfo("");
      setMessage("Appointment request submitted. A doctor will accept it and confirm a time."); load();
    } catch (x: any) { setMessage(x.message); }
  }
  async function respond(id: string, accept: boolean) { try { await api(`/appointments/${id}/respond-proposal`, { method: "POST", body: json({ accept }) }); setMessage(accept ? "Time accepted. Your appointment is confirmed." : "Suggested time declined."); load(); } catch (x: any) { setMessage(x.message); load(); } }
  async function cancel(id: string) { if (!confirm("Cancel this appointment?")) return; try { await api(`/appointments/${id}/cancel`, { method: "POST", body: json({}) }); setMessage("Appointment cancelled."); load(); } catch (x: any) { setMessage(x.message); } }
  return <div className="grid">
    <article><h3>Request an appointment</h3><form onSubmit={book}>
      <textarea placeholder="Describe the reason for your appointment" value={problem} onChange={(e) => setProblem(e.target.value)} required minLength={5} />
      <label>Past diseases / chronic conditions (optional)<textarea placeholder="e.g. diabetes, hypertension, asthma…" value={pastDiseases} onChange={(e) => setPastDiseases(e.target.value)} maxLength={2000} rows={2} /></label>
      <label>Other past medical information (optional)<textarea placeholder="Previous surgeries, hospital stays, allergies detail, family history…" value={pastInfo} onChange={(e) => setPastInfo(e.target.value)} maxLength={4000} rows={2} /></label>
      <label>Choose a doctor (optional) — search or filter by specialty</label>
      <DoctorPicker token={token} doctors={doctors} specialties={specialties} value={doctorId} onChange={(id) => { setDoctorId(id); setSlot(""); }} />
      {doctorId && <SlotPicker api={api} doctorId={doctorId} value={slot} onChange={setSlot} />}
      <label>Consultation type<select value={type} onChange={(e) => setType(e.target.value)}><option value="online">Online</option><option value="in_person">In person</option></select></label>
      <button className="primary">📨 Send request</button></form>
      <p className="warn">For chest pain, severe breathing difficulty, stroke symptoms, unconsciousness or severe bleeding, call 999 now instead of booking.</p></article>
    <article><h3>My appointments</h3><button className="outline" onClick={load}>Refresh</button>
      {list.length === 0 && <p className="muted">No appointments yet.</p>}
      {list.map((a) => <div className="item" key={a._id}>
        <b>{label(a.status)}</b>{a.scheduledAt && <> · {fmtDate(a.scheduledAt)}</>}
        <p>{a.problem}</p>
        {a.preferredAt && a.status === "requested" && <p className="muted">🕒 You asked for: {fmtDate(a.preferredAt)}</p>}
        {a.proposal?.status === "pending" && <div className="notice">🔁 The doctor suggests <b>{fmtDate(a.proposal.at)}</b>{a.proposal.note ? " — " + a.proposal.note : ""}<div className="row"><button className="primary" onClick={() => respond(a._id, true)}>✅ Accept this time</button><button className="danger" onClick={() => respond(a._id, false)}>✖ Decline</button></div></div>}
        {a.proposal?.status === "declined" && a.status === "requested" && <p className="muted">You declined the last suggested time. The doctor can suggest another.</p>}
        <p className="muted">{a.doctorId ? "Dr. " + a.doctorId.name + (a.doctorId.doctorProfile?.specialty ? " (" + a.doctorId.doctorProfile.specialty + ")" : "") : "Waiting for a doctor to accept"} · {label(a.consultationType)}</p>
        <div className="row">
          {a.doctorId && ACTIVE_CHAT.includes(a.status) && <button className="outline" onClick={() => setOpenChat(openChat === a._id ? "" : a._id)}>{openChat === a._id ? "Hide chat" : "Chat"}</button>}
          {a.doctorId && a.consultationType === "online" && ACTIVE_CHAT.includes(a.status) && a.status !== "completed" && <button className="outline" onClick={() => setOpenCall(openCall === a._id ? "" : a._id)}>{openCall === a._id ? "Hide call" : "Audio / Video call"}</button>}
          {CANCELLABLE.includes(a.status) && <button className="danger" onClick={() => cancel(a._id)}>Cancel</button>}
        </div>
        {openChat === a._id && ACTIVE_CHAT.includes(a.status) && <Chat api={api} appointmentId={a._id} meId={user.id} token={token} />}
        {openCall === a._id && ACTIVE_CHAT.includes(a.status) && a.status !== "completed" && <TeleVisitCall api={api} token={token} appointmentId={a._id} user={user} setMessage={setMessage} />}
      </div>)}</article>
  </div>;
}




function Reports({ api, token, setMessage }: { api: Api; token: string; setMessage: (s: string) => void }) {
  const [openRid, setOpenRid] = useState("");
  const [files, setFiles] = useState<any[]>([]); const [reports, setReports] = useState<any[]>([]); const [file, setFile] = useState<File | null>(null); const [busy, setBusy] = useState(false); const [reportText, setReportText] = useState(""); const [reportAnalysis, setReportAnalysis] = useState("");
  async function load() { try { const d = await api("/files/mine"); setFiles((d.files || []).filter((f: any) => f.category === "patient_report")); const r=await api("/reports/mine");setReports(r.reports||[]); } catch (e: any) { setMessage(e.message); } }
  useEffect(() => { load(); }, []);
  async function send() {
    if (!file) return; const fd = new FormData(); fd.append("file", file); fd.append("category", "patient_report"); setBusy(true);
    try { await postForm("/files/upload", fd, token); setFile(null); setMessage("Report uploaded privately. Your assigned doctor can view it."); load(); } catch (e: any) { setMessage(e.message); } finally { setBusy(false); }
  }
  async function remove(id: string) { if (!confirm("Delete this report permanently?")) return; try { await api(`/files/${id}`, { method: "DELETE" }); load(); } catch (e: any) { setMessage(e.message); } }
  async function analyzeReport() { setBusy(true); try { const d = await api("/ai/report-analysis", { method: "POST", body: json({ reportText }) }); setReportAnalysis(d.answer + "\n\n" + d.disclaimer); } catch (e: any) { setMessage(e.message); } finally { setBusy(false); } }
  return <div className="grid">
    <article><h3>Upload a report</h3><p className="muted">PDF, JPG, PNG or WEBP. Only you and the doctor assigned to your appointment can open patient reports.</p>
      <input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" onChange={(e) => setFile(e.target.files?.[0] || null)} />
      <div className="row"><button className="primary" onClick={send} disabled={!file || busy}>{busy ? "Working…" : "Upload report"}</button><button className="outline" onClick={async()=>{if(!file)return;const fd=new FormData();fd.append("file",file);setBusy(true);try{const uploaded=await postForm("/files/upload",fd,token);const analyzed=await api(`/reports/${uploaded.file.id}/analyze`,{method:"POST",body:json({})});setReportAnalysis(analyzed.report.aiExplanation+"\n\nStatus: "+analyzed.report.status+"\n\n"+analyzed.disclaimer);load();}catch(e:any){setMessage(e.message);}finally{setBusy(false);}}} disabled={!file || busy}>{busy ? "Analyzing…" : "Analyze PDF/image"}</button></div></article>
    <article><h3>Upload audio or video</h3><p className="muted">MP3, M4A, OGG, WAV, MP4, WEBM or MOV. Uploading stores the file privately; it does not automatically transcribe or analyze it.</p><MediaUploader api={api} token={token} setMessage={setMessage} /></article>
    <article className="full"><h3>Explain report text with AI</h3><p className="muted">PDF text extraction/scanned-page OCR is used for PDFs. Report images are sent to the configured vision-capable AI model and cross-checked with Bangla/English OCR. OCR/vision may misread numbers; verify every value against the original. Text analysis is also available below.</p><textarea rows={5} value={reportText} onChange={e => setReportText(e.target.value)} placeholder="Paste test name, result, unit and reference range…" /><button className="primary" disabled={busy || reportText.trim().length < 20} onClick={analyzeReport}>{busy ? "Analyzing…" : "Explain report text"}</button>{reportAnalysis && <pre className="answer">{reportAnalysis}</pre>}</article>
    <article><h3>My reports</h3>{files.length === 0 && reports.length===0 && <p className="muted">No reports uploaded.</p>}
      {[...files.map((f: any) => ({ k: "f", t: f.createdAt, f })), ...reports.map((r: any) => ({ k: "r", t: r.createdAt, r }))].sort((x, y) => +new Date(y.t) - +new Date(x.t)).map((e: any, i: number) => e.k === "f" ? ((f: any, n: number) => <div className="item numbered" key={f._id}><div className="itemhead"><Seq n={n} /><b>{f.originalName}</b><time>{fmtDate(f.createdAt)}</time></div><p className="muted">Uploaded file · {fmtSize(f.size)}</p><div className="row"><button className="outline" onClick={() => downloadFile(token, f._id, f.originalName).catch((e) => setMessage(e.message))}>⬇️ Download original</button><button className="danger" onClick={() => remove(f._id)}>Delete</button></div></div>)(e.f, i + 1) : ((r: any, n: number) => <div className="item numbered" key={r._id}><div className="itemhead"><Seq n={n} /><b>AI report review · {label(r.status)}</b><time>{fmtDate(r.createdAt)}</time></div><p className="muted">{r.doctorId?.name?`Dr. ${r.doctorId.name}`:"Waiting for doctor assignment"}</p>{openRid !== r._id && <FindingsList findings={r.findings} />}<div className="row"><button className="outline" onClick={() => setOpenRid(openRid === r._id ? "" : r._id)}>{openRid === r._id ? "Hide analysis" : "View analysis"}</button></div>{openRid === r._id && <ReportView api={api} token={token} report={{ ...r, doctorName: r.doctorId?.name }} onError={setMessage} />}{r.rejectionReason&&<p className="warn">Reason: {r.rejectionReason}</p>}{r.reviewComment&&<p>{r.reviewComment}</p>}<div className="row">{r.aiPdfFileId&&<button className="outline" onClick={()=>downloadFile(token,r.aiPdfFileId,"ai-report.pdf").catch((e)=>setMessage(e.message))}>Download AI PDF</button>}{r.finalPdfFileId&&<button className="primary" onClick={()=>downloadFile(token,r.finalPdfFileId,"doctor-approved-report.pdf").catch((e)=>setMessage(e.message))}>Download approved PDF</button>}</div></div>)(e.r, i + 1))}
      </article>
  </div>;
}

const RADII = [1000, 2000, 3000, 5000, 8000, 12000, 20000];
const kmText = (m: number) => (m < 1000 ? m + " m" : m / 1000 + " km");
const distM = (la1: number, lo1: number, la2: number, lo2: number) => { const R = 6371000, r = Math.PI / 180, dLa = (la2 - la1) * r, dLo = (lo2 - lo1) * r; const x = Math.sin(dLa / 2) ** 2 + Math.cos(la1 * r) * Math.cos(la2 * r) * Math.sin(dLo / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(x)); };
function NearbyCare() {
  const [coords, setCoords] = useState<{lat:number;lon:number}|null>(null);
  const [places, setPlaces] = useState<any[]>([]); const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [radius, setRadius] = useState(0);
  const stop = useRef(false);
  useEffect(() => () => { stop.current = true; }, []);
  async function searchRadius(lat: number, lon: number, r: number) {
    const q = `[out:json][timeout:25];nwr(around:${r},${lat},${lon})[amenity~"hospital|clinic|doctors|pharmacy"];out center tags;`;
    const response = await fetch("https://overpass-api.de/api/interpreter", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" }, body: "data=" + encodeURIComponent(q) });
    if (!response.ok) throw new Error("OpenStreetMap search is temporarily unavailable.");
    const data = await response.json();
    return (data.elements || []).map((x: any) => { const la = x.lat ?? x.center?.lat, lo = x.lon ?? x.center?.lon; return { id: x.id, name: x.tags?.name || x.tags?.["name:en"] || x.tags?.amenity || "Healthcare place", type: x.tags?.amenity || "healthcare", lat: la, lon: lo, address: [x.tags?.["addr:street"], x.tags?.["addr:city"]].filter(Boolean).join(", "), dist: Number.isFinite(la) && Number.isFinite(lo) ? distM(lat, lon, la, lo) : Infinity }; })
      .filter((x: any) => Number.isFinite(x.dist)).sort((a: any, b: any) => a.dist - b.dist).slice(0, 60);
  }
  // Searches 1 km, 2 km, 3 km ... step by step, so nearby places appear first and the map zooms out as the range grows.
  async function find() {
    setError(""); setPlaces([]); setRadius(0); stop.current = false; setBusy(true);
    if (!navigator.geolocation) { setError("Location is not supported by this browser."); setBusy(false); return; }
    navigator.geolocation.getCurrentPosition(async pos => {
      const lat = pos.coords.latitude, lon = pos.coords.longitude; setCoords({ lat, lon });
      let got = false;
      for (const r of RADII) {
        if (stop.current) break;
        setRadius(r);
        try { const found = await searchRadius(lat, lon, r); got = true; setPlaces(found); }
        catch (e: any) { if (!got) setError(e.message || "Could not load nearby places."); break; }
        await new Promise(res => setTimeout(res, 900));
      }
      setBusy(false);
    }, e => { setError(e.message || "Allow location permission to search nearby."); setBusy(false); }, { enableHighAccuracy: false, timeout: 10000 });
  }
  const dLat = (Math.max(radius, 1000) / 111000) * 1.15; const dLon = coords ? dLat / Math.max(0.2, Math.cos(coords.lat * Math.PI / 180)) : 0;
  const mapSrc = coords ? `https://www.openstreetmap.org/export/embed.html?bbox=${coords.lon - dLon}%2C${coords.lat - dLat}%2C${coords.lon + dLon}%2C${coords.lat + dLat}&layer=mapnik&marker=${coords.lat}%2C${coords.lon}` : "";
  return <div className="grid"><article className="full"><h3>Nearby hospitals & healthcare</h3><p className="muted">Uses OpenStreetMap data, not Google Maps. Results may be incomplete or outdated; call the facility to confirm availability.</p>
    <div className="row"><button className="primary" onClick={find} disabled={busy}>{busy ? "Searching…" : "Find places near me"}</button>{busy && <button className="outline" onClick={() => { stop.current = true; }}>Stop</button>}</div>
    {busy && radius > 0 && <p className="searchstate"><span className="spin" /> Searching within <b>{kmText(radius)}</b>… going wider step by step.</p>}
    {error && <p className="warn">{error}</p>}{coords && <iframe key={radius} title="OpenStreetMap nearby healthcare map" src={mapSrc} loading="lazy" style={{ width: "100%", height: 360, border: 0, borderRadius: 16, marginTop: 16 }} />}</article>
    <article className="full"><h3>{radius ? `Results within ${kmText(radius)}` : "Results"}{places.length > 0 && <small className="muted"> · {places.length} found</small>}</h3>
      {places.length === 0 && !busy && <p className="muted">Tap “Find places near me” to load available map data.</p>}
      {places.length === 0 && busy && <p className="muted">Nothing found yet, still searching wider…</p>}
      {places.map(p => <div className="item" key={`${p.id}-${p.type}`}><b>{p.name}</b><p className="muted">{p.type} · {p.dist < 1000 ? Math.round(p.dist) + " m" : (p.dist / 1000).toFixed(1) + " km"} away{p.address ? ` · ${p.address}` : ""}</p><a href={`https://www.openstreetmap.org/?mlat=${p.lat}&mlon=${p.lon}#map=17/${p.lat}/${p.lon}`} target="_blank" rel="noreferrer">Open in OpenStreetMap</a></div>)}</article></div>;
}

function MediaUploader({ api, token, setMessage }: { api: Api; token: string; setMessage: (s: string) => void }) {
  const [media, setMedia] = useState<File | null>(null); const [busy, setBusy] = useState(false);
  async function uploadMedia() {
    if (!media) return;
    const fd = new FormData(); fd.append("file", media); fd.append("category", "other");
    setBusy(true);
    try { await postForm("/files/upload", fd, token); setMedia(null); setMessage("Media file uploaded privately. It is stored only; automatic transcription/AI analysis is not enabled."); }
    catch (e: any) { setMessage(e.message); }
    finally { setBusy(false); }
  }
  return <div className="stack">
    <input type="file" accept="audio/*,video/mp4,video/webm,video/quicktime" onChange={e => setMedia(e.target.files?.[0] || null)} />
    {media && <p className="muted">{media.name} · {fmtSize(media.size)}</p>}
    <button className="primary" onClick={uploadMedia} disabled={!media || busy}>{busy ? "Uploading…" : "Upload audio/video"}</button>
  </div>;
}

function MyPrescriptions({ api, token, user, setMessage }: { api: Api; token: string; user: any; setMessage: (s: string) => void }) {
  const [list, setList] = useState<any[]>([]); const [check, setCheck] = useState<Record<string, string>>({});
  useEffect(() => { api("/prescriptions/mine").then((d) => setList(d.prescriptions || [])).catch((e) => setMessage(e.message)); }, []);
  async function verify(id: string) { try { const d = await api(`/prescriptions/${id}/verify`); setCheck({ ...check, [id]: d.valid ? "✔ Signature valid and content unchanged" : "✖ Could not verify: " + (d.reason || "content or signature does not match") }); } catch (e: any) { setMessage(e.message); } }
  return <div className="grid"><article className="full"><h3>My prescriptions</h3>
    <p className="muted">Take your prescription to a licensed pharmacist. Do not change doses without your doctor.</p>
    {list.length === 0 && <p className="muted">No prescriptions yet.</p>}
    {list.map((rx, idx) => <div className="item numbered" key={rx._id}>
      <div className="itemhead"><Seq n={idx + 1} /><b>{label(rx.status)}</b><span>Dr. {rx.doctorId?.name}</span><time>{fmtDate(rx.signedAt || rx.createdAt)}</time></div>
      {rx.status === "voided" && <p className="warn">This prescription was voided{rx.voidReason ? ": " + rx.voidReason : ""}. Do not use it.</p>}
      {rx.items.map((i: any, n: number) => <p key={n}>• {i.brand ? i.brand + " — " : ""}{i.generic} {i.strength} {i.form} — {i.dose}, {i.frequency}, {i.duration}{i.instructions ? " (" + i.instructions + ")" : ""}</p>)}
      {rx.clinical?.diagnosis && <p><b>Diagnosis:</b> {rx.clinical.diagnosis}</p>}
      {rx.advisedTests && <p style={{ whiteSpace: "pre-wrap" }}><b>Advised tests:</b> {rx.advisedTests}</p>}
      {rx.clinical?.advice && <p style={{ whiteSpace: "pre-wrap" }}><b>Advice:</b> {rx.clinical.advice}</p>}{rx.clinical?.followUp && <p><b>Follow-up:</b> {rx.clinical.followUp}</p>}
      {rx.notes && <p className="muted">Notes: {rx.notes}</p>}
      <div className="row"><button className="outline" onClick={() => verify(rx._id)}>🔏 Verify signature</button><button className="outline" onClick={() => printRx(rx, user.name)}>🖨️ Print</button>{rx.pdfFileId && <button className="outline" onClick={() => downloadFile(token, rx.pdfFileId, "signed-prescription.pdf").catch((e) => setMessage(e.message))}>⬇️ Download signed PDF</button>}</div>
      {check[rx._id] && <p className="notice">{check[rx._id]}</p>}
    </div>)}</article></div>;
}

function MedicineSearch({api,setMessage}:{api:Api;setMessage:(s:string)=>void}){
 const [q,setQ]=useState("");const [items,setItems]=useState<any[]>([]);const [busy,setBusy]=useState(false);
 async function search(e:any){e?.preventDefault?.();if(q.trim().length<2){setItems([]);return;}setBusy(true);try{const d=await api(`/medicines?q=${encodeURIComponent(q.trim())}`);setItems(d.medicines||[]);}catch(x:any){setMessage(x.message);}finally{setBusy(false);}}
 return <div className="grid"><article className="full"><h3>Bangladesh medicine catalogue</h3><p className="muted">Search verified catalogue entries by brand or generic name. This is reference information only, not a recommendation to start, stop or change medicine.</p><form className="row" onSubmit={search}><input value={q} onChange={e=>setQ(e.target.value)} placeholder="Search medicine brand or generic"/><button className="primary" disabled={busy||q.trim().length<2}>{busy?"Searching…":"Search"}</button></form>{items.length===0&&!busy&&<p className="muted">No verified matches yet. The catalogue may be incomplete; ask a licensed doctor or pharmacist.</p>}{items.map((m:any)=><div className="item" key={m._id}><b>{m.brand}</b> — {m.generic}<p className="muted">{m.strength||"Strength not listed"} · {m.form||"Form not listed"} · {m.manufacturer||"Manufacturer not listed"}</p><MedicineDetails m={m} /><p className="muted">Verified catalogue entry · Confirm current registration and product details with a pharmacist.</p></div>)}</article></div>;
}

function Profile({ api, setMessage }: { api: Api; setMessage: (s: string) => void }) {
  const [f, setF] = useState<any>({ name: "", phone: "", dateOfBirth: "", gender: "", bloodGroup: "", address: "", allergies: "", currentMedicines: "", medicalHistory: "", ecName: "", ecPhone: "", ecRel: "", notifyEmailOnMessage: true });
  useEffect(() => {
    api("/profile").then(({ user: u }) => setF({ name: u.name || "", phone: u.phone || "", dateOfBirth: u.dateOfBirth ? String(u.dateOfBirth).slice(0, 10) : "", gender: u.gender || "", bloodGroup: u.bloodGroup || "", address: u.address || "", allergies: (u.allergies || []).join(", "), currentMedicines: (u.currentMedicines || []).join(", "), medicalHistory: u.medicalHistory || "", ecName: u.emergencyContact?.name || "", ecPhone: u.emergencyContact?.phone || "", ecRel: u.emergencyContact?.relationship || "", notifyEmailOnMessage: u.notifyEmailOnMessage !== false })).catch((e) => setMessage(e.message));
  }, []);
  const set = (k: string, v: string) => setF({ ...f, [k]: v });
  async function save(e: any) {
    e.preventDefault();
    try {
      await api("/profile", { method: "PATCH", body: json({ name: f.name, phone: f.phone, dateOfBirth: f.dateOfBirth, gender: f.gender, bloodGroup: f.bloodGroup, address: f.address, allergies: listFromText(f.allergies), currentMedicines: listFromText(f.currentMedicines), medicalHistory: f.medicalHistory, emergencyContact: { name: f.ecName, phone: f.ecPhone, relationship: f.ecRel }, notifyEmailOnMessage: !!f.notifyEmailOnMessage }) });
      setMessage("Health profile saved. Your assigned doctor can see it.");
    } catch (x: any) { setMessage(x.message); }
  }
  return <div className="grid"><article className="full"><h3>Health profile</h3><p className="muted">Doctors assigned to your appointments can see this to treat you safely. Keep allergies and current medicines up to date.</p>
    <form onSubmit={save} className="cols">
      <label>Full name<input value={f.name} onChange={(e) => set("name", e.target.value)} required minLength={2} /></label>
      <label>Phone<input value={f.phone} onChange={(e) => set("phone", e.target.value)} /></label>
      <label>Date of birth<input type="date" value={f.dateOfBirth} onChange={(e) => set("dateOfBirth", e.target.value)} /></label>
      <label>Gender<select value={f.gender} onChange={(e) => set("gender", e.target.value)}><option value="">Prefer not to say</option><option>Female</option><option>Male</option><option>Other</option></select></label>
      <label>Blood group<select value={f.bloodGroup} onChange={(e) => set("bloodGroup", e.target.value)}><option value="">Unknown</option>{["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"].map((b) => <option key={b}>{b}</option>)}</select></label>
      <label>Address<input value={f.address} onChange={(e) => set("address", e.target.value)} /></label>
      <label className="full">Allergies (comma separated)<input value={f.allergies} onChange={(e) => set("allergies", e.target.value)} placeholder="e.g. Penicillin, Peanuts" /></label>
      <label className="full">Current medicines (comma separated)<input value={f.currentMedicines} onChange={(e) => set("currentMedicines", e.target.value)} /></label>
      <label className="full">Medical history<textarea value={f.medicalHistory} onChange={(e) => set("medicalHistory", e.target.value)} /></label>
      <label className="full" style={{ display: "flex", alignItems: "center", gap: 8 }}><input type="checkbox" checked={!!f.notifyEmailOnMessage} onChange={(e) => setF({ ...f, notifyEmailOnMessage: e.target.checked })} /> Email me when a new chat message arrives</label>
      <label>Emergency contact name<input value={f.ecName} onChange={(e) => set("ecName", e.target.value)} /></label>
      <label>Emergency contact phone<input value={f.ecPhone} onChange={(e) => set("ecPhone", e.target.value)} /></label>
      <label>Relationship<input value={f.ecRel} onChange={(e) => set("ecRel", e.target.value)} /></label>
      <button className="primary full">Save profile</button></form></article></div>;
}

function MedicineDetails({ m }: { m: any }) {
  const rows: [string, string, string][] = [["🩺", "What it is used for", m.uses], ["👍", "Benefits (good side)", m.benefits], ["⚠️", "Side effects (bad side)", m.sideEffects], ["🚫", "Precautions", m.precautions], ["🔁", "Interactions", m.interactions], ["⏰", "When to take", m.whenToTake]];
  const has = rows.filter((r) => r[2]);
  if (!has.length) return <p className="muted">Detailed information has not been added for this medicine yet.</p>;
  return <div className="meddetails">{has.map(([ic, t, v]) => <p key={t}><b>{ic} {t}:</b> {v}</p>)}</div>;
}
