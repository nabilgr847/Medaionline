// © 2026 MD Gausur Rahman Nabil. All rights reserved. MedAI Hospital.
// Do not silently fall back to localhost in production: on a deployed website this
// points to the visitor's own device and causes registration/login requests to fail.
export const API: string = String(import.meta.env.VITE_API_URL || "").trim().replace(/\/$/, "");
function requireApiUrl() {
  if (!API) throw new Error("The MedAI API URL is not configured. Set VITE_API_URL to your deployed API URL in the web service environment, then rebuild the frontend.");
  return API;
}
export type Api = (path: string, opts?: any) => Promise<any>;

export function makeApi(token: string): Api {
  return async (path, opts = {}) => {
    let r: Response;
    try {
      r = await fetch(requireApiUrl() + "/api" + path, {
        ...opts,
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(opts.headers || {}) },
      });
    } catch {
      throw new Error("Network error. Check your connection and try again.");
    }
    const text = await r.text();
    let d: any = {};
    try { d = text ? JSON.parse(text) : {}; } catch { d = {}; }
    if (!r.ok) {
      const baseMsg = d.error || d.message || (r.status === 429 ? "Too many requests. Please wait a minute and try again." : r.status === 401 ? "Session expired. Please sign in again." : r.status === 404 ? "Not found. The server may be out of date." : r.status === 413 ? "File is too large." : r.status === 502 || r.status === 504 ? "Server timed out while reading the report. Try a clearer, smaller photo (under 2 MB)." : r.status === 503 ? "AI service is temporarily unavailable. Try again in a minute." : r.status >= 500 ? "Server error. Please try again." : "Request failed");
      const msg = r.status >= 500 && d.requestId ? `${baseMsg} (Reference: ${d.requestId})` : baseMsg;
      const e: any = new Error(msg); e.data = d; e.status = r.status; throw e;
    }
    return d;
  };
}
export const json = (body: any) => JSON.stringify(body);

// Multipart upload (browser sets the boundary header itself).
export async function postForm(path: string, form: FormData, token = ""): Promise<any> {
  let r: Response;
  try {
    r = await fetch(requireApiUrl() + "/api" + path, { method: "POST", headers: token ? { Authorization: `Bearer ${token}` } : {}, body: form });
  } catch {
    throw new Error("Network error while uploading. Check your connection.");
  }
  const text = await r.text();
  let d: any = {};
  try { d = text ? JSON.parse(text) : {}; } catch { d = {}; }
  if (!r.ok) {
    throw new Error(d.error || d.message || (r.status === 429 ? "Too many requests. Please wait a minute and try again." : r.status === 413 ? "File is too large (max about 12 MB)." : r.status >= 500 ? "Upload server error. Try a smaller JPG photo." : "Upload failed"));
  }
  return d;
}

// Private files need the Authorization header, so fetch as a blob and save it.
export async function downloadFile(token: string, id: string, name: string): Promise<void> {
  const r = await fetch(`${requireApiUrl()}/api/files/${id}/download`, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error("Could not download the file");
  const url = URL.createObjectURL(await r.blob());
  const a = document.createElement("a");
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export const fmtDate = (v?: string) => (v ? new Date(v).toLocaleString() : "—");
export const fmtDay = (v?: string) => (v ? new Date(v).toLocaleDateString() : "—");
export const fmtSize = (n?: number) => (n ? (n > 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB") : "");
export const label = (s?: string) => (s || "").replace(/_/g, " ");
export const listFromText = (t: string) => t.split(",").map((x) => x.trim()).filter(Boolean);

export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = []; let row: string[] = []; let cur = ""; let q = false;
  text = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === ",") { row.push(cur); cur = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cur); cur = ""; rows.push(row); row = []; }
    else cur += c;
  }
  if (cur !== "" || row.length) { row.push(cur); rows.push(row); }
  const head = (rows.shift() || []).map((x) => x.trim());
  return rows.filter((r) => r.some((x) => x.trim())).map((r) => Object.fromEntries(head.map((k, i) => [k, (r[i] || "").trim()])));
}
