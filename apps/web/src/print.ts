const esc = (s: any) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" } as any)[c]);

// Opens a printable prescription. Every value is HTML-escaped.
export function printRx(rx: any, patientName?: string) {
  const w = window.open("", "_blank");
  if (!w) { alert("Allow pop-ups to print the prescription."); return; }
  const rows = (rx.items || []).map((i: any, n: number) => `<tr><td>${n + 1}</td><td>${esc(i.brand ? i.brand + " — " : "")}${esc(i.generic)} ${esc(i.strength)} ${esc(i.form)}</td><td>${esc(i.dose)}</td><td>${esc(i.frequency)}</td><td>${esc(i.duration)}</td><td>${esc(i.instructions)}</td></tr>`).join("");
  w.document.write(`<!doctype html><title>Prescription</title><style>body{font-family:Arial,sans-serif;max-width:800px;margin:24px auto;color:#111}table{width:100%;border-collapse:collapse}td,th{border:1px solid #999;padding:6px;text-align:left}small{color:#444;word-break:break-all}.brand{display:flex;align-items:center;gap:12px;border-bottom:3px solid #087fbd;padding-bottom:10px;margin-bottom:14px}.brand b{font-size:24px;color:#102e49}.brand span{font-size:16px;color:#087fbd}.brand small{display:block;color:#60788d}th{background:#087fbd;color:#fff}h2{color:#102e49}</style>
<div class="brand"><svg width="46" height="42" viewBox="0 0 126 112"><rect x="42" width="42" height="110" rx="12" fill="#087fbd"/><rect x="8" y="34" width="110" height="42" rx="12" fill="#087fbd"/><path d="M63 42C36 15 10 54 63 96 116 54 90 15 63 42Z" fill="#20a58a" stroke="#fff" stroke-width="4"/><path d="M27 58h22l8-12 12 25 9-13h20" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round"/></svg><div><b>MedAI</b> <span>Hospital</span><small>Your Health, Our Priority</small></div></div><h2>Prescription</h2>
<p>Patient: <b>${esc(patientName || rx.patientId?.name)}</b><br>Doctor: <b>${esc(rx.doctorId?.name || rx.signerName)}</b> · BMDC: ${esc(rx.signerBmdc || rx.doctorId?.doctorProfile?.bmdcNumber)}<br>Status: ${esc(rx.status)} · Date: ${esc(rx.signedAt ? new Date(rx.signedAt).toLocaleString() : "")}</p>
<table><tr><th>#</th><th>Medicine</th><th>Dose</th><th>Frequency</th><th>Duration</th><th>Instructions</th></tr>${rows}</table>
<p>${esc(rx.notes)}</p>
<p><small>${rx.status === "voided" ? "VOIDED — DO NOT USE. " : ""}In-app signature (${esc(rx.signatureAlgorithm)}). Content hash: ${esc(rx.signatureHash)}. This is not a government-issued qualified digital certificate.</small></p>
<script>window.onload=function(){window.print()}</script>`);
  w.document.close();
}
