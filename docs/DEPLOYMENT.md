# Deploy with GitHub and Render

## This deployment has two Render services

| Render service | Type | Address | Role |
|---|---|---|---|
| `Medaionline` | web (Node) | `https://medaionline.onrender.com` | **API / backend** — answers `/api/health` with JSON |
| `Medaionline-1` | static | `https://medaionline-1.onrender.com` | **website / frontend** — only serves the built React app |

Rules that follow from this:

- The frontend's `VITE_API_URL` must be the **backend** host. The website host answers
  every path with `index.html`, so pointing the app at it can only produce "Failed to fetch".
- The app now refuses to use the website host as the API (`FRONTEND_HOSTS` in
  `apps/web/src/api.ts`) and skips it while auto-detecting, so an old `VITE_API_URL` no
  longer breaks a fresh build — but fix it anyway.
- The backend's `CLIENT_ORIGIN` must list the website host:
  `https://medaionline-1.onrender.com` (comma-separated list is supported).
- The APK bakes the API address at build time (`vars.MEDAI_API_URL`, default
  `https://medaionline.onrender.com`), and can be corrected after installation from the
  sign-in screen's **Server address** panel — no need to log in first.
- The sign-in screen's **Test connection** button reports which one of the four states the
  address is in: reachable / blocks this app (CORS) / is the website, not the API / no answer.

## Sign-in screen: connection diagnostics and biometric login

- The `Server:` / `Test connection` / `Server address` block is **hidden** on the public
  sign-in page. Add `?debug=1` to the URL (e.g.
  `https://medaionline-1.onrender.com/?debug=1`) to show it, or use
  **Settings → Security** once signed in.
- **Fingerprint / face sign-in** (Android app only):
  1. Sign in with the password once. The app offers *"Use fingerprint next time?"*.
  2. Turn it on — the session is stored in a separate slot (`medai_bio_token`).
  3. Next launch: the lock screen appears and the device prompt opens automatically, and
     the sign-in page also offers *"Sign in with fingerprint"*.
  4. A real **Sign out** (menu) deletes that stored session; *"Use password instead"* on the
     lock screen keeps it, so fingerprint sign-in still works afterwards.
  5. No sensor enrolled → the app says so instead of failing silently; Settings → Security →
     *Test* verifies the prompt without signing out.

## "Failed to fetch" — the site or app cannot reach the API

The web app and the APK now say **exactly** what is wrong instead of a generic network error.
Work through these in order:

1. **Open `https://<API-host>/api/health` in a browser.** The API always answers now, even
   when the deployment is broken:
   - `{"status":"ok",...}` → the API is healthy; the problem is the site's build or CORS
     (see step 4).
   - `{"status":"misconfigured","problem":"Missing environment variable: MONGODB_URI ..."}`
     → Render → your API service → **Environment** → add the named variable → save
     (Render redeploys automatically). `MONGODB_URI` is your Atlas connection string;
     `JWT_SECRET` can use the **Generate** button (needs 32+ characters).
   - `{"error":"Server configuration incomplete — ..."}` on any other route means the same
     thing: the list of missing variables is printed in the message.
   - **502 / "Application failed to start" / no answer at all** → the service is not running.
     Check Render → API service → **Logs** (top lines) and the **Events** tab.
2. **Plan and disk.** `render.yaml` asks for a `starter` plan plus a 1 GB disk, which a free
   account cannot create — the deploy then fails and the URL stays dead. On a free account
   deploy **`render.free.yaml`** instead (identical app, `UPLOAD_DIR=/tmp/uploads`).
3. **Admin variables are optional.** `ADMIN_EMAIL` / `ADMIN_PASSWORD` may be empty; the API
   then skips admin provisioning and still boots.
4. **CORS.** `CLIENT_ORIGIN` must be the site URL, e.g. `https://medaionline-1.onrender.com`.
   The Android WebView origins (`https://localhost`, `http://localhost`, `capacitor://localhost`)
   are always allowed by `apps/api/src/cors.js`, so the APK does not need extra entries.
5. **Frontend address.** `VITE_API_URL` is baked in at build time, but the app also
   auto-detects the API host at runtime (it probes `/api/health`) and remembers the working
   one. You can override it any time: **Security tab → Test connection → Advanced: set the
   server address by hand**, or open the site once with `?api=https://your-api.onrender.com`.

## GitHub from Colab
- Upload the ZIP to Colab and extract it.
- Change directory into `MedAI_Hospital_V2_Full_MVP`.
- Upload/push its contents to the GitHub repository root.
- Never commit `.env`, private_uploads, database credentials, AI keys, or patient data.

## MongoDB Atlas
- Create a dedicated database user with a strong password.
- Restrict network access to the hosting provider where practical.
- Put the connection URI in Render `MONGODB_URI`, not in code.

