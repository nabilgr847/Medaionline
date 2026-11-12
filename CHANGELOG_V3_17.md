# MedAI Hospital V3.17 — The app stopped crashing, the call buttons stop overlapping, and the biometric prompt now appears by itself

## 1. `l.addListener(...).catch is not a function` — fixed

That error came from the native bootstrap in `main.tsx`: Capacitor's `addListener` returns a
**Promise** in some plugin versions and a plain **handle** in others. The code called `.catch()` on
the result, so on the versions that return a handle the whole native start-up threw — push
registration and the auto-lock timer both died with it.

Fix: one small `listen()` helper that accepts both shapes:

```ts
const result = await-or-not(plugin.addListener(event, handler));
if (result && typeof result.catch === "function") result.catch(() => {});
```

Push (`registration`, `registrationError`) and the app-lock (`appStateChange`) now all go through
it, and a test fails if a direct `.catch` on `addListener` ever comes back.

## 2. Call screen: two rows of buttons were drawn on top of each other

`.callbar` (mic / camera / chat / end) and `.callbar2` (flip, share, noise, help, record, fit,
fullscreen, minimize) were **both** anchored to the bottom of the stage — 22 px and 16 px — so on a
phone the eight small buttons were stacked over the four big ones.

New layout, checked at 360 px width:

- **Bottom:** the four primary buttons only (mic, camera, chat, end call).
- **Top strip:** the eight secondary buttons, right-aligned on desktop and a **scrollable row** on a
  phone (`overflow-x:auto`, no shrinking, 40 px targets).
- The local self-view and the "Connected" chip moved down 8 px so the primary bar has room.

## 3. Fingerprint / face is now offered when the account opens — for every role

A card appears right under the header after a patient, doctor or admin signs in:

> **🔒 Open MedAI with your fingerprint or face?** — *Add this device* / *Not now*

- It only appears if this browser can really do a **platform** check (Windows Hello, Touch ID,
  Android biometrics) and the account has no device added yet.
- **Add this device** → the OS prompt → a public key is saved on the server and the sign-in page
  starts offering **"🔒 Sign in with fingerprint / face"**.
- **Not now** is remembered for **14 days** — no nagging on every sign-in. The native app's
  "Use fingerprint next time?" prompt is snoozed the same way, and turning it on clears the snooze.
- The **manual** route never goes away: *Billing & Services → Security & biometric* → **Add this
  device** / **Remove**, with the list of devices and their last use.

The choice is saved on the device (`medai_passkey_snooze`, `medai_bio_ask_snooze`,
`medai_passkey_email`), so it survives restarts and applies only to that device.

## 4. Design pass

- The prompt card stacks vertically on ≤ 767 px, full-width buttons, 44 px touch targets.
- Call strip hides its scrollbar but still scrolls, so nothing is clipped on a 5-inch screen.
- Security panel keeps its three cards (native biometric, browser passkey, server connection) in
  one column with consistent spacing.

## 5. Tests

**116 / 116** (was 108). New guards: the two call rows cannot share a bottom anchor again, the strip
must scroll without `pointer-events:none`, no `.catch` on `addListener`, the 2-minute auto-lock is
still wired, the biometric prompt exists for all roles, both snoozes are two weeks, and the manual
security route stays.

## 6. Still needed on your side

Render → **Medaionline** → *Manual Deploy* (clear build cache). Until that deploy the passkey
endpoints and `/api/pain-reports` do not exist in production.
