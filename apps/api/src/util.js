// © 2026 MD Gausur Rahman Nabil. All rights reserved. MedAI Hospital.
import fs from "fs/promises";

// Escape user input before it is used inside a RegExp (prevents regex injection / ReDoS).
export const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Detect the real file type from its first bytes. Returns a mime type or null.
export function detectMimeFromBytes(b) {
  if (b.length >= 4 && b.slice(0, 4).toString("latin1") === "%PDF") return "application/pdf";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 8 && b[0] === 0x89 && b.slice(1, 4).toString("latin1") === "PNG" && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return "image/png";
  if (b.length >= 12 && b.slice(0, 4).toString("latin1") === "RIFF" && b.slice(8, 12).toString("latin1") === "WEBP") return "image/webp";
  if (b.length >= 12 && b.slice(0, 4).toString("latin1") === "RIFF" && b.slice(8, 12).toString("latin1") === "WAVE") return "audio/wav";
  if (b.length >= 4 && b.slice(0, 4).toString("latin1") === "OggS") return "audio/ogg";
  if (b.length >= 3 && b.slice(0, 3).toString("latin1") === "ID3") return "audio/mpeg";
  if (b.length >= 2 && b[0] === 0xff && (b[1] & 0xe0) === 0xe0) return "audio/mpeg";
  if (b.length >= 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return "video/webm";
  if (b.length >= 12 && b.slice(4, 8).toString("latin1") === "ftyp") return "video/mp4";
  return null;
}

export async function detectMime(filePath) {
  const handle = await fs.open(filePath, "r");
  try {
    const buf = Buffer.alloc(16);
    const { bytesRead } = await handle.read(buf, 0, 16, 0);
    return detectMimeFromBytes(buf.subarray(0, bytesRead));
  } finally { await handle.close(); }
}

// ---- Typo-tolerant search (works for English, Banglish and Bangla text) ----
export const normText = v => String(v ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^\p{L}\p{N}@.+_-]+/gu, " ").trim();
// Damerau-Levenshtein with early exit; returns 99 when the distance is above `max`.
export function editDistance(a, b, max = 2) {
  if (Math.abs(a.length - b.length) > max) return 99;
  const A = Array.from(a), B = Array.from(b);
  let prev2 = null, prev = Array.from({ length: B.length + 1 }, (_, i) => i);
  for (let i = 1; i <= A.length; i++) {
    const cur = [i]; let rowMin = i;
    for (let j = 1; j <= B.length; j++) {
      let v = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + (A[i - 1] === B[j - 1] ? 0 : 1));
      if (prev2 && i > 1 && j > 1 && A[i - 1] === B[j - 2] && A[i - 2] === B[j - 1]) v = Math.min(v, prev2[j - 2] + 1); // swapped letters
      cur[j] = v; rowMin = Math.min(rowMin, v);
    }
    if (rowMin > max) return 99;
    prev2 = prev; prev = cur;
  }
  return prev[B.length] <= max ? prev[B.length] : 99;
}
// Rough sound-alike key for Latin spellings: gausur / gausar / gosur -> same key.
const phon = s => { const t = s.replace(/ph/g, "f").replace(/ck/g, "k").replace(/[cq]/g, "k").replace(/z/g, "j").replace(/w/g, "v").replace(/(.)\1+/g, "$1"); return /^[a-z]+$/.test(t) ? t[0] + t.slice(1).replace(/[aeiouyh]/g, "") : ""; };
/**
 * fuzzyScore("gosur rahmn", [name, email, ...]) -> 0 (no match) .. 100 (exact).
 * Every word typed must match some word of some field (substring, prefix, 1-2 letter typo, or sound-alike).
 */
export function fuzzyScore(query, fields) {
  const qs = normText(query).split(/\s+/).filter(Boolean); if (!qs.length) return 1;
  const fs = (fields || []).map(normText).filter(Boolean); if (!fs.length) return 0;
  const toks = fs.map(f => f.split(/\s+/));
  let worst = 100;
  for (const q of qs) {
    let best = 0; const lim = q.length <= 2 ? 0 : q.length <= 4 ? 1 : 2; const pk = q.length >= 3 ? phon(q) : "";
    for (let i = 0; i < fs.length && best < 100; i++) {
      const f = fs[i];
      if (f === q) best = 100; else if (f.includes(q)) best = Math.max(best, 92);
      if (q.length >= 5 && f.length <= 14 && f.length >= 5) { const d = editDistance(f, q, 2); if (d < 99) best = Math.max(best, 78 - d * 8); } // codes / ids typed with 1-2 wrong characters
      for (const t of toks[i]) {
        if (t.startsWith(q)) { best = Math.max(best, 88); continue; }
        if (lim) {
          const d = editDistance(t, q, lim); if (d < 99) best = Math.max(best, 76 - d * 8);
          else if (t.length > q.length) { const d2 = editDistance(t.slice(0, q.length), q, lim); if (d2 < 99) best = Math.max(best, 68 - d2 * 4); }
        }
        if (pk && best < 62 && pk.length >= 2 && phon(t) === pk) best = Math.max(best, 62);
      }
    }
    worst = Math.min(worst, best); if (worst < 60) return 0;
  }
  return worst;
}
