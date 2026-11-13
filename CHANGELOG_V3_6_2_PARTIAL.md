# MedAI Hospital V3.6.2 – additional messaging and temporary-access backend

This build continues from V3.6.1 partial.

## Added
- Direct message conversations between the active admin account and patient/doctor accounts.
- Direct message text and private image/audio/video attachments, using existing private file storage and authorization checks.
- Unread notification records and red badge counts for direct messages.
- Admin can start a direct conversation by searching active patients/doctors.
- Admin can issue a time-limited consultation access token; only the token hash is stored, the raw link is displayed once, and the access record has a MongoDB TTL expiry. Admin can close a link early.
- Temporary link endpoint rejects closed/expired tokens.

## Important limitations
- Temporary links currently validate/identify the consultation only. The complete guest consultation workspace (guest messaging, doctor-side room, WebRTC audio/video, media attachments, and deletion of all associated conversation data) is not implemented in this build.
- The reported Doctor Portal HTTP 500 cannot be conclusively fixed without reproducing the failing request against the deployed database/configuration. The API returns a request reference and stores the server-side error for Admin > Password & audit / system errors.
- Frontend dependency installation/build could not be run in this environment because npm registry access timed out. Backend JavaScript syntax checks passed; this is not a full integration or production test.
- Do not deploy to production until the remaining limitations are completed and the project is built/tested with the deployment environment variables and database.
