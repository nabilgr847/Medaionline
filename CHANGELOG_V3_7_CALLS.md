# V3.7 – Call system upgrade + PWA

## Calls (apps/web/src/TeleVisitCall.tsx)
- Call screen is rendered on document.body (portal) – full-screen no longer breaks inside panels. Minimise = small floating window.
- WhatsApp-style ringing screen for the patient (Accept / Decline), ringtone + vibration; doctor no-answer timeout (60 s).
- Incoming-call banner on every dashboard page; "Answer" opens a call window (/?call=<appointmentId>). "Open in new window" button on the panel.
- In-call chat (same appointment chat): text, photos (inline preview), audio, video, PDF. Unread badge.
- Help tab: Bangla <-> English AI translation, 11 one-tap phrases, troubleshooting tips. Language choice for speech transcript (English/Bangla).
- Call timer, switch camera, screen share (desktop), browser full screen, keep-screen-awake, warning before closing tab mid-call.

## Admin
- Force-end any call (Live monitoring + Messages & calls) – POST /admin/appointments/:id/end-call, audit logged.
- Admin already can watch/listen and read/send chat; PDF/photo files visible in chat.

## API
- POST /appointments/:id/translate, POST /admin/appointments/:id/end-call, CallSignal type admin_end, PDF allowed as chat attachment.

## PWA
- manifest.webmanifest, sw.js (never caches API/uploads), icons, viewport-fit=cover.

## Noise cancellation
- Browser noise suppression + echo cancellation + auto gain always on; optional Strong noise filter (high/low-pass, soft gate, compressor) toggle in call (🎙️ / Help tab).
- render.yaml: no-cache headers for sw.js and manifest so app updates reach installed PWA/APK quickly.

## Full-screen fix
- Call fills the visible screen (visualViewport), page behind locked (no scroll/zoom), pinch/double-tap zoom blocked during call, browser fullscreen requested on tap, remote picture auto fit/fill + manual toggle.
