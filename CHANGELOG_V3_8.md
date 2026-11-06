# V3.8

## Logo consistency
- Website favicon, PWA icons (any + maskable + apple-touch) now use the same mark as the header logo and the Android app icon
  (blue cross, green heart, heartbeat line, white tile). Before, the favicon/PWA used a different white-cross-on-blue design.
- Service worker cache bumped to v3 so installed apps/PWA refresh the icon.

## AI prescription assistant (doctor)
- "✨ Suggest now" works with no typing: AI reads complaints, past history, old reports and earlier prescriptions.
- Returns working diagnosis, medicines (matched to verified Bangladesh brands, allergy/current-medicine warnings),
  suggested tests (priority, "advised before" flag), advice and follow-up. One tap adds a test / all tests / diagnosis / advice.
- Doses are still entered by the doctor (AI never suggests doses).

## Prescription format
- New clinical block: chief complaints, past history, past tests/reports, examination, vitals, diagnosis (auto-prefilled from the record),
  big Rx mark, medicines, advised tests, advice, follow-up, notes. Shown in the editor, print view, signed PDF and patient view.
- New fields are included in the Ed25519 signature; old prescriptions still verify.

## Admin recovery (System & recovery tab)
- Health checks (database, AI key, Gmail, signing keys, storage, errors) with the exact fix for each red item.
- One-click fixes: test email, test AI, rebuild indexes, clear stuck calls, resolve errors.
- "Someone cannot get in?": search user, see why, unlock/activate account (doctor verification is never bypassed).
- Locked-out admin: open /?recovery=1 and enter ADMIN_RECOVERY_KEY (auto-generated on Render) to reset the admin password.

## Combined report analysis (patient + doctor)
- Patient: pick 2+ analysed reports -> trends across dates, patterns, possible conditions (not a diagnosis), specialist, tests, urgency. English or Bangla.
- Flow: AI draft (clearly labelled) -> doctor reviews/edits -> approve -> patient sees the doctor-approved version. No doctor assigned -> admins are notified, any doctor can take it.
- Doctor can start one for their own patient and approve it.
