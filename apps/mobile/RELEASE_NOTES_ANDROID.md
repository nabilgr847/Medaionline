## Build 2026-11-11 (biometric sign-in)

- **Sign in with fingerprint / face unlock** directly on the login screen, plus the existing
  app lock. The device check is the only thing that can unlock the saved session.
- Offered right after the first password sign-in; a real sign-out removes the saved session.
- The "Server / Test connection" diagnostics are no longer shown on the public sign-in page
  (open `?debug=1` if you ever need them). Settings → Security keeps the same controls.
- API host detection accepts only the real API (`medaionline.onrender.com`) and never the
  static website host.

# MedAI Hospital — Android app

Latest Android build of MedAI Hospital.

- **Fingerprint / face unlock** — turn it on in *Security*, then reopen the app and unlock
  with your finger instead of the password. The app re-locks after 2 minutes in the background.
- **Medicine tracker** — add reminders, log each dose as taken or skipped, and follow your
  adherence score.
- The whole web app is bundled inside the APK, so the interface opens instantly even on a
  slow connection.
- Camera, microphone, gallery, file download and print all use the native Android bridge.

Download `MedAI-Hospital.apk` and install it (allow install from unknown sources when
Android asks). Sign in with the same MedAI account you use on the website.
