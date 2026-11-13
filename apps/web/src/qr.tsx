// © 2026 MD Gausur Rahman Nabil. All rights reserved. MedAI Hospital.
// QR code image (generated locally), secret-QR button and scan/open box for doctor + admin.
import { useCallback, useEffect, useState } from "react";
import QRCode from "qrcode";
import { Api, json, downloadFile, label } from "./api";
import QrScanner, { parseMedaiCode } from "./QrScanner";

export function QrImg({ text, size = 160 }: { text: string; size?: number }) {
  const [src, setSrc] = useState("");
  useEffect(() => {
    let ok = true;
    QRCode.toDataURL(text, { width: size * 2, margin: 1, errorCorrectionLevel: "M" }).then((u: string) => { if (ok) setSrc(u); }).catch(() => { if (ok) setSrc(""); });
    return () => { ok = false; };
  }, [text, size]);
  return src ? <img className="secret-qr-img" alt="QR code" src={src} width={size} height={size} /> : <span className="muted">QR…</span>;
}

/** Button that shows the secret code + QR of a report or prescription (doctor/admin only). */
export function SecretQr({ api, kind, id }: { api: Api; kind: "report" | "rx"; id: string }) {
  const [d, setD] = useState<any>(null); const [open, setOpen] = useState(false); const [err, setErr] = useState("");
  async function toggle() {
    if (open) { setOpen(false); return; }
    setOpen(true);
    if (d) return;
    try { setD(await api(`/${kind === "rx" ? "prescriptions" : "reports"}/${id}/secret-code`)); setErr(""); } catch (e: any) { setErr(e.message || "Could not load QR"); }
  }
  return <>
    <button className="outline" type="button" onClick={toggle} title="Only doctor/admin can see this QR">{open ? "Hide QR" : "🔑 QR / Secret code"}</button>
    {open && <div className="secret-code-box secret-panel">
      {err ? <span className="qr-err">{err}</span> : d ? <>
        <div><span className="code">{d.code}</span><small>Patient cannot see this. Scan the QR or type the code to open the file.</small>
          <button className="outline" type="button" style={{ marginTop: 6 }} onClick={() => navigator.clipboard?.writeText(d.code)}>Copy code</button></div>
        <QrImg text={d.qrPayload} />
      </> : <span className="muted">Loading…</span>}
    </div>}
  </>;
}

/** Type a secret code or scan a QR with the camera; opens the report/prescription files. */
export function QrScanBox({ api, token, setMessage }: { api: Api; token: string; setMessage: (s: string) => void }) {
  const [codeIn, setCodeIn] = useState(""); const [res, setRes] = useState<any>(null); const [scan, setScan] = useState(false);
  const resolve = useCallback(async (raw: string) => {
    const code = parseMedaiCode(raw) || String(raw || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (code.length < 6) { setMessage("Invalid code"); return; }
    setCodeIn(code); setScan(false);
    try { const d = await api("/access-by-code", { method: "POST", body: json({ code }) }); setRes(d); setMessage(d.type === "report" ? "Report opened by QR/code" : "Prescription opened by QR/code"); }
    catch (e: any) { setMessage(e.message); setRes(null); }
  }, [api, setMessage]);
  const dl = (id: string, name: string) => downloadFile(token, id, name).catch((e) => setMessage(e.message));
  return <div style={{ marginBottom: 12 }}>
    <div className="secret-code-box">
      <div><span className="code">Open by QR / secret code</span><small>Scan the QR with the camera, or type the code.</small></div>
      <div className="row">
        <input value={codeIn} onChange={(e) => setCodeIn(e.target.value.toUpperCase())} placeholder="XXXXXXXXXX" style={{ letterSpacing: ".08em", fontFamily: "monospace" }} />
        <button className="primary" type="button" onClick={() => resolve(codeIn)}>Open</button>
        <button className="outline" type="button" onClick={() => setScan(true)}>📷 Scan QR</button>
      </div>
    </div>
    {scan && <QrScanner onCode={resolve} onClose={() => setScan(false)} />}
    {res && <div className="item"><b>{res.type === "report" ? "Report" : "Prescription"}</b> · {res.patient?.name || "—"} · {label(res.status)}
      <div className="row">
        {res.files?.original && <button className="outline" onClick={() => dl(res.files.original.id, res.files.original.name || "report")}>Original</button>}
        {res.files?.aiPdf && <button className="outline" onClick={() => dl(res.files.aiPdf, "ai-analysis.pdf")}>AI PDF</button>}
        {res.files?.finalPdf && <button className="outline" onClick={() => dl(res.files.finalPdf, "approved-report.pdf")}>Approved PDF</button>}
        {res.pdf && <button className="outline" onClick={() => dl(res.pdf.id, "prescription.pdf")}>Prescription PDF</button>}
      </div></div>}
  </div>;
}
