// © 2026 MD Gausur Rahman Nabil. All rights reserved. MedAI Hospital.
// Guards for the features added together: real 2FA, medicine reminders, 3D anatomy.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const commercial = read("apps/api/src/commercial.js");
const totp = read("apps/api/src/totp.js");
const panel = read("apps/web/src/CommercialPanel.tsx");
const notify = read("apps/web/src/notify.ts");
const anatomy = read("apps/web/src/anatomy.tsx");
const patient = read("apps/web/src/PatientPanel.tsx");
const sw = read("apps/web/public/sw.js");

test("2FA setup can no longer crash on an encoding Node does not have", () => {
  assert.doesNotMatch(commercial, /toString\("base32"\)/, "the crashing line is back");
  assert.match(commercial, /import \{ generateSecret/, "must use the tested TOTP module");
  assert.match(totp, /createHmac\("sha1"/);
});

test("2FA verification validates a real code instead of any six digits", () => {
  assert.doesNotMatch(commercial, /ok = \/\^\\d\{6\}\$\/\.test\(body\.token\)/,
    "accepting any 6 digits defeats the purpose of 2FA");
  assert.match(commercial, /verifyTotp\(/);
  assert.match(commercial, /lastStep/, "replay protection must be wired into the route");
});

test("turning 2FA off requires proof of possession", () => {
  const route = commercial.slice(commercial.indexOf('router.post("/2fa/disable"'));
  const body = route.slice(0, route.indexOf("}));") + 4);
  assert.match(body, /verifyTotp|backupCode/, "a stolen session must not be able to disable 2FA");
  assert.doesNotMatch(body, /findOneAndDelete\(\{ userId: req\.user\.id \}\)\s*;\s*await audit/,
    "disable must not delete the record without a code");
});

test("the 2FA QR code is drawn on our server, not by a third party", () => {
  assert.doesNotMatch(panel, /api\.qrserver\.com/, "leaking the TOTP secret to an external QR service");
  assert.match(commercial, /QRCode\.toDataURL/);
  assert.match(panel, /form\.qr/);
});

test("backup codes are stored hashed, never usable as-is", () => {
  assert.match(commercial, /backupCodes\.map\(hashCode\)/);
  assert.match(totp, /createHash\("sha256"\)/);
});

test("the Android app schedules real alarms, the browser says what it can do", () => {
  assert.match(notify, /Capacitor\?\.Plugins\?\.LocalNotifications/, "use the native plugin inside the APK");
  assert.match(notify, /repeats: true/, "reminders must repeat daily");
  assert.match(notify, /allowWhileIdle: true/, "Android drops inexact alarms otherwise");
  assert.match(notify, /showNotification/, "browser path");
  assert.match(notify, /while MedAI is open|while MedAI is open\./, "must not promise closed-tab reminders");
});

test("a reminder fires at most once a day per dose", () => {
  assert.match(notify, /DEDUPE_KEY/);
  assert.match(notify, /alreadySent\(key\)/);
  assert.match(notify, /markSent\(key\)/);
});

test("the reminder card is wired into the medicine tracker", () => {
  assert.match(panel, /Reminder notifications/);
  assert.match(panel, /requestNotifyPermission/);
  assert.match(panel, /syncReminders/);
});

test("tapping a reminder notification opens MedAI", () => {
  assert.match(sw, /notificationclick/);
  assert.match(sw, /clients\.openWindow|client\.focus\(\)/);
});

test("three.js is lazy-loaded, never part of the first download", () => {
  assert.match(anatomy, /await import\("three"\)/);
  assert.doesNotMatch(anatomy, /^import .*from "three";/m, "a static import would land in the main bundle");
  assert.match(patient, /<AnatomyCard/);
});

test("the 3D view asks before spending a patient's mobile data", () => {
  assert.match(anatomy, /medai_3d_wifi_only/);
  assert.match(anatomy, /effectiveType/);
  assert.match(anatomy, /Load anyway/);
});

test("without WebGL the card still explains the organ", () => {
  assert.match(anatomy, /webglAvailable/);
  assert.match(anatomy, /anatomy-fallback/);
  assert.match(anatomy, /not for diagnosis|learning only/);
});

/* ---------- 3D anatomy: six organs, labels, quiz ---------- */

// Parse the ORGANS array straight out of the component so the content itself is checked.
const organsBlock = anatomy.slice(anatomy.indexOf("const ORGANS"), anatomy.indexOf("const WIFI_KEY"));
const organIds = [...organsBlock.matchAll(/id: "(heart|lungs|brain|kidney|eye|spine)"/g)].map((m) => m[1]);

test("six organs are offered, including kidney, eye and spine", () => {
  assert.deepEqual(organIds, ["heart", "lungs", "brain", "kidney", "eye", "spine"]);
});

test("every organ has labels with a note", () => {
  const hotspots = [...organsBlock.matchAll(/hotspots: \[([\s\S]*?)\],\s*quiz:/g)];
  assert.equal(hotspots.length, 6, "each organ needs a hotspot list");
  for (const [, block] of hotspots) {
    const names = [...block.matchAll(/name: "([^"]+)"/g)];
    const notes = [...block.matchAll(/note: "([^"]+)"/g)];
    assert.ok(names.length >= 3, "at least three labels per organ");
    assert.equal(names.length, notes.length, "every label needs an explanation");
    for (const [, note] of notes) assert.ok(note.length > 20, `note too short: ${note}`);
  }
});

test("every quiz answer points at a real option", () => {
  const questions = [...organsBlock.matchAll(/\{ q: "([^"]+)", options: \[([^\]]+)\], answer: (\d+), why: "([^"]+)" \}/g)];
  assert.ok(questions.length >= 24, `only ${questions.length} questions found`);
  for (const [, q, optionsRaw, answer, why] of questions) {
    const options = optionsRaw.split('", "').map((o) => o.replace(/^"|"$/g, ""));
    const index = Number(answer);
    assert.ok(index >= 0 && index < options.length, `"${q}" has an out-of-range answer`);
    assert.ok(why.length > 20, `"${q}" needs an explanation`);
  }
});

test("the quiz is reachable from the card and remembers the best score", () => {
  assert.match(anatomy, /Take the quiz/);
  assert.match(anatomy, /medai_anatomy_best/);
  assert.match(anatomy, /Quiz finished/);
});

test("labels can be switched off, and are dots only on a phone", () => {
  assert.match(anatomy, /Show labels/);
  assert.match(anatomy, /setLabelsVisible/);
  const css = read("apps/web/src/components.css");
  assert.match(css, /\.anatomy-hotspot/);
  assert.match(css, /max-width:767px\)\{[\s\S]*\.anatomy-hotspot span\{ display:none/);
});

test("hotspots on the far side of the model are hidden", () => {
  assert.match(anatomy, /facingCamera/);
  assert.match(anatomy, /dot\(toCamera\)/);
});
