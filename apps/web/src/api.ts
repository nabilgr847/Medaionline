// © 2026 MD Gausur Rahman Nabil. All rights reserved. MedAI Hospital.
// Do not silently fall back to localhost in production: on a deployed website this
// points to the visitor's own device and causes registration/login requests to fail.
// The Android app is built from a static bundle, so a missing VITE_API_URL at
// build time used to leave every screen unusable ("API URL is not configured").
// Inside the Capacitor shell we therefore fall back to the production API.
const DEFAULT_API = "https://medaionline.onrender.com";

/**
 * Hosts that are the *website*, never the API. The static site answers every path with
 * index.html, so probing it can only ever produce a misleading "blocked" answer.
 */
const FRONTEND_HOSTS = ["medaionline-1.onrender.com"];

/** API hosts worth trying, in order. The first one that answers becomes the API. */
const CANDIDATE_HOSTS = [
  "https://medaionline.onrender.com",       // backend (Render service "Medaionline")
  "https://medai-hospital-v2-api.onrender.com", // blueprint name, if ever deployed
];

const API_STORAGE_KEY = "medai_api_base";
const API_PROBE_TIMEOUT = 6000;

/**
 * ok        — a real MedAI API answered (possibly reporting a configuration problem)
 * blocked   — the host answers but the browser may not read it (CORS)
 * notapi    — an HTTP answer came back, but it is not our API (usually the website)
 * error     — our API answered with an HTTP error (it is running but failing)
 * down      — nothing answered at all
 */
export type ApiStatus = "ok" | "blocked" | "notapi" | "error" | "down" | "unconfigured";

function isNativeShell(): boolean {
  try {
    const cap = (window as any).Capacitor;
    if (cap && typeof cap.isNativePlatform === "function" && cap.isNativePlatform()) return true;
    // Capacitor serves the bundle from https://localhost inside the app.
    return location.hostname === "localhost" && location.protocol === "https:";
  } catch { return false; }
}

function isLocalDev(): boolean {
  try {
    const h = (window as any).location?.hostname || "";
    return h === "localhost" || h === "127.0.0.1" || h === "0.0.0.0";
  } catch { return false; }
}

function normalise(url: string): string {
  const v = String(url || "").trim().replace(/\/+$/, "");
  if (!v) return "";
  // Accept a bare host ("medai-hospital-v2-api.onrender.com") as well — that is what
  // Render's blueprint injects for a linked service.
  return /^https?:\/\//i.test(v) ? v : "https://" + v;
}

