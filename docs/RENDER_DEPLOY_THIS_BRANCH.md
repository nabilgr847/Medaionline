# Deploy this branch to Render first (before merging to `main`)

You asked to see the new build on Render before it goes to `main`. This page is the
exact sequence, in order, with what to check after each step.

The branch is `arena/9980672b-medaionline` and it is already pushed to GitHub.

---

## 0. What you are about to deploy

| Area | What changes when this branch goes live |
| --- | --- |
| Design | Entirely new UI stylesheet (Inter/Manrope, contained tab grid, mobile layout). Same screens, same buttons — nothing to relearn. |
| Commercial panel | New section for patients/doctors/admins: plans, payments, invoices, 2FA setup, data export, pharmacy/lab orders, admin overview. |
| Medicine tracker | New "Medicine Tracker" tab: reminders, Taken/Skipped logging, adherence %. |
| Security tab | Fingerprint/face unlock switch (turns on from the Android app; the website shows it as Android-only). |
| API | New `apps/api/src/commercial.js` mounted at `/api/commercial`. Purely additive — old pages keep working. |

Nothing here needs a database migration. Mongo collections are created on first write.

---

## 1. Deploy order: **API first, then the website**

The API is backwards compatible with the old website. The new website is *not* compatible
with the old API (its new tabs would 404). So:

1. API service → deploy
2. Website service → deploy

If you do it the other way round, the new tabs show "Not found" until the API catches up.

---

## 2. Set the required environment variables first

Render → your **API** service → **Environment**. The API refuses to boot without these five:

| Key | Value |
| --- | --- |
| `MONGODB_URI` | your Atlas connection string |
| `JWT_SECRET` | 32+ random characters |
| `ADMIN_EMAIL` | your admin login email |
| `ADMIN_PASSWORD` | 12+ characters |
| `CLIENT_ORIGIN` | `https://medaionline-1.onrender.com` (your website URL) |

Recommended next: `APP_PUBLIC_URL`, `UPLOAD_DIR=/var/data/uploads`, the `SMTP_*` group
(email/codes), `OPENROUTER_*` (AI), `TURN_*` (video calls), `PRESCRIPTION_SIGNING_*` (signed
PDFs). Every key is documented with a working default in
[`apps/api/.env.example`](../apps/api/.env.example).

On the **website** service set `VITE_API_URL=https://medaionline-1.onrender.com`
(see [`apps/web/.env.example`](../apps/web/.env.example)).

> `VITE_*` values are baked into the browser bundle at build time, so the site must be
> rebuilt after you change them. That happens automatically on the next deploy.

Check the disk: the API service should have a disk mounted at `/var/data` (1 GB). Without
it, uploaded reports are lost every deploy.

---

## 3. Point the services at this branch

For **each** service (API, then website):

1. Render dashboard → open the service → **Settings**
2. **Build & Deploy** → **Branch** → pick `arena/9980672b-medaionline` → **Save**
3. **Manual Deploy** → **Deploy latest commit**
4. Watch the log. A healthy API deploy ends with:
   `MedAI Hospital API listening on <port>`
   and Render shows **Live** next to the service.

While you are in Settings, check the **Repository** field. Earlier failed builds mentioned
commits (`d9e8e277`, `08701c1`) that do not exist in this repository — if you see a different
repository or a very old branch there, that is exactly why those deploys failed.

---

## 4. Verify before telling anyone

From any terminal (or Render's Shell tab):

```bash
# 1. API is alive
curl -i https://medaionline-1.onrender.com/api/health
#    expect: {"status":"ok","service":"MedAI Hospital API"}

# 2. New routes are mounted (404 = old build still live, 401 = correct, auth required)
curl -i https://medaionline-1.onrender.com/api/commercial/plans

# 3. Website serves the new bundle
curl -s https://medaionline-1.onrender.com | grep -o 'assets/index-[^"]*'
```

Then in the browser:

- The home page shows the new typography and contained tab row (no sideways scrolling on a phone).
- Sign in as a patient → **Medicine Tracker** tab appears, add a reminder, press **Taken**,
  the adherence % appears at the top right.
- **Security** tab explains that biometric unlock works in the Android app.
- Sign in as admin → **Admin Overview** shows revenue/subscription counts (zeros on a fresh DB is fine).

---

## 5. Rollback (one click)

Settings → **Branch** → back to `main` → **Manual Deploy** → **Deploy latest commit**.
The database is untouched by a rollback: the new collections simply stop being used.

---

## 6. Important: this is a temporary state

While Render builds from the branch, **pushing to `main` does nothing** — and any earlier
`main` deploy hook still points at the old code. Two consequences:

- Do not treat the branch deploy as permanent.
- Once you are happy, merge the branch into `main` (pull request #1 from
  `arena/9980672b-medaionline`). After the merge, put both Render services back on `main`
  and deploy once more, so the next `main` push carries this work forward instead of
  silently overwriting it.

---

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| Build fails instantly, log mentions a commit you do not recognise | Service tracks another repository or a stale branch | Settings → Repository → re-link `nabilgr847/Medaionline`, branch `main` |
| `Missing environment variable: X` at boot | Required env var empty | Set it in Environment, then redeploy |
| `EACCES: permission denied, mkdir '/var/data'` | No disk mounted at `/var/data` | Add the 1 GB disk (Settings → Disks) or set `UPLOAD_DIR` to a writable path |
| API live but website shows "The MedAI API URL is not configured" | `VITE_API_URL` empty at build time | Set it on the website service, then **Manual Deploy** (rebuild, not restart) |
| Website loads, new tabs say "Not found" | Website deployed before the API | Deploy the API first, then hard-refresh |
| Doctor emails/codes never arrive | SMTP vars missing or Gmail app password instead of login password | Fill `SMTP_*`, see `.env.gmail.example` |
| Android app says "Network error" but the site works | `CLIENT_ORIGIN` lists only the website, so the WebView origin `https://localhost` is rejected | Fixed in this branch: the API always accepts the Capacitor origins; `CLIENT_ORIGIN` is now a comma-separated list for extra sites |
| Android app shows "The MedAI API URL is not configured" | APK was built without `VITE_API_URL` | Fixed in this branch: CI bakes `https://medaionline-1.onrender.com` in and fails the build if it is missing; set the repo variable `MEDAI_API_URL` to change it |
| Android app opens to a blank screen after an update | A service worker cached the old `index.html` inside the WebView | Fixed in this branch: the shell no longer registers a service worker and clears any that exist |
