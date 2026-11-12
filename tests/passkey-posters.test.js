// © 2026 MD Gausur Rahman Nabil. All rights reserved. MedAI Hospital.
// Guards for browser fingerprint/face sign-in (WebAuthn passkeys), the native biometric
// prompt that the app keeps, the home-page posters and the 3D rotation/zoom gestures.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const webauthn = read("apps/api/src/webauthn.js");
const routes = read("apps/api/src/routes.js");
const models = read("apps/api/src/models.js");
const client = read("apps/web/src/webauthn.ts");
const app = read("apps/web/src/App.tsx");
const panel = read("apps/web/src/CommercialPanel.tsx");
const native = read("apps/web/src/biometric.ts");
const viewer = read("apps/web/src/body3d.tsx");
const posters = read("apps/web/src/posters.tsx");
const css = read("apps/web/src/components.css");

test("passkeys verify against an allowlist, never the request's Origin header", () => {
  assert.match(webauthn, /verifyRegistrationResponse/);
  assert.match(webauthn, /verifyAuthenticationResponse/);
  assert.match(webauthn, /expectedOrigin: RP\.origins/);
  assert.match(webauthn, /expectedRPID: RP\.rpID/);
  assert.match(webauthn, /requireUserVerification: true/);
  assert.doesNotMatch(webauthn, /expectedOrigin:\s*req\./, "the browser must not choose the origin");
  assert.match(webauthn, /process\.env\.WEBAUTHN_ORIGINS/, "production origins must be configurable in Render");
  assert.match(webauthn, /process\.env\.WEBAUTHN_RP_ID/);
});

test("challenges are single-use and pinned to the ceremony", () => {
  assert.match(webauthn, /challenges\.delete\(key\)/, "a challenge must not survive one attempt");
  assert.match(webauthn, /CHALLENGE_TTL_MS = 5 \* 60 \* 1000/);
  assert.match(webauthn, /`reg:\$\{user\.id\}`/);
  assert.match(webauthn, /`auth:\$\{key\}`/);
});

test("a cloned authenticator is caught by the signature counter", () => {
  assert.match(webauthn, /counter: row\.counter \|\| 0/);
  assert.match(webauthn, /row\.counter = verification\.authenticationInfo\.newCounter/);
  assert.match(models, /counter:\{type:Number,default:0\}/);
});

test("only a public key is stored, one row per credential", () => {
  assert.match(models, /model\("WebAuthnCredential"/);
  assert.match(models, /credentialId:\{type:String,required:true,unique:true\}/);
  assert.match(models, /publicKey:\{type:String,required:true\}/);
  assert.match(webauthn, /private key never leaves the phone\/PC/);
  assert.doesNotMatch(models, /privateKey/);
});

test("passkey routes are scoped, limited and refuse suspended accounts", () => {
  const register = routes.slice(routes.indexOf('router.post("/auth/webauthn/register/options"'));
  assert.match(register.slice(0, 400), /auth,sensitiveLimiter/, "adding a device needs a real session");
  const loginOptions = routes.slice(routes.indexOf('router.post("/auth/webauthn/login/options"'));
  assert.match(loginOptions.slice(0, 200), /loginLimiter/);
  const loginVerify = routes.slice(routes.indexOf('router.post("/auth/webauthn/login/verify"'));
  const body = loginVerify.slice(0, 1200);
  assert.match(body, /loginLimiter/);
  assert.match(body, /user\.status!=="active"/, "a suspended account must not sign in with a passkey");
  assert.match(body, /makeToken\(fresh\)/);
  assert.match(body, /auth\.webauthn_login/);
  // No password may be required — or accepted — on the passkey path.
  assert.doesNotMatch(body, /verifyPassword/);
  assert.match(routes, /router\.delete\("\/auth\/webauthn\/credentials\/:id",auth/, "removing a device must be owner-only");
});

test("the website can add a device and sign in with it", () => {
  assert.match(client, /@simplewebauthn\/browser/);
  assert.match(client, /platformAuthenticatorIsAvailable/, "a USB key is not what a patient expects");
  assert.match(client, /startRegistration\(\{ optionsJSON: options \}\)/);
  assert.match(client, /startAuthentication\(\{ optionsJSON: options \}\)/);
  assert.match(client, /localStorage/, "the browser remembers which account has a passkey here");
  assert.match(app, /signInWithPasskey/);
  assert.match(app, /!nativeApp && passkeyOk/, "the browser button must not replace the app's native prompt");
  assert.match(panel, /addPasskey\(api, label\)/);
  assert.match(panel, /removePasskey\(api, row\.id\)/);
});

test("the Android app keeps its own fingerprint/face prompt", () => {
  assert.match(native, /@aparajita\/capacitor-biometric-auth/);
  assert.match(app, /biometricLockEnabled\(\) && \(/, "the native sign-in button must still be there");
  assert.match(app, /isNativeApp\(\)/, "the app must still detect the native shell");
});

test("three posters ship and are shown on the home page", () => {
  for (const name of ["telecare", "checkup", "medicines"]) {
    const path = join(root, `apps/web/public/branding/posters/${name}.jpg`);
    assert.ok(statSync(path).size > 20 * 1024, `${name}.jpg looks empty`);
  }
  assert.match(posters, /telecare\.jpg/);
  assert.match(posters, /checkup\.jpg/);
  assert.match(posters, /medicines\.jpg/);
  assert.match(posters, /titleBn/, "each poster carries Bangla copy");
  assert.match(posters, /call 999/, "posters must not imply emergencies wait for a visit");
  assert.match(app, /<PosterStrip/);
  assert.match(css, /\.posters-rail/, "the strip must be a scrollable rail");
  assert.match(css, /scroll-snap-type:x mandatory/);
});

test("the 3D body turns, glides and zooms smoothly", () => {
  assert.match(viewer, /spinY \*= 0\.93/, "a flick should coast to a stop");
  assert.match(viewer, /Math\.max\(-1\.2, Math\.min\(1\.2/, "the body may tilt, never flip");
  assert.match(viewer, /let zoomTarget = HOME_Z/, "zoom is animated, not a jump");
  assert.match(viewer, /camera\.position\.z \+= \(zoomTarget - camera\.position\.z\)/, "zoom eases");
  assert.match(viewer, /lastTapAt/, "double-tap zoom");
  assert.match(viewer, /ArrowLeft/, "desktop users can rotate with the keyboard");
  assert.match(viewer, /canvas\.tabIndex = 0/, "the canvas must be focusable for the keyboard");
});
