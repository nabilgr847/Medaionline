# V3.8.3

## Disease knowledge base (Admin)
- New **Diseases** tab in Admin panel.
- Admin can add, edit, delete conditions used for “Find tests by disease name”.
- JSON import + downloadable JSON template.
- Downloadable **AI prompt template** so admin can generate structured disease entries with any AI and paste/import.
- Database-backed (`Disease` model). Seeded automatically from the previous hard-coded list on first use.
- Doctor test-suggestions prefer DB diseases, then fall back to the old checklist.

## Secret access code / QR payload (doctor & admin only)
- Every medical report and prescription can have a **secretAccessCode** (10-char, not derived from Mongo id).
- Endpoints:
  - `GET /reports/:id/secret-code`
  - `GET /prescriptions/:id/secret-code`
  - `POST /access-by-code` (resolve code → open files)
- **Patient never receives or sees the code.**
- Doctor Report review shows “🔑 Secret code” and an “Open by secret code” box.
- Access is audited (`AccessAudit`).

## Report model
- `secretAccessCode` + `simpleSummary` fields on MedicalReport.
- `secretAccessCode` on Prescription.

## Chatbot / Report analysis UI polish
- Clearer empty state: big “Upload report” + “Ask a question” buttons + chips.
- Progress hint while AI runs: “Reading file → extracting values → writing explanation…”.
- Retry button on error messages.
- Friendlier error bubbles.
- Mobile: history drawer behaviour prepared in CSS.
- New CSS: secret-code box, disease cards, simple-summary, ai-draft-warn, skeleton.

## Notes
- Full camera QR scan UI can be extended later with a QR library; `qrPayload` (`medai:report:CODE`) is already returned for that.
- Simple patient summary field is ready; populate from AI pipeline when desired.

## QR Scanner (doctor)
- **📷 Scan QR** button on Report review.
- Opens camera overlay; uses BarcodeDetector (Chrome/Edge) for live QR decode.
- Accepts `medai:report:CODE`, `medai:rx:CODE`, or plain code.
- On scan success → calls `/access-by-code` and opens the files.
- Secret code view also shows a QR image (for print / screenshot).
- Fallback: type the code if camera not available.
