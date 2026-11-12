# MedAI Hospital V3.16 — Fingerprint + face on the website, health posters, smoother 3D

Everything you asked for, in one release.

## 1. Fingerprint / face lock — now on the website too

The Android app already used the phone's own biometric prompt. A PC or a browser had no such
thing, so the website now uses **WebAuthn passkeys** — Windows Hello (face or fingerprint),
Touch ID, or the phone's own screen-lock biometrics in Chrome/Safari/Firefox.

**How a patient sets it up**
1. Sign in normally.
2. **Billing & Services → Security & biometric → "Add this device"**.
3. Confirm with the device's fingerprint or face.

From then on the sign-in page shows **"🔒 Sign in with fingerprint / face"** — no password. The
Security tab also lists every added device with its last use, and each one can be removed.

**What is stored, and what is not**
- The server keeps a **public key** and a device label. The private key stays inside the phone or
  PC — it never reaches MedAI.
- The origin and RP ID are checked against an allowlist (`WEBAUTHN_ORIGINS`, `WEBAUTHN_RP_ID`), not
  taken from the request, so a look-alike site cannot collect a credential.
- Challenges are **single-use** and expire in 5 minutes; the signature **counter** is stored and
  must not go backwards (that is how a cloned authenticator is caught).
- A passkey sign-in still refuses suspended or unapproved accounts, writes an audit event, and
  issues the same normal session token.

**Render variables (optional — defaults cover the deployed site)**

| Variable | Default |
|---|---|
| `WEBAUTHN_RP_ID` | `medaionline-1.onrender.com` |
| `WEBAUTHN_ORIGINS` | `https://medaionline-1.onrender.com, http://localhost:5173, http://localhost:4173` |

The Android app is unchanged on purpose: it keeps the **native fingerprint/face prompt** (and the
app lock), because a passkey inside a WebView is less reliable than the OS prompt.

## 2. Posters on the home page

Three new photographs (generated for this build) sit in a scrollable strip under the hero, with
English + Bangla headlines drawn by the page so the text stays sharp:

| Poster | Message |
|---|---|
| **Online consultation** | see a doctor without the queue — video/audio visit, digital prescription |
| **Health check** | know your blood pressure and sugar early |
| **Medicine tracker** | free reminders, taken/skipped log, weekly adherence score |

Each card has a button (request an appointment / open health profile / install the app). Under the
strip: *"For chest pain, breathing difficulty, stroke signs or heavy bleeding, call 999 — do not
wait for an online visit."*

## 3. The 3D body turns, glides and zooms like an object

- **Flick to spin** — the body keeps turning and slows down (inertia), instead of stopping dead.
- **Tilt up to ~70°** so you can look from above or below; it can never flip upside down.
- **Smooth zoom** — wheel, pinch and the ＋ / − buttons now ease into place in ~120 ms instead of
  jumping in steps.
- **Double-tap** zooms to the torso and back out again.
- **Keyboard** for desktop: arrow keys rotate, `+` / `−` zoom (the canvas is focusable).
- Idle auto-rotation still stops the moment a finger touches the screen, and still respects
  `prefers-reduced-motion`.

## 4. Tests

**108 / 108** (was 99). New guards: WebAuthn verification uses the allowlist (never `req.origin`),
challenges are single-use, the counter is persisted, only a public key is stored, passkey routes are
rate-limited and refuse suspended accounts, the app keeps its native prompt, the three posters exist
and are rendered with Bangla copy and the 999 note, and the 3D tips/glides/eases.

## 5. Still needed on your side

Render → **Medaionline** → *Manual Deploy* (clear build cache). Without it the passkey endpoints and
`/api/pain-reports` do not exist in production yet, and the website will say
*"Fingerprint / face sign-in is not switched on for this server yet."*
