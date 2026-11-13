// © 2026 MD Gausur Rahman Nabil. All rights reserved. MedAI Hospital.
import { API } from "./api";
const esc = (s: any) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" } as any)[c]);

const clinicalHtml = (c: any) => c ? ([["Chief complaints", "complaints"], ["Past history", "history"], ["Past tests / reports", "pastTests"], ["Examination", "examination"], ["Vitals", "vitals"], ["Diagnosis", "diagnosis"]] as [string, string][]).filter(([, k]) => c[k]).map(([t, k]) => `<p style="margin:4px 0"><b>${t}:</b> <span style="white-space:pre-wrap">${esc(c[k])}</span></p>`).join("") : "";
// Opens a printable prescription. Every value is HTML-escaped.
async function sigDataUrl(rx: any, token?: string): Promise<string> {
  if (!token || !rx?._id || rx.status === "draft") return "";
  try {
    const r = await fetch(`${API}/api/prescriptions/${rx._id}/signature-image`, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) return "";
    const blob = await r.blob();
    return await new Promise<string>((res) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result)); fr.onerror = () => res(""); fr.readAsDataURL(blob); });
  } catch { return ""; }
}
export async function printRx(rx: any, patientName?: string, token?: string) {
  const nat0 = (window as any).MedAIAndroid;
  const w0 = nat0 && typeof nat0.printHtml === "function" ? null : window.open("", "_blank");
  const sig = await sigDataUrl(rx, token);
  const rows = (rx.items || []).map((i: any, n: number) => `<tr><td>${n + 1}</td><td>${esc(i.brand ? i.brand + " — " : "")}${esc(i.generic)} ${esc(i.strength)} ${esc(i.form)}</td><td>${esc(i.dose)}</td><td>${esc(i.frequency)}</td><td>${esc(i.duration)}</td><td>${esc(i.instructions)}</td></tr>`).join("");
  const html = `<!doctype html><title>Prescription</title><style>body{font-family:Arial,sans-serif;max-width:800px;margin:24px auto;color:#111}table{width:100%;border-collapse:collapse}td,th{border:1px solid #999;padding:6px;text-align:left}small{color:#444;word-break:break-all}.brand{display:flex;align-items:center;gap:12px;border-bottom:3px solid #087fbd;padding-bottom:10px;margin-bottom:14px}.brand b{font-size:24px;color:#102e49}.brand span{font-size:16px;color:#087fbd}.brand small{display:block;color:#60788d}th{background:#087fbd;color:#fff}h2{color:#102e49}</style>
<div class="brand"><svg width="46" height="42" viewBox="0 0 126 112"><rect x="42" width="42" height="110" rx="12" fill="#087fbd"/><rect x="8" y="34" width="110" height="42" rx="12" fill="#087fbd"/><path d="M63 42C36 15 10 54 63 96 116 54 90 15 63 42Z" fill="#20a58a" stroke="#fff" stroke-width="4"/><path d="M27 58h22l8-12 12 25 9-13h20" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round"/></svg><div><b>MedAI</b> <span>Hospital</span><small>Your Health, Our Priority</small></div></div><h2>Prescription</h2>
<p>Patient: <b>${esc(patientName || rx.patientId?.name)}</b><br>Doctor: <b>${esc(rx.doctorId?.name || rx.signerName)}</b> · BMDC: ${esc(rx.signerBmdc || rx.doctorId?.doctorProfile?.bmdcNumber)}<br>Status: ${esc(rx.status)} · Date: ${esc(rx.signedAt ? new Date(rx.signedAt).toLocaleString() : "")}</p>
${clinicalHtml(rx.clinical)}<div style="font:italic 700 30px Georgia,serif;color:#087fbd;margin:10px 0 4px">Rx</div>
<table><tr><th>#</th><th>Medicine</th><th>Dose</th><th>Frequency</th><th>Duration</th><th>Instructions</th></tr>${rows}</table>
${rx.clinical?.advice ? `<h3>Advice</h3><p style="white-space:pre-wrap">${esc(rx.clinical.advice)}</p>` : ""}${rx.clinical?.followUp ? `<h3>Follow-up</h3><p style="white-space:pre-wrap">${esc(rx.clinical.followUp)}</p>` : ""}${rx.advisedTests ? `<h3>Advised tests</h3><p style="white-space:pre-wrap">${esc(rx.advisedTests)}</p>` : ""}<p>${esc(rx.notes)}</p>
${sig ? `<div style="margin-top:18px"><img src="${sig}" style="max-height:80px;max-width:220px"><div style="border-top:1px solid #777;width:220px;font-size:12px;padding-top:2px">Doctor signature — ${esc(rx.signerName || rx.doctorId?.name)}${rx.signedAt ? ", " + esc(new Date(rx.signedAt).toLocaleString()) : ""}</div></div>` : ""}
<p><small>${rx.status === "voided" ? "VOIDED — DO NOT USE. " : ""}In-app signature (${esc(rx.signatureAlgorithm)}). Content hash: ${esc(rx.signatureHash)}. This is not a government-issued qualified digital certificate.</small></p>
`;
  // Android app (APK): print/save-as-PDF through the native print dialog.
  const nat = (window as any).MedAIAndroid;
  if (nat && typeof nat.printHtml === "function") { nat.printHtml(html, "MedAI Prescription"); return; }
  const w = w0;
  if (!w) { alert("Allow pop-ups to print the prescription."); return; }
  w.document.write(html + `<script>window.onload=function(){window.print()}</script>`);
  w.document.close();
}
