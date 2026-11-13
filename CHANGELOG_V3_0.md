# MedAI Hospital V3.0

## Fixed
- **Password reset link** now opens a proper "Choose a new password" page. The link is `APP_PUBLIC_URL/?reset=TOKEN`, so it works even when the static host has no rewrite rule (the old `/reset-password` path showed the login page / 404). Page has confirm field, show-password and live rules.
- Reset also works when the user types their contact email, not only the login ID.
- Reset requests have their own limiter (15 per 15 min) instead of the shared 8 per 15 min.
- **Admin panel:** "Send reset link" (default, user chooses own password, valid 24 h) and "Send temporary password". Mail goes to the contact email.
- **Security:** admin panel no longer shows the password a patient chose at sign-up.
- Reset, OTP and admin emails are now branded HTML (with plain-text fallback).

## Report analysis (from ReportSimple V3)
- 22 reference tests with male/female and age-aware ranges, unit sanity check, printed-range conflict warning, OCR decimal-error detection, and plain-language "what it measures / what high or low may mean" text.
- Patient age and gender from the health profile are used automatically.

## Chatbot
- "AI information" replaced by **MedAI Assistant**: chat bubbles, typing indicator, suggestion chips, Bangla/English replies, voice input (browser dependent), "+" button to upload a lab report and get a colour-coded result card with PDF download.
- Rule-based emergency screen (chest pain, breathing, stroke, bleeding, self-harm...) runs before the AI and answers with 999 guidance.

## Medicine suggestions (doctor only)
- Prescription editor has "AI medicine ideas": generic names for a diagnosis, matched to verified Bangladesh brands in the catalogue, with automatic allergy and already-taking checks. No doses are suggested; the doctor decides.

## PDFs
- AI report, doctor-approved report and signed prescription now have the MedAI logo header, colour-coded results table, page numbers and footer. Printable prescription also has the logo.
- Bangla text: put `NotoSansBengali-Regular.ttf` and `NotoSansBengali-Bold.ttf` in `apps/api/assets/fonts/` (see README there).

## Not verified here
- pdfkit, MongoDB, SMTP, OpenRouter and the React build were not run in the build environment (no network). Unit tests for rules/safety pass; PDF code was smoke-tested with a mock. Run `npm install && npm test` in `apps/api` and `npm run build` in `apps/web` before deploying.

## V3.0.1: reset without admin
- Patient/doctor password reset no longer involves the admin: no admin request or notification is created.
- After the new password is saved (link or 6-digit code) the user is **signed in automatically**.
- To also remove admin approval at sign-up, set `REQUIRE_ADMIN_APPROVAL=false` on the API service (Render).
