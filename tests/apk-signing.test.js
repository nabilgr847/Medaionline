// © 2026 MD Gausur Rahman Nabil. All rights reserved. MedAI Hospital.
// The APK must be signed on every build. A GitHub secret that is not defined arrives as an
// EMPTY string, which once produced `storePassword ""` and failed `gradle assembleRelease`
// after everything else had passed. This test runs the real patch script against a mock
// Android project so that class of bug cannot come back silently.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, cpSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = join(repo, "apps/mobile/scripts/patch_android.py");

const GRADLE = `apply plugin: 'com.android.application'

android {
    namespace "com.medai.hospital"
    compileSdk 34

    defaultConfig {
        applicationId "com.medai.hospital"
        versionCode 1
        versionName "1.0"
    }

    buildTypes {
        release {
            minifyEnabled false
        }
    }
}
`;

const MANIFEST = `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <application android:allowBackup="true">
    </application>
</manifest>
`;

/** Build a throwaway Android project that looks like `npx cap add android` output. */
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "medai-apk-"));
  const mobile = join(dir, "apps/mobile");
  mkdirSync(join(mobile, "scripts"), { recursive: true });
  mkdirSync(join(mobile, "native"), { recursive: true });
  cpSync(SCRIPT, join(mobile, "scripts/patch_android.py"));
  cpSync(join(repo, "apps/mobile/native/MainActivity.java.tpl"), join(mobile, "native/MainActivity.java.tpl"));
  cpSync(join(repo, "apps/mobile/medai-release.jks"), join(mobile, "medai-release.jks"));

  const main = join(mobile, "android/app/src/main");
  mkdirSync(join(main, "java/com/medai/hospital"), { recursive: true });
  writeFileSync(join(main, "AndroidManifest.xml"), MANIFEST);
  writeFileSync(join(main, "java/com/medai/hospital/MainActivity.java"),
    "package com.medai.hospital;\npublic class MainActivity {}\n");
  writeFileSync(join(mobile, "android/app/build.gradle"), GRADLE);
  writeFileSync(join(mobile, "android/gradle.properties"), "org.gradle.jvmargs=-Xmx2048m\n");
  return { dir, mobile, buildGradle: join(mobile, "android/app/build.gradle") };
}

function run(mobile, env) {
  return execFileSync("python3", [join(mobile, "scripts/patch_android.py")], {
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
}

test("the patch script and keystore are present", () => {
  assert.ok(existsSync(SCRIPT));
  assert.ok(existsSync(join(repo, "apps/mobile/medai-release.jks")), "the release keystore is missing");
});

test("an undefined secret does not sign the APK with an empty password", () => {
  const { mobile, buildGradle } = fixture();
  run(mobile, { MEDAI_STORE_PASSWORD: "" });        // this is what GitHub sends for an unset secret
  const gradle = readFileSync(buildGradle, "utf8");
  assert.match(gradle, /storePassword "medaiapp2026"/, "must fall back to the built-in password");
  assert.doesNotMatch(gradle, /storePassword ""/, "an empty password breaks gradle signing");
  assert.match(gradle, /signingConfig sign.*medai/, "both build types must use the release key");
  assert.match(gradle, /enableV1Signing true/);
});

test("a configured secret is used as-is", () => {
  const { mobile, buildGradle } = fixture();
  run(mobile, { MEDAI_STORE_PASSWORD: "rotated-password-2026" });
  assert.match(readFileSync(buildGradle, "utf8"), /storePassword "rotated-password-2026"/);
});

test("a whitespace-only secret is treated as unset", () => {
  const { mobile, buildGradle } = fixture();
  run(mobile, { MEDAI_STORE_PASSWORD: "   " });
  assert.match(readFileSync(buildGradle, "utf8"), /storePassword "medaiapp2026"/);
});

test("the workflow hands the secret to the patch step", () => {
  const yml = readFileSync(join(repo, ".github/workflows/build-apk.yml"), "utf8");
  assert.match(yml, /MEDAI_STORE_PASSWORD: \$\{\{ secrets\.MEDAI_STORE_PASSWORD \}\}/);
  assert.match(yml, /assembleRelease/);
});
