"""Run after `npx cap add android`: camera/mic permissions for calls, app icon, portrait-free rotation."""
import re, shutil, subprocess, sys
from pathlib import Path

android = Path(__file__).resolve().parents[1] / "android"
manifest = android / "app/src/main/AndroidManifest.xml"
text = manifest.read_text()

perms = [
    "android.permission.INTERNET",
    "android.permission.CAMERA",
    "android.permission.RECORD_AUDIO",
    "android.permission.MODIFY_AUDIO_SETTINGS",
    "android.permission.WAKE_LOCK",
    "android.permission.VIBRATE",
    "android.permission.ACCESS_NETWORK_STATE",
]
add = "".join(f'    <uses-permission android:name="{p}" />\n' for p in perms if p not in text)
add += '    <uses-feature android:name="android.hardware.camera" android:required="false" />\n'
add += '    <uses-feature android:name="android.hardware.microphone" android:required="false" />\n'
text = text.replace("</manifest>", add + "</manifest>")
manifest.write_text(text)

# Launcher icon from the web app icon
icon = Path(__file__).resolve().parents[2] / "web/public/icons/icon-512.png"
res = android / "app/src/main/res"
if icon.exists():
    shutil.rmtree(res / "mipmap-anydpi-v26", ignore_errors=True)
    for d, px in {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}.items():
        folder = res / f"mipmap-{d}"
        folder.mkdir(parents=True, exist_ok=True)
        for name in ("ic_launcher.png", "ic_launcher_round.png", "ic_launcher_foreground.png"):
            subprocess.run(["convert", str(icon), "-resize", f"{px}x{px}", str(folder / name)], check=True)
print("Android project patched.")
