// © 2026 MD Gausur Rahman Nabil. All rights reserved. MedAI Hospital.
// SEO guards: a shared link must show a real preview, and the one-time links must stay out of
// search results. These read the shipped files, so they run in CI without a browser.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");
const index = read("apps/web/index.html");
const getApp = read("apps/web/public/get-app.html");
const robots = read("apps/web/public/robots.txt");
const sitemap = read("apps/web/public/sitemap.xml");

test("the home page describes itself to search engines", () => {
  const desc = index.match(/<meta name="description" content="([^"]+)"/);
  assert.ok(desc, "missing meta description");
  assert.ok(desc[1].length > 60 && desc[1].length < 300, `description length ${desc[1].length}`);
  assert.match(index, /<link rel="canonical" href="https:\/\/medaionline-1\.onrender\.com\/"/);
  assert.match(index, /<meta name="robots" content="index,follow/);
});

test("a shared link gets a large image preview", () => {
  for (const tag of ["og:type", "og:title", "og:description", "og:url", "og:image"]) {
    assert.ok(index.includes(`property="${tag}"`), `missing ${tag}`);
  }
  assert.match(index, /<meta property="og:image" content="https:\/\/[^"]+\/branding\/og-image\.jpg"/);
  assert.match(index, /<meta property="og:image:width" content="1200"/);
  assert.match(index, /<meta property="og:image:height" content="630"/);
  assert.match(index, /<meta name="twitter:card" content="summary_large_image"/);
});

test("the preview image exists, is 1200x630 and light enough to load fast", () => {
  const path = join(root, "apps/web/public/branding/og-image.jpg");
  const size = statSync(path).size;
  assert.ok(size < 300 * 1024, `og-image is ${(size / 1024).toFixed(0)} KB; keep it under 300 KB`);
  const bytes = readFileSync(path);
  assert.equal(bytes[0], 0xff, "not a JPEG");
  assert.equal(bytes[1], 0xd8, "not a JPEG");
});

test("structured data marks it as a health app", () => {
  const json = index.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  assert.ok(json, "missing JSON-LD");
  const data = JSON.parse(json[1]);
  const types = data["@graph"].map((n) => n["@type"]);
  assert.ok(types.includes("Organization"));
  assert.ok(types.includes("WebSite"));
  assert.ok(types.includes("SoftwareApplication"));
  const app = data["@graph"].find((n) => n["@type"] === "SoftwareApplication");
  assert.equal(app.applicationCategory, "HealthApplication");
  assert.match(app.downloadUrl, /MedAI-Hospital\.apk$/);
});

test("crawlers are told which links must never be indexed", () => {
  for (const path of ["/?debug", "/?consult", "/?call=", "/?recovery", "/reset-password", "/api/"]) {
    assert.ok(robots.includes(`Disallow: ${path}`), `${path} should be disallowed`);
  }
  assert.match(robots, /Sitemap: https:\/\/medaionline-1\.onrender\.com\/sitemap\.xml/);
});

test("the sitemap lists the public pages only", () => {
  assert.match(sitemap, /<loc>https:\/\/medaionline-1\.onrender\.com\/<\/loc>/);
  assert.match(sitemap, /get-app\.html/);
  assert.doesNotMatch(sitemap, /consult|call=|recovery|reset-password/);
});

test("the download page works on its own and can be shared", () => {
  assert.match(getApp, /<title>[^<]*MedAI[^<]*<\/title>/);
  assert.match(getApp, /property="og:image" content="https:\/\/[^"]+og-image\.jpg"/);
  assert.match(getApp, /releases\/latest\/download\/MedAI-Hospital\.apk/);
  assert.match(getApp, /Install unknown apps/);
  assert.match(getApp, /call 999/);
  assert.doesNotMatch(getApp, /<script/, "a static page must not need JavaScript");
});
