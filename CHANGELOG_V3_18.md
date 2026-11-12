# MedAI Hospital V3.18 — the app can no longer close silently at start-up

**Reported:** "APK install hocce but app on hoccena" — on Android 11–13 the APK installed
fine, but tapping the icon closed the app immediately, with no message to act on.

## Why the old build could do that

The Android shell started the WebView bridge, every native plugin, the splash screen and the
native download/print bridge in **one unguarded chain**:

```
SuperActivity.onCreate()  →  BridgeActivity.load()  →  bridge constructor  →  plugin.load() × 8
                          →  getBridge().getWebView().addJavascriptInterface(…)   ← unguarded
```

Any single failure anywhere in that chain — a plugin that throws while loading, a phone whose
**Android System WebView** is disabled or too old, a bridge that never finished building —
threw an exception and Android closed the app. Nothing was written down, so there was nothing
to fix and nothing to tell the user.

## What changed

1. **`MedAIApplication`** (new, `android:name=".MedAIApplication"`) runs before any activity and
   installs an uncaught-exception handler. Every failure is written to `last-crash.txt` with the
   phone model, Android version and full stack trace.
2. **`CrashReportActivity`** (new, `android:process=":crash"`) is opened instead of the app
   vanishing. It runs in its **own process**, so the crash that opened it cannot kill it, and it
   shows the report with a one-tap **Copy report** button. That text is what makes an unknown
   start-up failure fixable.
3. **`MainActivity` is now start-up-proof.** `onCreate` and Capacitor's `load()` (which builds the
   bridge and loads every plugin) are wrapped in `catch (Throwable …)`. A failing plugin or a
   missing WebView now shows "MedAI Hospital could not start — update Android System WebView"
   instead of closing. The native download/print bridge is attached defensively.
4. **Lifecycle guards** for the rescued state: `onRestart`, `onNewIntent`, `onSaveInstanceState`
   and `onDestroy` in Capacitor 6 dereference the bridge without a null check, which would have
   crashed a second time; all four are guarded now.
5. **Less to start up:** `@capacitor/push-notifications` is removed. It pulled Firebase into the
   process on every launch while the repository still has **no `google-services.json`**, so push
   could never have worked — it was pure start-up risk. Medicine reminders
   (`@capacitor/local-notifications`), native fingerprint/face (`@aparajita/capacitor-biometric-auth`),
   splash, status bar, haptics and app-state auto-lock are unchanged.
6. **Reproducible build:** every Capacitor dependency is pinned to an exact version (no more `^`),
   and the Android SDK levels are fixed at **minSdk 24 / compileSdk 34 / targetSdk 34** instead of
   inheriting whatever the freshly generated template shipped with.
7. **The build refuses to publish a blind APK.** Two new workflow steps fail the run if the guard
   is missing from the manifest or from the compiled `classes.dex`.

## Verification

- `apps/api` test suite: **124 / 124** (was 116). New: `tests/android-shell.test.js` (7 guards) and
  a fifth guard in `tests/apk-signing.test.js` that runs the real `patch_android.py` against a mock
  Android project and checks the guard lands in the app package.
- `patch_android.py` dry-run against a real `npx cap add android` template: manifest stays valid
  XML, the two extra attributes merge onto `<application>`, SDK levels rewritten, all three Java
  files written into the `com.medai.hospital` package with no `__PACKAGE__` left.
- All three Java files parse cleanly (javalang), including the new lifecycle overrides.

## If the app still closes after this build

It no longer closes silently. It will show **"MedAI Hospital needs one more fix"** with the exact
reason and a **Copy report** button — send that text back and the real cause can be fixed in one
pass. Most likely candidates it will name: a disabled/outdated Android System WebView, or one of
the native plugins failing to load.
