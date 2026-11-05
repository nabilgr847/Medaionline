# MedAI Hospital V3.6.4 — Guest consultation room implementation

## Added
- Time-limited guest session token issued only after validating the original one-time consultation link.
- Guest chat with bounded message length and retained latest 500 messages per temporary room.
- Authenticated assigned-doctor / issuing-admin room access.
- Guest and clinician WebRTC offer/answer/ICE/hangup signaling, with signal records expiring automatically.
- Room APIs reject expired or administratively closed consultations; guest access is checked on every request.
- Guest consultation page at `/?consult=<one-time-token>` with chat and browser audio/video controls.

## Security boundaries
- The raw invitation token is stored only as a SHA-256 hash in MongoDB and is returned only at creation.
- Guest session JWT is short-lived and bound to one consultation ID; it does not create a general MedAI user account.
- Clinician room APIs require an active authenticated account matching the assigned doctor or issuing administrator.
- Temporary room messages are limited to 3,000 characters; only the latest 500 are retained.
- WebRTC media is peer-to-peer; signaling metadata is stored temporarily. This release does not record guest calls.

## Known production requirements / limitations
- Configure TURN for reliable calls across restrictive NAT/firewall networks. STUN-only connectivity is not guaranteed.
- The room uses periodic HTTP polling, not WebSocket/SFU infrastructure; this is suitable for a small initial workload, not a high-concurrency telehealth service.
- No guest file attachments, identity proofing, e-prescription, medical-record integration, or call recording are enabled in the guest room.
- Run dependency installation, frontend production build, API test suite, MongoDB integration tests, and real two-device call tests before deploying.
- This is not a clinical or regulatory certification. Complete security/privacy/clinical review and incident-response planning before handling real patient data.
