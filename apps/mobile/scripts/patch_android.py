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
signing = (
    "    signingConfigs {\n        medai {\n"
    '            storeFile file("../../medai-release.jks")\n'
    '            storePassword "medaiapp2026"\n            keyAlias "medai"\n            keyPassword "medaiapp2026"\n'
    "        }\n    }\n"
)
if "signingConfigs.medai" not in g:
    g = g.replace("android {\n", "android {\n" + signing, 1)
    g = g.replace("buildTypes {\n", "buildTypes {\n        debug {\n            signingConfig signingConfigs.medai\n        }\n", 1)
gradle.write_text(g)
print(f"Signing key fixed; versionCode {300000 + run}.")

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
