# MedAI Hospital V3.10 — the "network problem" release

## Why
Patients kept seeing "network problem" on the phone and the website. The server was healthy:
it was **asleep**. Render stops an idle container, and the app gave up after 6 seconds, with
no retry on sign-in (a POST), and then blamed the user's connection.

## Fixed
- **Probe timeout 6 s → 20 s** and all candidate hosts are probed **in parallel** (was up to 60 s of sequential waiting).
- **Every request retries** with a backoff (0 s → 2.5 s → 7 s → 15 s). Network failures are retried for POST too, because a request that never arrived cannot be duplicated; 502/503/504 retried for idempotent calls.
- **45 s per-attempt timeout** so a dead connection cannot leave a spinner forever (uploads get 120 s).
- **Failure no longer sticks**: the cached host answer is cleared, so a later tap works instead of needing a page reload.
- **Uploads** retry three times and no longer say "check your connection" for a sleeping server.
- **Connection banner**: offline / waking / not-answering, with a Retry button; it probes again by itself when the phone comes back online.

## Installable app (PWA)
- "Install MedAI app" in the menu (Chrome/Edge/Android) and a one-time install card on the home page; iOS gets the Share → Add to Home Screen hint.
- "A new version is ready — Reload" toast when a fresh service worker takes over.
- Service worker cache v6 with a real **offline page** instead of a blank tab.

## Cleaner home page
- Removed the CARE, CONNECTED card set, the SAFETY BY DESIGN paragraph, the desktop "Services / Safety" links and the footer tagline.
- Emergency number kept as one line in the footer (999) — safety information should not disappear entirely.
- Dashboard greeting no longer carries a marketing subtitle.

## Phones
- 48dp minimum touch targets on buttons, inputs, tabs and menu rows; larger gaps between controls.
- `.emptystate` block for empty lists.

## Housekeeping
- `apps/web/.env.example` pointed at the **website** host; now the API host.
- The APK signing password can come from the `MEDAI_STORE_PASSWORD` secret (fallback keeps current builds working).
- New scheduled job `keep-api-awake` pings `/api/health` every 5 minutes so the free instance never sleeps.
- Tests: **46** (10 new guards for the PWA, the retry policy and the env template).
