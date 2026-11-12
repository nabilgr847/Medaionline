// © 2026 MD Gausur Rahman Nabil. All rights reserved. MedAI Hospital.
// Guards for the phone-layout fixes: the call screen's two button rows, the Capacitor
// listener crash, and "use fingerprint / face next time?" after the account opens.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const main = read("apps/web/src/main.tsx");
const css = read("apps/web/src/components.css");
const style = read("apps/web/src/style.css");
const app = read("apps/web/src/App.tsx");
const call = read("apps/web/src/TeleVisitCall.tsx");

const block = (source, selector) => {
  const match = new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*\\{").exec(source);
  if (!match) return "";
  const start = match.index;
  return source.slice(start, source.indexOf("}", start) + 1);
};

test("the call screen's two button rows no longer sit on top of each other", () => {
  const primary = block(style, ".callbar");
  const secondary = block(css, ".callbar2");
  assert.ok(primary.includes("bottom:"), "mic / chat / end stay at the bottom");
  assert.ok(secondary.includes("top:"), "the small controls moved to the top strip");
  assert.ok(!/bottom\s*:/.test(secondary), "the strip must not share the bottom offset with .callbar");
  // The old bug: both were anchored to the same bottom offset.
  assert.notEqual(
    primary.match(/bottom:[^;]+/)?.[0],
    secondary.match(/bottom:[^;]+/)?.[0],
  );
});

test("the secondary strip fits and scrolls on a narrow phone", () => {
  const secondary = block(css, ".callbar2");
  assert.match(secondary, /overflow-x:auto/, "eight buttons cannot fit 360 px");
  assert.match(secondary, /scrollbar-width:none/);
  assert.doesNotMatch(secondary, /pointer-events:none/, "a none container cannot be scrolled by touch");
  assert.match(css, /\.callbar2 \.roundbtn\{ flex:0 0 auto/, "buttons must not shrink into each other");
  assert.match(css, /\.callbar2::-webkit-scrollbar\{ display:none/);
});

test("the self-view and the primary bar keep their space", () => {
  assert.match(css, /\.call-local\{ width:88px; right:10px; bottom:104px; \}/);
});

test("no Capacitor listener is awaited with .catch (that crashed the app)", () => {
  // "l.addListener(...).catch is not a function" — some plugin versions return a handle,
  // not a promise. Everything now goes through the small listen() helper.
  assert.doesNotMatch(main, /addListener\([^;]*\)\.catch\(/, "a direct .catch on addListener is back");
  assert.match(main, /function listen\(plugin: any, event: string, handler:/);
  assert.match(main, /typeof result\.catch === "function"/, "the helper must accept both shapes");
  assert.match(main, /listen\(PushNotifications, "registration"/);
  assert.match(main, /listen\(PushNotifications, "registrationError"/);
  assert.match(main, /listen\(App, "appStateChange"/);
});

test("the app re-locks after two minutes in the background", () => {
  assert.match(main, /LOCK_AFTER_MS = 2 \* 60 \* 1000/);
  assert.match(main, /medai_biometric_lock/);
});

test("fingerprint / face is offered when the account opens, for every role", () => {
  assert.match(app, /function PasskeyNudge/);
  assert.match(app, /\{user && !nativeApp && passkeyOk && <PasskeyNudge/, "must show for patient, doctor and admin");
  assert.match(app, /listPasskeys\(api\)/, "do not ask again once a device is added");
  assert.match(app, /Add this device/);
  assert.match(app, /Not now/);
});

test("the answer is saved on the device instead of nagging every sign-in", () => {
  assert.match(app, /PASSKEY_SNOOZE_KEY = "medai_passkey_snooze"/);
  assert.match(app, /14 \* 24 \* 3600 \* 1000/, "not-now should last two weeks");
  assert.match(app, /medai_bio_ask_snooze/, "the native app prompt is snoozed the same way");
  assert.match(app, /rememberPasskeyEmail\(email\)/, "the account is remembered for the sign-in button");
  assert.match(app, /localStorage\.removeItem\("medai_bio_ask_snooze"\)/, "turning it on clears the snooze");
});

test("the manual route is still there after saying no", () => {
  assert.match(read("apps/web/src/CommercialPanel.tsx"), /Add this device/);
  assert.match(read("apps/web/src/CommercialPanel.tsx"), /removePasskey/);
  const nudge = block(css, ".passkey-nudge");
  assert.ok(nudge.includes("@media") === false);
  assert.match(css, /@media \(max-width:767px\)\{\s*\.passkey-nudge/, "the nudge stacks on a phone");
  assert.match(css, /\.passkey-nudge \.row button\{ min-height:44px/, "44 px touch target");
});
