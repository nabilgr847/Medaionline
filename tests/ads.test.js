// © 2026 MD Gausur Rahman Nabil. All rights reserved. MedAI Hospital.
import test from "node:test";
import assert from "node:assert/strict";
process.env.MONGODB_URI ||= "mongodb://localhost/test";
process.env.JWT_SECRET ||= "x".repeat(40);
const { adsSchema, adsForScreen, ADS_DEFAULT } = await import("../apps/api/src/ads.js");

const card = (over = {}) => ({ id: "a", title: "Card", body: "", sponsor: "", ctaText: "", ctaUrl: "", image: "", placement: "all", active: true, priority: 0, ...over });

test("ads are off by default, so nothing is shown until an admin adds a card", () => {
  assert.deepEqual(ADS_DEFAULT.items, []);
  assert.deepEqual(adsForScreen(ADS_DEFAULT, "home"), []);
});

test("switching the feature off hides every card", () => {
  const ads = { enabled: false, note: "", items: [card()], clicks: {} };
  assert.deepEqual(adsForScreen(ads, "home"), []);
});

test("inactive cards are never shown", () => {
  const ads = { enabled: true, items: [card({ active: false })], clicks: {} };
  assert.deepEqual(adsForScreen(ads, "home"), []);
});

test("a card is only shown where it targets", () => {
  const ads = { enabled: true, items: [card({ id: "h", placement: "home" }), card({ id: "c", placement: "chat" })], clicks: {} };
  assert.deepEqual(adsForScreen(ads, "home").map((a) => a.id), ["h"]);
  assert.deepEqual(adsForScreen(ads, "chat").map((a) => a.id), ["c"]);
  assert.deepEqual(adsForScreen(ads, "dashboard"), []);
});

test("placement 'all' reaches every screen", () => {
  const ads = { enabled: true, items: [card({ placement: "all" })], clicks: {} };
  for (const where of ["home", "dashboard", "chat"]) assert.equal(adsForScreen(ads, where).length, 1);
});

test("highest priority first, and never more than the requested number", () => {
  const ads = { enabled: true, items: [card({ id: "low", priority: 1 }), card({ id: "high", priority: 9 }), card({ id: "mid", priority: 5 })], clicks: {} };
  assert.deepEqual(adsForScreen(ads, "home", 2).map((a) => a.id), ["high", "mid"]);
});

test("internal fields (counters, active flag) are not exposed to the client", () => {
  const ads = { enabled: true, items: [card({ id: "x" })], clicks: { x: 7 } };
  const [shown] = adsForScreen(ads, "home");
  assert.equal(shown.clicks, undefined);
  assert.equal(shown.active, undefined);
  assert.equal(shown.priority, undefined);
});

test("a card without a link is still valid (text-only sponsor)", () => {
  assert.equal(adsSchema.safeParse({ enabled: true, note: "", items: [card({ ctaUrl: "", ctaText: "" })] }).success, true);
});

test("javascript: links are rejected", () => {
  assert.equal(adsSchema.safeParse({ enabled: true, note: "", items: [card({ ctaUrl: "javascript:alert(1)" })] }).success, false);
});

test("an inline image is only accepted as PNG/JPG/WEBP data", () => {
  const ok = adsSchema.safeParse({ enabled: true, note: "", items: [card({ image: "data:image/png;base64,iVBORw0KGgo=" })] });
  const bad = adsSchema.safeParse({ enabled: true, note: "", items: [card({ image: "https://tracker.example/pixel.gif" })] });
  assert.equal(ok.success, true);
  assert.equal(bad.success, false);
});
