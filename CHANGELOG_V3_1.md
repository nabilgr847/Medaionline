# MedAI Hospital V3.1

## Fixed
- **GridFS "FileNotFound" (root cause):** uploads passed `_id` to the MongoDB driver, which ignores it, so the id saved in the database never existed in GridFS. Uploads now use `openUploadStreamWithId`. Files uploaded with V3.0 are recovered automatically by filename + owner + size (and the record is repaired); if truly missing the user gets a clear 410 "upload again" message instead of "Internal server error".
- **Report draft never reached the doctor:** the doctor was chosen only from appointments. Now: patient-chosen doctor, else last appointment doctor, else the active doctor with the fewest waiting reports. Admin is alerted only if no active doctor exists. Doctor gets a notification and the report appears in the pending list.
- **Prescription / imaging / lab are now separate:** the file type is detected (e.g. `signed-prescription.pdf`, retina/X-ray/ultrasound). Prescriptions are read (medicines as printed, no new advice), imaging reports are described without calling them normal/abnormal, lab reports keep the numeric rule engine.
- **Analysis PDF now follows your sample:** original image, review banner, report type/date/facility/patient, Summary, What stands out, What to do next ("AI DRAFT sent to Dr. X. Waiting for approval..."), Bangla summary, Tests to do, Medicines, When to see a doctor, Questions to ask, General tips, sources, results table (lab only), disclaimer. Doctor-approved PDF uses the same sections.
- **Security:** the password a person chose at sign-up is no longer stored (not even encrypted) and is never returned to the admin or put in an email. Approval just activates the account; the person signs in with their own password. Admin can still send a reset link or temporary password.

## Notes
- Bangla text in PDFs needs `NotoSansBengali-Regular.ttf` / `-Bold.ttf` in `apps/api/assets/fonts/` (the Bangla summary section is skipped in the PDF if they are missing; the on-screen card always shows it).
- Not run here (no network): `npm install`, `npm run build`, MongoDB, OpenRouter, pdfkit. Unit tests (15) and `node --check` pass. Run `npm install && npm test` in `apps/api` and `npm run build` in `apps/web` before deploying.
- Re-upload one old report after deploying to confirm; older files are recovered automatically when possible.

## V3.1 update 2: report view + prettier PDF
- **In-app analysis now looks like your sample PDF:** original image, review-priority line, report type/date/facility/patient, Normal/High/Low counts (lab), Summary, What stands out, What to do next, Bangla summary, Tests to do, Medicines, When to see a doctor, sources (with links), All results and ranges, Questions, Tips. Used in the MedAI Assistant chat and in Patient > My reports > "View analysis".
- **Doctor-approval tracker:** 3 steps (AI analysis, Sent to doctor, Doctor approval) plus a status box: "AI DRAFT sent to Dr. X. Waiting for approval. Do not take any medicine yet." It updates by itself every 30 s (and with "Check status") to In review / Changes requested / Not approved / Approved, and the doctor-approved PDF button appears after approval.
- **PDF redesigned:** original image next to a details card, approval tracker, coloured section cards, results table, disclaimer; the doctor-approved PDF uses the same layout with the tracker fully completed.
