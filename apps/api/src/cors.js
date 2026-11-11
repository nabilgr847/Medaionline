// © 2026 MD Gausur Rahman Nabil. All rights reserved. MedAI Hospital.
// CORS policy in one place so it can be tested.
//
// Allowed:
//   * every origin listed in CLIENT_ORIGIN (comma-separated, so website + preview
//     URLs both work)
//   * the Capacitor Android/iOS WebView origins (https://localhost etc.)
//   * requests with no Origin header at all (native fetch, curl, server-to-server)
//
// Anything else gets no CORS headers, so the browser refuses to read the response.
import cors from "cors";
import { config } from "./config.js";

const CAPACITOR_ORIGINS = [
  "https://localhost",
  "http://localhost",
  "capacitor://localhost",
  "ionic://localhost",
];

export const CORS_ORIGINS = new Set([
  ...String(config.clientOrigin || "")
    .split(",")
    .map((o) => o.trim().replace(/\/$/, ""))
    .filter(Boolean),
  ...CAPACITOR_ORIGINS,
]);

export function corsOrigin(origin, cb) {
  if (!origin) return cb(null, true);
  if (CORS_ORIGINS.has("*") || CORS_ORIGINS.has(String(origin).replace(/\/$/, ""))) return cb(null, true);
  return cb(null, false);
}

export default cors({ origin: corsOrigin, maxAge: 86400 });
