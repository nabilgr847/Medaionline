# MedAI Hospital -> GitHub (Google Colab, one cell).
# Deletes EVERYTHING in the repo and uploads the files of the zip you pick, as ONE commit.
# The commit to main starts the "Build Android APK" workflow automatically.
import os, zipfile, base64, json, time, getpass, urllib.request, urllib.error, shutil
from pathlib import Path

REPO, BRANCH = "nabilgr847/Medaionline", "main"
SKIP_DIRS = {".git", "node_modules", "__pycache__", "private_uploads", "dist"}

try:
    from google.colab import files
    print("Choose the MedAI zip file...")
    zipname = next(iter(files.upload()))
except ImportError:
    zipname = input("Path of the zip file: ").strip()
token = getpass.getpass("GitHub token (hidden): ").strip()

work = Path("/tmp/medai_new"); shutil.rmtree(work, ignore_errors=True); work.mkdir(parents=True)
zipfile.ZipFile(zipname).extractall(work)
root = next((p.parent.parent.parent for p in work.rglob("App.tsx") if p.parent.name == "src" and p.parent.parent.name == "web"), None)
root = root.parent if root and root.name == "apps" else root
if not root or not (root / "apps" / "api").exists():
    raise SystemExit("This zip does not look like the MedAI project.")
files_ = []
for base, dirs, names in os.walk(root):
    dirs[:] = sorted(d for d in dirs if d not in SKIP_DIRS)
    for n in sorted(names):
        if n == ".env" or (n.startswith(".env.") and n != ".env.gmail.example") or n.endswith(".pyc") or n == ".DS_Store":
            continue
        p = Path(base) / n; files_.append((p, p.relative_to(root).as_posix()))
print(f"{len(files_)} files found in the zip.")

def api(method, path, payload=None, tries=4):
    for t in range(tries):
        req = urllib.request.Request("https://api.github.com" + path, method=method,
            data=None if payload is None else json.dumps(payload).encode(),
            headers={"Authorization": "Bearer " + token, "Accept": "application/vnd.github+json", "User-Agent": "medai-colab",
                     **({"Content-Type": "application/json"} if payload is not None else {})})
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                raw = r.read(); return json.loads(raw) if raw else {}
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", "replace")[:600]
            if e.code in (500, 502, 503) and t < tries - 1: time.sleep(2 * (t + 1)); continue
            raise SystemExit(f"GitHub error {e.code} on {method} {path}: {body}")
        except urllib.error.URLError:
            if t < tries - 1: time.sleep(2 * (t + 1)); continue
            raise

repo = api("GET", f"/repos/{REPO}")
if not repo.get("permissions", {}).get("push"): raise SystemExit("This token cannot push to the repo.")
parent = api("GET", f"/repos/{REPO}/git/ref/heads/{BRANCH}")["object"]["sha"]
entries = []
for i, (p, rel) in enumerate(files_, 1):
    b = api("POST", f"/repos/{REPO}/git/blobs", {"content": base64.b64encode(p.read_bytes()).decode(), "encoding": "base64"})
    entries.append({"path": rel, "mode": "100644", "type": "blob", "sha": b["sha"]})
    if i % 25 == 0 or i == len(files_): print(f"uploaded {i}/{len(files_)}")
# No base_tree => every old file not in this list is deleted.
tree = api("POST", f"/repos/{REPO}/git/trees", {"tree": entries})
commit = api("POST", f"/repos/{REPO}/git/commits", {"message": "MedAI Hospital V3.8 - full replace", "tree": tree["sha"], "parents": [parent]})
api("PATCH", f"/repos/{REPO}/git/refs/heads/{BRANCH}", {"sha": commit["sha"], "force": True})
print("\nDONE. Old files deleted, new files uploaded:")
print(f"https://github.com/{REPO}/commit/{commit['sha']}")
time.sleep(8)
runs = api("GET", f"/repos/{REPO}/actions/runs?per_page=1").get("workflow_runs", [])
print("APK build:", runs[0]["html_url"] if runs else f"https://github.com/{REPO}/actions", "(takes about 5-8 minutes)")
print(f"APK download after it finishes: https://github.com/{REPO}/releases/tag/apk-latest")
