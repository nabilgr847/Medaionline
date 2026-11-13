# V3.8.2

## Free AI tokens: reliability (apps/api/src/ai.js)
- Every AI call now goes through one function: retries 429 (busy), tries fallback models, fixes 402 (lowers max_tokens),
  works with models that reject the "system" role, and if no model can read an image it retries with the OCR text only.
- Real error messages reach the user (before, most failures became "Internal server error").
- New optional env vars: OPENROUTER_FALLBACK_MODELS (comma list), OPENROUTER_VISION_MODEL, AI_LIMIT_PER_HOUR (default 80, was 20).
- Admin > System > Test AI shows the response time and the model chain in use.
- tests/ai.test.js covers 429, 402, system-role, image fallback, bad key.

## Many files at once
- My reports: "Send reports to a doctor": pick up to 10 files, tick earlier AI-analysed reports, one combined review + PDF goes to the doctor.
- AI assistant "+" button accepts several files; each is summarised, then one combined summary and one combined PDF.
- Failed files do not stop the others. Imaging/prescription reports can be combined too.
- New API: POST /reports/combine. Doctor can open the combined PDF.

## Typo-tolerant admin search
- Shared helper `fuzzyScore` (apps/api/src/util.js): 1-2 wrong/swapped letters, sound-alike spellings (gausur/gosur) and Bangla text still match.
- Admin Users, Patient reports (name, email, doctor, test name, file name, status and the 8-character report code), Conversations/appointments (new search box) and Medicine review all use it.
- Patient/doctor medicine search adds spelling-tolerant matches when few exact results exist.
- Reports show their Code. Search runs while typing.

## Prescription: tests by disease name
- New "Find tests by disease name" box above Advised tests: type a disease (misspelled is fine), tap a test to add it, or "Add all tests".
- Built-in checklist for ~25 common conditions works even when the free AI is busy; AI adds extra suggestions on top (API: POST /ai/test-suggestions).
- Tests only; no medicines are suggested here. Doctor decides.
