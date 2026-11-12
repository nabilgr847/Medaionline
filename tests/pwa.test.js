// © 2026 MD Gausur Rahman Nabil. All rights reserved. MedAI Hospital.
// Guards for the installable app and the "network problem" fixes.
// These read the shipped files instead of importing React, so they run in CI without a browser.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const manifest = JSON.parse(read("apps/web/public/manifest.webmanifest"));
const sw = read("apps/web/public/sw.js");
const indexHtml = read("apps/web/index.html");
const api = read("apps/web/src/api.ts");

test("the manifest is installable (name, start_url, 192 + 512 icons)", () => {
  assert.ok(manifest.name && manifest.name.length > 2);
  assert.equal(manifest.start_url, "/");
  assert.equal(manifest.display, "standalone");
  const sizes = manifest.icons.map((i) => i.sizes);
  assert.ok(sizes.includes("192x192"), "needs a 192px icon");
  assert.ok(sizes.includes("512x512"), "needs a 512px icon");
  assert.ok(manifest.icons.some((i) => i.purpose === "maskable"), "Android needs a maskable icon");
});

test("every manifest icon exists on disk", () => {
  for (const icon of manifest.icons) {
    const path = icon.src.replace(/^\//, "");
    assert.doesNotThrow(() => read(`apps/web/public/${path}`), `${icon.src} is missing`);
  }
});

test("the service worker never touches API traffic", () => {
  assert.match(sw, /startsWith\("\/api"\)/, "API requests must be skipped");
  assert.match(sw, /url\.origin !== self\.location\.origin/, "cross-origin requests must be skipped");
  assert.match(sw, /req\.method !== "GET"/, "uploads (POST) must not be intercepted");
});

test("offline visitors get a real page, not a broken tab", () => {
  assert.match(sw, /OFFLINE_HTML/, "the service worker needs an offline fallback page");
  assert.match(sw, /caches\.match\("\/"\)/);
});

test("the website registers the service worker, the APK does not", () => {
  assert.match(indexHtml, /serviceWorker\.register\("\/sw\.js"\)/);
  assert.match(indexHtml, /nativeShell/, "index.html must skip the service worker inside the APK");
});

test("the install prompt and update toast ship with the app", () => {
  const pwa = read("apps/web/src/pwa.tsx");
  assert.match(pwa, /beforeinstallprompt/);
  assert.match(pwa, /appinstalled/);
  assert.match(pwa, /controllerchange/);
});

test("a cold server is not reported as the patient's network problem", () => {
  const timeout = Number(api.match(/API_PROBE_TIMEOUT = (\d+)/)[1]);
  assert.ok(timeout >= 15000, `probe timeout is ${timeout} ms; a Render cold start needs 30-60 s`);
  assert.match(api, /RETRY_DELAYS/, "requests need a backoff plan");
  assert.doesNotMatch(api, /Check your connection/, "never blame the user for a sleeping server");
  assert.match(api, /setNetwork\("waking"\)/, "the UI needs to know the server is booting");
});

test("sign-in (a POST) is retried when the server never received it", () => {
  // The retry loop must not be limited to GET: POSTs handle a cold start too.
  assert.doesNotMatch(api, /attempt < \(method === "GET" \? 2 : 1\)/, "old GET-only retry is back");
  assert.match(api, /for \(let attempt = 0; attempt < RETRY_DELAYS\.length; attempt\+\+\)/);
});

test("the web environment template points at the API, not the website", () => {
  const env = read("apps/web/.env.example");
  assert.match(env, /VITE_API_URL=https:\/\/medaionline\.onrender\.com/);
  assert.doesNotMatch(env, /VITE_API_URL=https:\/\/medaionline-1\.onrender\.com/,
    "medaionline-1 is the static website and would break every request");
});

test("a scheduled job keeps the sleeping API awake", () => {
  const yml = read(".github/workflows/keep-api-awake.yml");
  assert.match(yml, /cron:/);
  assert.match(yml, /\/api\/health/);
});
