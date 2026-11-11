// © 2026 MD Gausur Rahman Nabil. All rights reserved. MedAI Hospital.
// Do not silently fall back to localhost in production: on a deployed website this
// points to the visitor's own device and causes registration/login requests to fail.
// The Android app is built from a static bundle, so a missing VITE_API_URL at
// build time used to leave every screen unusable ("API URL is not configured").
// Inside the Capacitor shell we therefore fall back to the production API.
const NATIVE_API_FALLBACK = "https://medaionline-1.onrender.com";
function isNativeShell(): boolean {
  try {
    const cap = (window as any).Capacitor;
    if (cap && typeof cap.isNativePlatform === "function" && cap.isNativePlatform()) return true;
    // Capacitor serves the bundle from https://localhost inside the app.
    return location.hostname === "localhost" && location.protocol === "https:";
  } catch { return false; }
}
const NATIVE_OR_PROD = "https://medaionline-1.onrender.com";

function isLocalDev(): boolean {
  try {
    const h = (window as any).location?.hostname || "";
    return h === "localhost" || h === "127.0.0.1" || h === "0.0.0.0";
  } catch { return false; }
}

/**
 * Base URL of the API.
 *
 * - `VITE_API_URL` always wins (set it in Render → Environment, then rebuild).
 * - A build that forgot the variable used to break every screen with a misleading
 *   "Network error", so a deployed build now falls back to production instead.
 * - Plain local development keeps requiring the variable, so dev never silently
 *   talks to the live server.
 */
export const API: string = (() => {
  const fromEnv = String((import.meta.env as any).VITE_API_URL || "").trim().replace(/\/$/, "");
  if (fromEnv) return fromEnv;
  if (isNativeShell()) return NATIVE_OR_PROD;
  if (isLocalDev()) return "";
  return NATIVE_OR_PROD;
})();

export const API_CONFIG_ERROR = "This build has no API address. Rebuild the site with VITE_API_URL set to the API URL.";

/** Called before any request so a configuration problem is reported as itself. */
function apiBase(): string {
  if (!API) throw new Error(API_CONFIG_ERROR);
  return API;
}

/** Health check used by the on-screen diagnostics. */
export async function pingServer(): Promise<{ ok: boolean; ms: number; detail: string }> {
  const started = Date.now();
  if (!API) return { ok: false, ms: 0, detail: API_CONFIG_ERROR };
  try {
    const r = await fetch(API + "/api/health", { cache: "no-store" });
    const body = await r.text();
    let service = "";
    try { service = JSON.parse(body)?.service || ""; } catch { /* not json */ }
    return { ok: r.ok, ms: Date.now() - started, detail: r.ok ? (service || "API responded") : "Server answered " + r.status };
  } catch (e: any) {
    return { ok: false, ms: Date.now() - started, detail: "Cannot reach " + API.replace(/^https?:\/\//, "") + " — " + (e?.message || "request blocked") };
  }
}
export type Api = (path: string, opts?: any) => Promise<any>;

export function makeApi(token: string): Api {
  return async (path, opts = {}) => {
    const base = apiBase();                 // config errors must not look like network errors
    const init = {
      ...opts,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(opts.headers || {}) },
    };
    const method = String((opts as any).method || "GET").toUpperCase();
    let r: Response | null = null;
    let lastError: any = null;
    // A sleeping Render instance can fail the first call; GETs are safe to retry once.
    for (let attempt = 0; attempt < (method === "GET" ? 2 : 1); attempt++) {
      try {
        r = await fetch(base + "/api" + path, init);
        break;
      } catch (e) {
        lastError = e;
        if (attempt === 0 && method === "GET") await new Promise((res) => setTimeout(res, 1200));
      }
    }
    if (!r) {
      const err: any = new Error("Cannot reach the MedAI server (" + base.replace(/^https?:\/\//, "") + "). If the site has been idle it can take up to a minute to wake up — please try again.");
      err.network = true; err.cause = lastError;
      throw err;
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
    r = await fetch(apiBase() + "/api" + path, { method: "POST", headers: token ? { Authorization: `Bearer ${token}` } : {}, body: form });
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
  const r = await fetch(`${apiBase()}/api/files/${id}/download`, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error("Could not download the file");
  const blob = await r.blob();
  // Android app (APK): WebView cannot save blob downloads, so hand the file to the native side.
  const nat = (window as any).MedAIAndroid;
  if (nat && typeof nat.saveBase64 === "function") {
    const b64: string = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(",")[1] || ""); fr.onerror = () => rej(new Error("Could not read the file")); fr.readAsDataURL(blob); });
    nat.saveBase64(name || "file", blob.type || "application/octet-stream", b64);
    return;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export const fmtDate = (v?: string) => (v ? new Date(v).toLocaleString() : "—");
export const fmtDay = (v?: string) => (v ? new Date(v).toLocaleDateString() : "—");
export const fmtSize = (n?: number) => (n ? (n > 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB") : "");
/** Status / enum → readable Title Case (fixes "ai processing", "pending doctor review"). */
export const label = (s?: string) => {
  const raw = String(s || "").replace(/_/g, " ").trim();
  if (!raw) return "";
  const special: Record<string, string> = {
    "ai processing": "AI processing",
    "ai analysis completed": "AI analysis completed",
    "pending doctor review": "Pending doctor review",
    "under review": "Under review",
    "changes requested": "Changes requested",
    "pending email": "Pending email",
    "pending verification": "Pending verification",
    "pending approval": "Pending approval",
    "in progress": "In progress",
    "waiting room": "Waiting room",
    "follow up required": "Follow-up required",
    "awaiting records": "Awaiting records",
    "awaiting tests": "Awaiting tests",
    "in person": "In person",
    "doctor approved": "Doctor approved",
    "not submitted": "Not submitted",
    "not analyzed": "Not analyzed",
  };
  const key = raw.toLowerCase();
  if (special[key]) return special[key];
  return raw.replace(/\b[a-z]/g, (c) => c.toUpperCase()).replace(/\bAi\b/g, "AI").replace(/\bPdf\b/g, "PDF").replace(/\bId\b/g, "ID");
};
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

// Private image/file as a temporary blob URL (for inline previews). Caller must URL.revokeObjectURL it.
export async function fetchFileUrl(token: string, id: string): Promise<string> {
  const r = await fetch(`${apiBase()}/api/files/${id}/download`, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error("Could not load the file");
  return URL.createObjectURL(await r.blob());
}