## Render
- Connect the GitHub repository and use `render.yaml`.
- Use `render.yaml` on a paid plan, or `render.free.yaml` on the free plan (no disk).
- Only `MONGODB_URI` is mandatory: `JWT_SECRET` is generated by the blueprint, and
  `ADMIN_EMAIL` / `ADMIN_PASSWORD` / `CLIENT_ORIGIN` / `OPENROUTER_API_KEY` are optional
  (the API boots without them and reports what is missing at `/api/health`).
- The blueprint links the web service's `VITE_API_URL` to the API service automatically; if
  you deploy the services by hand, set `VITE_API_URL` to the API URL (the app also auto-detects).
- Ensure frontend and API domains match the CORS origin.
- Verify `/api/health`.

## Admin
Set a private unique `ADMIN_EMAIL` and strong `ADMIN_PASSWORD` in Render before first API startup. No admin credentials are embedded in the ZIP.

## Uploads and routing (V2.1)
- `render.yaml` mounts a persistent disk at `/var/data` and sets `UPLOAD_DIR=/var/data/uploads`. Disks need a paid Render plan; on a free plan uploaded files disappear on every deploy.
- The static site has a rewrite to `/index.html` so password-reset links (`/reset-password?token=...`) work.
- Set `CLIENT_ORIGIN` and `APP_PUBLIC_URL` to the deployed web URL, `VITE_API_URL` to the API URL.

## Important: persistent private file storage

The API stores private upload metadata in MongoDB and the file bytes in `UPLOAD_DIR`. These must remain available together. If the bytes disappear while the MongoDB record remains, downloads, OCR, and prescription signing cannot read the file.

- **Render Free:** the service filesystem is ephemeral. Do not use it as the only storage for medical reports, doctor signature images, or finalized PDFs. A restart/deploy can remove uploaded bytes while metadata remains in MongoDB.
- **Render with a persistent disk:** attach a disk mounted at `/var/data` and set the API environment variable `UPLOAD_DIR=/var/data/uploads`. The `render.yaml` blueprint declares this disk and a paid `starter` service plan.
- After changing `UPLOAD_DIR`, redeploy and test by uploading a harmless test PDF, then download it after a manual redeploy. Do not test persistence using real patient records.
- The API now returns HTTP 410 with a clear message if MongoDB references a file that is no longer present. This is a recovery response, not a way to restore deleted bytes.
- Files already missing from `/tmp/medai-uploads` cannot be recovered by this code patch. Re-upload affected files/signature images after persistent storage is configured.

If staying on Render Free, use a properly configured private object-storage provider (for example, an S3-compatible bucket) and implement its access controls before storing real patient information; changing `UPLOAD_DIR` to another ephemeral folder does not make files persistent.

## Permanent uploads: MongoDB Atlas GridFS (new in this build)
- New patient reports, doctor application documents, doctor signatures, consultation recordings, generated PDFs and other uploaded files are stored in the MongoDB database's `medai_uploads.files` / `medai_uploads.chunks` GridFS collections.
- The Render `/tmp` directory is no longer used as the source of truth for new uploads. `UPLOAD_DIR` is retained only for reading legacy local-file records; it is not the permanent store for new uploads.
- Use a MongoDB Atlas database with enough storage and a network/IP access rule that permits the Render service. GridFS shares the database's storage/backup/security responsibilities; enable Atlas backups and monitor storage usage.
- Existing `PrivateFile` records that point to old `/tmp` files cannot be reconstructed if Render already deleted those bytes. Those records return HTTP 410 and the patient/doctor must re-upload the original.
- This change has not been tested against your live Atlas cluster in this environment. Validate upload, download, delete, PDF analysis and doctor approval after deploying with a test account before production use.


## V2.6 report vision and monitoring configuration
- Set `OPENROUTER_API_KEY` and choose `OPENROUTER_MODEL` that supports image input if patients will analyze JPG/PNG/WEBP reports. The default model may change; verify the selected model's current vision support with a non-sensitive test image before enabling the workflow.
- The Admin Live Monitoring tab uses MongoDB-backed heartbeats and call-session records. Ensure the deployed MongoDB user can read/write the new `CallSession` collection and the application can create indexes.
- Presence is approximate (75-second threshold); Admin call sessions disappear from the active list after 90 seconds without a heartbeat. Admin sees metadata only, never call media.

## Optional TURN relay (Metered)
For WebRTC calls, the client requests authenticated ICE configuration from `/api/webrtc/ice-servers`. Keep Metered credentials on the API service only; never place them in Vite variables or commit them to Git.

Set these Environment variables on the Render API service (not the static frontend):
- `TURN_URLS`: comma-separated TURN URLs copied from Metered Instructions (for example `turn:global.relay.metered.ca:80,turn:global.relay.metered.ca:443,turns:global.relay.metered.ca:443?transport=tcp`).
- `TURN_USERNAME`: active Metered credential username.
- `TURN_CREDENTIAL`: active Metered credential password.

The API keeps Google STUN as the first ICE server and appends Metered TURN as a relay fallback. TURN quota is consumed only when traffic is relayed through TURN. Rotate any credential that has been exposed in screenshots or chat.
