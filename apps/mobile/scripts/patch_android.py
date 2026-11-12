"""Run after `npx cap add android`.
 - camera / microphone / network permissions for video calls
 - USE_BIOMETRIC permission for the fingerprint / face unlock screen
 - MedAI logo as the app icon (pre-made PNGs in apps/mobile/icons, no image library needed)
 - native file download + print bridge (apps/mobile/native/MainActivity.java.tpl)
"""
import os, re, shutil
from pathlib import Path

mobile = Path(__file__).resolve().parents[1]
android = mobile / "android"
main = android / "app/src/main"

# ---- permissions ----
manifest = main / "AndroidManifest.xml"
text = manifest.read_text()
perms = [
    "android.permission.INTERNET",
    "android.permission.CAMERA",
    "android.permission.RECORD_AUDIO",
    "android.permission.MODIFY_AUDIO_SETTINGS",
    "android.permission.WAKE_LOCK",
    "android.permission.VIBRATE",
    "android.permission.ACCESS_NETWORK_STATE",
    # fingerprint / face unlock for the app lock screen
    "android.permission.USE_BIOMETRIC",
    "android.permission.USE_FINGERPRINT",
]
add = "".join(f'    <uses-permission android:name="{p}" />\n' for p in perms if p not in text)
add += '    <uses-feature android:name="android.hardware.camera" android:required="false" />\n'
add += '    <uses-feature android:name="android.hardware.microphone" android:required="false" />\n'
add += '    <uses-feature android:name="android.hardware.fingerprint" android:required="false" />\n'
manifest.write_text(text.replace("</manifest>", add + "</manifest>"))
print("Manifest permissions added.")

# ---- app icon (MedAI logo) ----
res = main / "res"
src = mobile / "icons"
if src.is_dir():
    for folder in sorted(src.glob("mipmap-*")):
        dest = res / folder.name
        dest.mkdir(parents=True, exist_ok=True)
        for f in folder.glob("*.png"):
            shutil.copy2(f, dest / f.name)
    (res / "values").mkdir(parents=True, exist_ok=True)
    (res / "values/ic_launcher_background.xml").write_text(
        '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#FFFFFF</color>\n</resources>\n')
    print("App icon replaced with MedAI logo.")
else:
    print("WARNING: apps/mobile/icons not found, default icon kept.")


# ---- fixed signing key + rising version code, so a new APK UPDATES the installed app (no uninstall) ----
gradle = main.parents[1] / "build.gradle"
g = gradle.read_text()
run = int(os.environ.get("GITHUB_RUN_NUMBER", "1"))
g = re.sub(r"versionCode\s+\d+", f"versionCode {300000 + run}", g, count=1)
g = re.sub(r'versionName\s+"[^"]*"', f'versionName "3.8.{run}"', g, count=1)
keystore = mobile / "medai-release.jks"
if not keystore.exists():
    raise SystemExit(f"Signing key missing: {keystore}. The APK would be signed with a random debug key "
                     "and could never update an existing install.")
# The password comes from the environment (GitHub secret MEDAI_STORE_PASSWORD) when it is
# set, so it can be rotated without editing this file. The fallback keeps old builds working
# until that secret exists.
# An unset GitHub secret arrives as an EMPTY string, not as "missing" -- so `or` is required
# here. Reading it with a default made the build sign with storePassword "" and fail.
store_pass = (os.environ.get("MEDAI_STORE_PASSWORD") or "").strip() or "medaiapp2026"
if not store_pass:
    raise SystemExit("Signing password is empty - cannot sign the APK.")
if store_pass == "medaiapp2026":
    print("NOTE: using the built-in signing password; set the MEDAI_STORE_PASSWORD secret to override it.")
else:
    print("Signing with the password from MEDAI_STORE_PASSWORD.")
signing = (
    "    signingConfigs {\n        medai {\n"
    '            storeFile file("../../medai-release.jks")\n'
    f'            storePassword "{store_pass}"\n            keyAlias "medai"\n            keyPassword "{store_pass}"\n'
    # v1 (JAR) is what Android 6 uses to verify an APK; v2/v3 are used by newer versions.
    # Leaving any of them to chance is how a phone ends up saying "invalid package".
    "            enableV1Signing true\n            enableV2Signing true\n            enableV3Signing true\n"
    "        }\n    }\n"
)
if "signingConfigs.medai" not in g:
    g = g.replace("android {\n", "android {\n" + signing, 1)
# Both build types use the fixed key: a debug build and a release build of the same version
# are interchangeable on the device, so an update never fails with "app not installed".
g = g.replace("buildTypes {\n", "buildTypes {\n        debug {\n            signingConfig signingConfigs.medai\n        }\n", 1)
if "release {" in g and "signingConfig signingConfigs.medai" not in g.split("release {", 1)[1].split("}", 1)[0]:
    head, tail = g.split("release {", 1)
    g = head + "release {\n            signingConfig signingConfigs.medai" + tail
gradle.write_text(g)
print(f"Signing key fixed; versionCode {300000 + run}.")

# ---- packaging: extract native libraries + legacy packaging ----
props = android / "gradle.properties"
ptext = props.read_text() if props.exists() else ""
for line in ("android.useLegacyPackaging=true",):
    if line not in ptext:
        ptext = ptext.rstrip("\n") + "\n" + line + "\n"
props.write_text(ptext)
print("gradle.properties: legacy packaging enabled.")

manifest_text = manifest.read_text()
if 'android:extractNativeLibs' not in manifest_text:
    # Capacitor puts android: allowsBackup on <application>; append our attribute there.
    manifest_text = manifest_text.replace("<application", '<application android:extractNativeLibs="true"', 1)
    manifest.write_text(manifest_text)
    print("Manifest: extractNativeLibs=true (older installers need it).")

# ---- native bridge: downloads + print ----
tpl = (mobile / "native/MainActivity.java.tpl").read_text()
targets = list((main / "java").rglob("MainActivity.java"))
if not targets:
    raise SystemExit("MainActivity.java not found - cannot add native download support")
target = targets[0]
pkg = re.search(r"^\s*package\s+([\w.]+)\s*;", target.read_text(), re.M).group(1)
target.write_text(tpl.replace("__PACKAGE__", pkg))
print("Native download/print bridge added to", target.name)
print("Android project patched.")
