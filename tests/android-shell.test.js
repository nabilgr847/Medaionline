// © 2026 MD Gausur Rahman Nabil. All rights reserved. MedAI Hospital.
// Guards for the Android start-up fix: the APK installed but closed the moment it was
// tapped, with no reason to act on. These tests keep the crash guard in place — an
// Application class that records every failed start, a report screen in its own process,
// a MainActivity that cannot die while starting, and a build that proves all of it.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const mobilePackage = JSON.parse(read("apps/mobile/package.json"));
const application = read("apps/mobile/native/MedAIApplication.java.tpl");
const report = read("apps/mobile/native/CrashReportActivity.java.tpl");
const activity = read("apps/mobile/native/MainActivity.java.tpl");
const patcher = read("apps/mobile/scripts/patch_android.py");
const workflow = read(".github/workflows/build-apk.yml");

test("the app records every failed start instead of closing silently", () => {
  assert.match(application, /extends Application/, "runs before any activity");
  assert.match(application, /setDefaultUncaughtExceptionHandler/, "catches every uncaught exception");
  assert.match(application, /last-crash\.txt/, "the reason is written to a file that can be sent back");
  assert.match(application, /printStackTrace/, "the full stack trace is kept, not just a message");
  assert.match(application, /CrashReportActivity/, "the reason is shown, not only logged");
});

test("the report screen survives the crash that opened it", () => {
  assert.match(report, /extends Activity/, "no appcompat dependency in the crash path");
  assert.match(report, /ClipboardManager/, "one tap copies the report for support");
  assert.match(patcher, /android:process=":crash"/, "it runs in its own process so it is not killed with the app");
  assert.match(patcher, /CrashReportActivity/, "and it is declared in the manifest");
});

test("a failing plugin or WebView cannot take the whole app down", () => {
  assert.match(activity, /catch \(Throwable/, "start-up is wrapped");
  assert.match(activity, /protected void load\(\)/, "Capacitor builds the bridge and loads plugins there");
  assert.match(activity, /super\.load\(\)/, "…and it is still Capacitor that builds it");
  assert.match(activity, /startupFailed\(/, "a failure is recorded and shown");
  assert.match(activity, /public void onRestart|public void onRestart\(\)/, "lifecycle guards for a missing bridge");
  assert.match(activity, /public void onSaveInstanceState/, "saving state must not crash a rescued app");
  assert.match(activity, /public void onDestroy/, "and neither must shutdown");
  // Original bug: addJavascriptInterface ran unguarded straight after super.onCreate().
  assert.match(activity, /attachNativeBridge\(\);/, "the native download/print bridge is attached defensively");
});

test("the patcher installs the guard and pins the Android levels", () => {
  assert.match(patcher, /android:name="\.MedAIApplication"/, "manifest points at the crash guard");
  assert.match(patcher, /appId|app_id/, "the real activity package is taken from capacitor.config.json");
  assert.match(patcher, /MainActivity\.java\.tpl/, "MainActivity is written from the template");
  assert.match(patcher, /MedAIApplication\.java\.tpl/, "the guard is written from its template");
  assert.match(patcher, /CrashReportActivity\.java\.tpl/, "the report screen is written from its template");
  assert.match(patcher, /minSdkVersion", 24/, "minSdk is fixed instead of whatever the template shipped");
  assert.match(patcher, /__PACKAGE__/, "an unsubstituted package is a build error");
});

test("the build refuses to publish an APK without the guard", () => {
  assert.match(workflow, /Verify the crash guard is in the Android project/, "sources are checked before building");
  assert.match(workflow, /Verify the guard is compiled into the APKs/, "and the classes are checked inside the dex");
  assert.match(workflow, /MedAIApplication/, "the guard class is what is looked for");
});

test("plugin versions are pinned so a build cannot change under us", () => {
  for (const [name, version] of Object.entries(mobilePackage.dependencies)) {
    assert.match(String(version), /^\d+\.\d+\.\d+$/, `${name} must be an exact version, not "${version}"`);
  }
  assert.equal(
    mobilePackage.dependencies["@capacitor/push-notifications"], undefined,
    "push notifications are gone until google-services.json exists; they only added Firebase to start-up",
  );
  assert.ok(mobilePackage.dependencies["@capacitor/local-notifications"], "medicine reminders still need local notifications");
  assert.ok(mobilePackage.dependencies["@aparajita/capacitor-biometric-auth"], "native fingerprint / face stays");
});

test("the web bundle is untouched by the native fix", () => {
  const main = read("apps/web/src/main.tsx");
  assert.match(main, /plugins\.PushNotifications/, "the web code still guards the optional plugin");
  const onboarding = read("apps/mobile/www/index.html");
  assert.match(onboarding, /nativeShell/, "the service worker is still skipped inside the app");
});
