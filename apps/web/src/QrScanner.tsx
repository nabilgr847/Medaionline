// © 2026 MD Gausur Rahman Nabil. All rights reserved. MedAI Hospital.
// Camera QR scanner for secret access codes (doctor/admin only).
import { useEffect, useRef, useState } from "react";
import jsQR from "jsqr";

type Props = {
  onCode: (code: string) => void;
  onClose: () => void;
};

/** Extract MedAI secret code from raw QR text. */
export function parseMedaiCode(raw: string): string | null {
  const t = String(raw || "").trim();
  const m = t.match(/medai:(?:report|rx|file):([A-Z0-9]{6,16})/i);
  if (m) return m[1].toUpperCase();
  const plain = t.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (plain.length >= 6 && plain.length <= 16) return plain;
  return null;
}

export default function QrScanner({ onCode, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [err, setErr] = useState("");
  const [hint, setHint] = useState("Point the camera at the QR code…");
  const running = useRef(true);
  const onCodeRef = useRef(onCode);
  onCodeRef.current = onCode;

  useEffect(() => {
    running.current = true;
    let detector: any = null;
    let raf = 0;
    let timer = 0;

    async function start() {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          setErr("This browser does not support camera access. Type the code instead.");
          return;
        }
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } }
        });
        if (!running.current) { stream.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = stream;
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();

        const BD = (window as any).BarcodeDetector;
        if (BD) {
          try {
            detector = new BD({ formats: ["qr_code"] });
          } catch {
            detector = null;
          }
        }
        if (!detector) {
          setHint("Point the camera at the QR code…");
          const canvas = document.createElement("canvas");
          const ctx = canvas.getContext("2d", { willReadFrequently: true } as any);
          const jsTick = () => {
            if (!running.current) return;
            if (ctx && video.readyState >= 2 && video.videoWidth) {
              const w = Math.min(video.videoWidth, 640), h = Math.round(video.videoHeight * w / video.videoWidth);
              canvas.width = w; canvas.height = h; ctx.drawImage(video, 0, 0, w, h);
              const img = ctx.getImageData(0, 0, w, h);
              const res = jsQR(img.data, w, h);
              const code = res?.data ? parseMedaiCode(res.data) : null;
              if (code) { running.current = false; setHint("Code found!"); onCodeRef.current(code); return; }
            }
            timer = window.setTimeout(jsTick, 200);
          };
          jsTick();
          return;
        }

        const tick = async () => {
          if (!running.current || !video || video.readyState < 2) {
            raf = requestAnimationFrame(tick);
            return;
          }
          try {
            const codes = await detector.detect(video);
            if (codes && codes.length) {
              const raw = codes[0].rawValue || "";
              const code = parseMedaiCode(raw);
              if (code) {
                setHint("Code found!");
                running.current = false;
                onCodeRef.current(code);
                return;
              }
            }
          } catch { /* keep scanning */ }
          raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      } catch (e: any) {
        const msg = e?.name === "NotAllowedError"
          ? "Camera permission denied. Allow camera and try again, or type the code."
          : (e?.message || "Could not open camera");
        setErr(msg);
      }
    }
    start();

    return () => {
      running.current = false;
      cancelAnimationFrame(raf);
      clearTimeout(timer);
      streamRef.current?.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    };
  }, []);

  function scanPhoto(e: any) {
    const f: File | undefined = e.target.files?.[0]; if (!f) return;
    const img = new Image(); const url = URL.createObjectURL(f);
    img.onload = () => {
      const c = document.createElement("canvas"); const w = Math.min(img.width, 1200), h = Math.round(img.height * w / img.width);
      c.width = w; c.height = h; const x = c.getContext("2d"); if (!x) return; x.drawImage(img, 0, 0, w, h);
      const r = jsQR(x.getImageData(0, 0, w, h).data, w, h); URL.revokeObjectURL(url);
      const code = r?.data ? parseMedaiCode(r.data) : null;
      if (code) { running.current = false; onCodeRef.current(code); } else setHint("No QR found in that photo. Try a clearer one.");
    };
    img.src = url; e.target.value = "";
  }

  return (
    <div className="qr-overlay" role="dialog" aria-modal="true" aria-label="QR scanner">
      <div className="qr-panel">
        <div className="qr-head">
          <b>Scan secret QR</b>
          <button type="button" className="outline" onClick={onClose}>Close</button>
        </div>
        {err ? (
          <p className="qr-err">{err}</p>
        ) : (
          <>
            <div className="qr-view">
              <video ref={videoRef} playsInline muted autoPlay />
              <div className="qr-frame" aria-hidden />
            </div>
            <p className="qr-hint">{hint}</p>
          </>
        )}
        <label className="outline" style={{ display: "block", textAlign: "center", marginTop: 8, padding: "8px", cursor: "pointer" }}>🖼️ Scan from a photo / screenshot<input type="file" accept="image/*" hidden onChange={scanPhoto} /></label>
        <p className="muted" style={{ fontSize: ".85rem", margin: "8px 0 0" }}>
          Only doctor/admin codes work. Patient never sees this QR.
        </p>
      </div>
    </div>
  );
}
