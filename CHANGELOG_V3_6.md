# MedAI Hospital V3.6 — Admin user search reliability

- Added indexed fields for user role/status, name, email and phone to improve common admin directory lookups.
- Improved `/admin/users` search: exact substring matches are prioritized; when they are sparse, a bounded fuzzy pass tolerates small spelling mistakes in names, email, phone, specialty and BMDC number.
- Kept role/status restrictions and the existing response contract unchanged.
- Backend syntax validation passed with `node --check`.

Note: This change intentionally does not claim implementation of the separately requested temporary consultation workflow, global role-to-role chat, admin-managed slot UI, or diagnosis of the reported doctor portal 500. Those require additional integration and runtime verification against the deployed database/storage configuration.

## V3.6.1 follow-up implementation
- Added an Admin Doctor Schedules workspace to view upcoming booked slots and manage each active doctor’s weekly availability.
- Added admin unread-message badge counts and included active administrators in appointment conversation message notifications.
- Existing appointment chat already supports text, image, audio and video attachments; the Admin conversation view uses that same secure appointment-scoped chat.
- Report review already separates pending reviews from finalized reports; approved/signed/delivered and rejected reports remain in history.

## V3.6.1 implementation notes
- Admin now has a Doctor schedules tab to inspect upcoming booked slots and edit weekly availability for active doctors.
- Fuzzy user search narrows typo candidates by indexed leading-character matches and uses a bounded fallback rather than scanning 2,500 users for every search.
- Admin unread-message counts now appear on the Messages & calls tab; active admins are notified when a patient or doctor sends a message in an appointment conversation.
- Appointment chat already supports text, image, audio and video attachments, including in the Admin conversation view.
- Generic API 500 responses now include a request reference so the exact server-side error can be located without exposing internals to patients.
- Finalized report statuses (signed/approved/delivered/rejected) are already separated from the To review queue and retained in the Reviewed / prescribe history.