function overrideFromUrl(): string {
  try {
    const q = new URLSearchParams(location.search).get("api");
    if (!q) return "";
    const clean = normalise(q);
    if (!/^https?:\/\//.test(clean)) return "";
    localStorage.setItem(API_STORAGE_KEY, clean);   // remember for the next launch
    return clean;
  } catch { return ""; }
}

function savedBase(): string {
  try { return normalise(localStorage.getItem(API_STORAGE_KEY) || ""); } catch { return ""; }
}

/** The address this build was configured with (may be empty in local dev). */
const CONFIGURED: string = (() => {
  const fromEnv = normalise((import.meta.env as any).VITE_API_URL || "");
  if (fromEnv) return fromEnv;
  if (isNativeShell()) return DEFAULT_API;
  if (isLocalDev()) return "";
  return DEFAULT_API;
})();

/** True when the address belongs to the static website instead of the API. */
function isFrontendHost(base: string): boolean {
  const host = String(base || "").replace(/^https?:\/\//i, "").split("/")[0].toLowerCase();
  return FRONTEND_HOSTS.includes(host);
}

async function probe(base: string): Promise<ApiStatus> {
  const control = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = control ? setTimeout(() => control.abort(), API_PROBE_TIMEOUT) : null;
  try {
    const r = await fetch(base + "/api/health", { cache: "no-store", signal: control?.signal });
    if (!r.ok) return "error";           // answered, but our API is failing on that host
    // A static site also answers 200 — only accept a real MedAI API answer.
    const body = await r.text();
    try {
      const j = JSON.parse(body);
      if (j && (j.status === "ok" || j.status === "misconfigured" || /medai/i.test(String(j.service || "")))) return "ok";
      return "notapi";
    } catch {
      return "notapi";                   // HTML page: this is the website, not the API
    }
  } catch {
    // A CORS rejection and a dead host both throw. no-cors separates them:
    // an opaque response still resolves when the server is reachable.
    try {
      await fetch(base + "/api/health", { mode: "no-cors", cache: "no-store" });
      return "blocked";
    } catch {
      return "down";
    }
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** How useful an answer is when nothing came back "ok". */
const STATUS_RANK: Record<ApiStatus, number> = { ok: 5, blocked: 4, error: 3, notapi: 2, down: 1, unconfigured: 0 };

let resolved: { base: string; status: ApiStatus } | null = null;
let resolving: Promise<{ base: string; status: ApiStatus }> | null = null;

/** Pick the first working API host. Cached for the session, remembered across launches. */
async function resolveApi(): Promise<{ base: string; status: ApiStatus }> {
  if (resolved) return resolved;
  if (resolving) return resolving;

  resolving = (async () => {
    // 1) An address the user (or a ?api= link) chose explicitly wins — but only if it works.
    const explicit = overrideFromUrl() || savedBase();
    let explicitResult: { base: string; status: ApiStatus } | null = null;
    if (explicit) {
      const status = await probe(explicit);
      if (status === "ok") { resolved = { base: explicit, status }; return resolved; }
      explicitResult = { base: explicit, status };
      // A dead address, the website itself, or something that is not our API must not be
      // remembered, otherwise the app keeps failing on it forever.
      if (status === "down" || status === "notapi" || isFrontendHost(explicit)) {
        try { localStorage.removeItem(API_STORAGE_KEY); } catch { /* ignore */ }
      }
    }

    // 2) The build's own address, then the known API hosts — the website host is skipped.
    const unique = Array.from(new Set([CONFIGURED, ...CANDIDATE_HOSTS].filter(Boolean).map(normalise)))
      .filter((b) => !isFrontendHost(b));
    let best: { base: string; status: ApiStatus } | null = null;
    for (const base of unique) {
      const status = await probe(base);
      if (status === "ok") {
        resolved = { base, status };
        try { localStorage.setItem(API_STORAGE_KEY, base); } catch { /* ignore */ }
        return resolved;
      }
      if (!best || STATUS_RANK[status] > STATUS_RANK[best.status]) best = { base, status };
    }

    // 3) Nothing worked. A real CORS block on an explicitly chosen address is the most
    //    useful thing we can report; otherwise report the least-bad probe result.
    if (explicitResult?.status === "blocked") { resolved = explicitResult; return resolved; }
    resolved = best || { base: unique[0] || "", status: unique.length ? "down" : "unconfigured" };
    return resolved;
  })();

  try { return await resolving; } finally { resolving = null; }
}

/** Best-known base URL right now (for labels); may still be resolving. */
export const API: string = overriddenOrConfigured();
function overriddenOrConfigured(): string {
  const quick = overrideFromUrl() || savedBase();
  return quick || CONFIGURED;
}

/** Status of the connection as last seen by a request or by pingServer(). */
export let API_STATUS: ApiStatus = CONFIGURED ? "ok" : "unconfigured";
export function noteApiStatus(s: ApiStatus) { API_STATUS = s; }

export const API_CONFIG_ERROR = "This build has no API address. Rebuild the site with VITE_API_URL set to the API URL.";
export const API_CORS_ERROR = "The MedAI server is reachable but is blocking requests from this app. The API needs the latest MedAI build deployed on the server.";
export const API_NOT_API_ERROR = "That address is the MedAI website, not the API server. Use the backend address (" + DEFAULT_API.replace(/^https?:\/\//, "") + ").";
export const API_SERVER_ERROR = "The MedAI API answered with an error. The server is running, but something inside it failed — check the Render logs for this service.";

/** Called before any request so a configuration problem is reported as itself. */
async function apiBase(): Promise<string> {
  const { base, status } = await resolveApi();
  if (!base) throw new Error(API_CONFIG_ERROR);
  if (isFrontendHost(base)) throw new Error(API_NOT_API_ERROR);
  noteApiStatus(status);
  if (status === "blocked") throw new Error(API_CORS_ERROR);
  if (status === "notapi") throw new Error(API_NOT_API_ERROR);
  if (status === "error") throw new Error(API_SERVER_ERROR);
  return base;
}

/** Save a server address chosen by hand (advanced setting). */
export function setApiBase(url: string): { ok: boolean; message: string } {
  const raw = String(url || "").trim();
  if (!raw) return { ok: false, message: "Enter an address first." };
  const hostPart = raw.replace(/^https?:\/\//i, "");
  if (!/^[a-z0-9.-]+(:\d+)?(\/|$)/i.test(hostPart)) return { ok: false, message: "That does not look like a server address." };
  const clean = normalise(raw);
  try { localStorage.setItem(API_STORAGE_KEY, clean); } catch { return { ok: false, message: "This device blocks local storage." }; }
  resolved = null; resolving = null;
  return { ok: true, message: "Server set to " + clean.replace(/^https?:\/\//, "") };
}

/** Forget the saved address and go back to automatic detection. */
export function clearApiBase(): void {
  try { localStorage.removeItem(API_STORAGE_KEY); } catch { /* ignore */ }
  resolved = null; resolving = null;
}

/**
 * Force a fresh lookup (used by the "Test connection" button).
 * Keeps the address the user saved by hand — only the in-memory answer is dropped.
 */
export async function resetApiResolution(): Promise<void> {
  resolved = null; resolving = null;
}

/** Health check used by the on-screen diagnostics. */
export async function pingServer(): Promise<{ ok: boolean; ms: number; status: ApiStatus; base: string; detail: string }> {
  const started = Date.now();
  await resetApiResolution();
  const { base, status } = await resolveApi();
  const ms = Date.now() - started;
  if (!base) return { ok: false, ms, status: "unconfigured", base: "", detail: API_CONFIG_ERROR };
  const host = base.replace(/^https?:\/\//, "");
  if (status === "ok") {
    // The host can answer while its deployment is misconfigured (missing env vars):
    // report that exact reason instead of a cheerful "reachable".
    try {
      const r = await fetch(base + "/api/health", { cache: "no-store" });
      const j: any = await r.json();
      if (j && j.status === "misconfigured") return { ok: false, ms, status, base, detail: "Server is live but not configured — " + (j.problem || "missing environment variables") };
    } catch { /* health body not needed */ }
    return { ok: true, ms, status, base, detail: "Reachable (" + ms + " ms)" };
  }
  if (status === "blocked") return { ok: false, ms, status, base, detail: host + " is up but blocks this app (CORS) — the API build is out of date" };
  if (status === "notapi") return { ok: false, ms, status, base, detail: host + " is the MedAI website, not the API — set the backend address" };
  if (status === "error") return { ok: false, ms, status, base, detail: host + " answered with a server error — check the Render logs for this service" };
  if (status === "unconfigured") return { ok: false, ms, status, base: "", detail: API_CONFIG_ERROR };
  return { ok: false, ms, status, base, detail: "Cannot reach " + host + " — no server answered" };
}

export type Api = (path: string, opts?: any) => Promise<any>;

export function makeApi(token: string): Api {
  return async (path, opts = {}) => {
    const base = await apiBase();           // config/CORS problems must not look like network errors
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
      // The host may have moved or come back with a different address: forget the
      // cached answer so the next attempt probes again instead of staying broken.
      resolved = null; resolving = null;
      noteApiStatus("down");
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
    r = await fetch((await apiBase()) + "/api" + path, { method: "POST", headers: token ? { Authorization: `Bearer ${token}` } : {}, body: form });
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
  const r = await fetch(`${await apiBase()}/api/files/${id}/download`, { headers: { Authorization: `Bearer ${token}` } });
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
  const r = await fetch(`${await apiBase()}/api/files/${id}/download`, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error("Could not load the file");
  return URL.createObjectURL(await r.blob());
}
