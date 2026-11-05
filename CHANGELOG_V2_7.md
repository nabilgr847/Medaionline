# V2.7 (step2 + step3 merged into V2.6)
- Banner slideshow, tab icons, red-dot badges, change password
- Doctor free-slot picker (only inside published availability), preferred time, propose/respond time
- Medicine suggestions show brand + generic
- Password-reset requests (admin Requests tab), recent signups
Env: HOSPITAL_TZ_OFFSET_MIN (default 360), SMTP_* for emailing new passwords.

## Fixes added during final check
- FIXED: "Provide a valid date range up to 31 days" red banner on doctor portal. Cause: new Date(String(Date.now())) is an Invalid Date. Fixed in /doctors/:id/availability and /doctors/:id/free-slots (the slot picker needed this too).
- Prescription PDF now shows brand name with generic: "Brand (generic)".

## Admin-approved new accounts
- Patient sign-up: name, email, phone (optional) and the patient's own password (min 12). Account is "pending_approval" and cannot sign in yet; login says "waiting for admin approval".
- All admins get a "New account request" notification (name, email, phone; the password is never shown or stored in plain text).
- Admin > Requests > New accounts: "Approve & email" activates the account and emails the person at their address. "Approve with new login..." lets the admin change the login ID and set/auto-create a new password, which is then emailed. If SMTP is not set, the admin is told to inform the person (new password shown once if one was created).
- Reject for requests; "New login details" for active users. Red dot on Requests tab counts pending requests.
- API: POST /admin/users/:id/issue-credentials, POST /admin/users/:id/reject-signup. New: user.contactEmail, status pending_approval.
- Doctors: still approved in Doctor verification.

## Admin can see the password the patient chose
- While a request is pending, the chosen password is kept encrypted (AES-256-GCM, key from JWT_SECRET) and shown to admins in Requests > New accounts. It is included in the approval email and then deleted (also deleted on reject).
- Keep JWT_SECRET stable: if it changes, pending passwords can no longer be shown.
