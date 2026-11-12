# MedAI Hospital V3.11 — real 2FA, medicine reminders, 3D anatomy, SEO

## Two-factor authentication (was broken, now real)
`POST /2fa/setup` threw `TypeError: Unknown encoding: base32` (Node has no base32 encoding),
so the patient saw *Internal server error*. Verification was worse: it accepted **any six
digits**.

- new `apps/api/src/totp.js` — RFC 4648 base32, RFC 6238 TOTP (HMAC-SHA1, 30 s, 6 digits, ±1 step), constant-time compare, replay guard
- `/2fa/setup` returns a working `otpauth://` URI + a QR drawn **on our server** (the secret used to be sent to `api.qrserver.com`)
- `/2fa/verify` checks the real code or a backup code; a used step can never be reused
- `/2fa/disable` now requires a current or backup code — a stolen session cannot switch 2FA off
- backup codes are stored as SHA-256 hashes and burned when used
- tests: **10**, including the official RFC 6238 / RFC 4226 vectors

## Medicine reminders (Bhag 3)
- Android app: real daily alarms through the LocalNotifications plugin — they ring with the app closed (`allowWhileIdle`, repeats).
- Browser: notification while MedAI is open, and the card says so instead of promising more.
- one notification per dose per day (`medai_reminder_sent`), tap opens the app (service-worker `notificationclick`).
- "Reminder notifications" card in the Medicine tracker with turn on / reschedule / turn off.

## 3D anatomy (Bhag 2, MVP)
- new **3D anatomy** tab for patients: heart, lungs and brain built from simple geometry.
- **three.js is a lazy chunk** (753 kB → only when "Open 3D view" is tapped); the app itself does not grow.
- "Ask before loading 3D on mobile data" is on by default; without WebGL a 2D explanation card is shown.
- drag to rotate; labelled "pictures for learning only — not for diagnosis".

## SEO / share previews
- description, canonical, robots, Open Graph + Twitter card, JSON-LD (Organization, WebSite, SoftwareApplication)
- `robots.txt` keeps one-time links (`?consult`, `?call=`, `?recovery`, `/reset-password`) out of search
- `sitemap.xml`, and a static **`/get-app.html`** download page with its own preview tags
- `branding/og-image.jpg` — 1200×630, 125 kB (the 1.9 MB banner was unusable as a preview)

Tests: **80**.
