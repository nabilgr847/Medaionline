# V3.6.4 Release validation status

## Source-level checks completed
- `node --check` passed for JavaScript source, scripts, and test files.
- Added temporary consultation guest-session, message, and WebRTC signaling endpoints.
- Added frontend guest consultation route and room UI.

## Not verified in this environment
- Frontend TypeScript/Vite production build: dependencies could not be installed because package installation timed out; therefore build status is **not verified**.
- API automated tests: dependency installation and live MongoDB were not available; test status is **not verified**.
- Guest/doctor room end-to-end flow: not run against a deployed API.
- Two-device camera/microphone/WebRTC connectivity: not tested.
- TURN relay: requires deployment-specific TURN service and credentials.
- MongoDB TTL index behavior and production backup/restore: not tested.

## Deployment gate
Do not label this release production-ready until the checks above pass in the target Render environment. Do not use real patient data until security, privacy, clinical-safety, backup/restore, and applicable Bangladesh legal/regulatory reviews are completed.
