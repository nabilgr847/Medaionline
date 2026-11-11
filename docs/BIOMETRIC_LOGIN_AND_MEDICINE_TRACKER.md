# Biometric Login & Medicine Adherence Tracker

Two features added on top of the V3.8.4 commercial build.

---

## 1. Fingerprint / face unlock (Android app)

### What it does

- A patient, doctor or admin turns on **Security → Fingerprint / face unlock**.
- Before turning it on, the app asks for a fingerprint once — this proves the person holding
  the phone is the account owner.
- From then on, when the MedAI Android app is opened with a saved session, a full-screen
  lock asks for the fingerprint (or face) instead of the password.
- If the app stayed in the background for more than **2 minutes**, it re-locks on resume.
- "Sign out and use password" on the lock screen clears the device session.

### Where the biometric data lives

Nowhere in MedAI. The fingerprint/face is matched by Android's own
`BiometricPrompt`, using `androidx.biometric` through the
[`@aparajita/capacitor-biometric-auth`](https://github.com/aparajita/capacitor-biometric-auth)
plugin. MedAI only stores two booleans on the user record:

```js
biometricEnabled: Boolean,
biometricType: "fingerprint" | "face" | "none"
```

The device also keeps a local flag (`localStorage: medai_biometric_lock = "1"`) so it knows
whether this phone should show the lock screen.

### Files

| File | Role |
| --- | --- |
| `apps/web/src/biometric.ts` | Thin wrapper: `checkBiometrics()`, `unlockWithBiometric()`, local flag helpers |
| `apps/web/src/App.tsx` | `BiometricLock` full-screen gate used by `MainApp` |
| `apps/web/src/CommercialPanel.tsx` | Security tab: turn on / off, test fingerprint |
| `apps/web/src/main.tsx` | Re-lock after 2 minutes in background (`appStateChange`) |
| `apps/web/src/style.css` | `.biolock`, `.biolock-card`, `.biolock-icon`, `.badge-ok` |
| `apps/mobile/scripts/patch_android.py` | Adds `USE_BIOMETRIC` + `USE_FINGERPRINT` permissions |
| `apps/api/src/commercial.js` | `POST /commercial/biometric/enable`, `GET /commercial/biometric/status` |
| `apps/api/src/models.js` | `biometricEnabled`, `biometricType` on `User` |

### API

```
GET  /api/commercial/biometric/status   → { enabled, type }
POST /api/commercial/biometric/enable   ← { enabled: bool, type: "fingerprint" | "face" | "none" }
```

Both require a bearer token. Enabling/disabling is written to the audit log.

### Behaviour outside the app

In a normal browser the plugin has no native bridge, so the Security tab explains that
the feature is Android-only and the "Turn on" button stays disabled. Nothing crashes.

### Requirements

- Android 6.0+ (API 23) with an enrolled fingerprint or face.
- The phone must have a PIN / pattern / password as a fallback — Android requires it.
- Build the APK through `.github/workflows/build-apk.yml`; it runs `npx cap sync android`,
  which registers the plugin natively.

---

## 2. Medicine Adherence Tracker (unique feature)

### Why it matters

A telemedicine visit only helps if the patient actually takes the medicine. MedAI already
writes prescriptions; this tracker closes the loop by letting the patient log each dose and
showing an adherence score that a doctor can read at the next visit.

### What the patient can do

- Add a reminder: medicine name, generic name, dosage, times per day, exact times,
  start date, instructions.
- Tap **Taken** or **Skipped** on each reminder as the day goes on.
- Delete a reminder that is no longer needed.
- See an adherence percentage (green ≥ 80 %, amber ≥ 50 %, red below) plus the last
  doses with timestamps.

### Data model

```js
MedicineReminder {
  patientId, medicineName, genericName, dosage,
  frequencyPerDay, timesOfDay: [String], startDate, endDate,
  instructions, active, createdBy: "patient" | "doctor"
}

MedicineIntakeLog {
  patientId, reminderId, takenAt,
  status: "taken" | "skipped" | "missed", notes
}
```

### API

```
GET    /api/commercial/medicine/reminders          → { reminders }
POST   /api/commercial/medicine/reminders          ← reminder body
PATCH  /api/commercial/medicine/reminders/:id      ← { medicineName?, timesOfDay?, active? }
DELETE /api/commercial/medicine/reminders/:id
POST   /api/commercial/medicine/intake             ← { reminderId, status, notes? }
GET    /api/commercial/medicine/intake/history?limit=30
GET    /api/commercial/medicine/adherence          → { adherence, total, taken, skipped, missed }
```

Every write is scoped to `req.user.id`, so one patient can never read or modify another
patient's reminders. Creating a reminder and logging a dose are both audit-logged.

### Adherence calculation

`adherence = round(taken / total * 100)` over the most recent 100 logged doses.

---

## Deployment notes

1. No new environment variables are required for either feature.
2. Push notifications (wired in the same release) need `google-services.json` from a
   Firebase project placed at `apps/mobile/android/app/` **before** the Gradle build;
   without it the app still runs, only push registration fails silently.
3. Rebuild the web bundle and refresh `apps/mobile/www` before cutting an APK:

```bash
cd apps/web && VITE_API_URL=https://medaionline-1.onrender.com npm run build
rm -rf ../mobile/www && cp -r dist ../mobile/www
```

4. Then push, and run the **Build MedAI Android APK** workflow.
