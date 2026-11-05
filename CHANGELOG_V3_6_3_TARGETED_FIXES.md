# V3.6.3 targeted fixes

- Fixed the report-based AI medicine suggestion audit path: it no longer dereferences `appt.id` when a report is the context.
- Added authenticated `/api/webrtc/ice-servers`; Google STUN remains enabled and Metered TURN is appended only when server-side TURN environment variables are configured.
- Updated appointment WebRTC peer connections to use the server-provided ICE configuration, retaining STUN fallback if the endpoint is unavailable.
- Finalized report actions now clear the open prescription/review editor state and await the refreshed report list so completed reviews appear in Reviewed history.
- Admin user search now debounces typing and ignores stale responses to reduce repeated slow requests and out-of-order results.
- Direct-message unread counts remain attached to the message tabs; admin unread count remains on Messages & calls.

## Render API environment variables for Metered
`TURN_URLS` (comma-separated URLs), `TURN_USERNAME`, `TURN_CREDENTIAL`. Keep these only on the API service. Rotate credentials exposed in screenshots or chat.

## Not yet completed / verified
The current temporary-consultation link endpoints still provide token validation and admin close only; a full guest chat/video room and doctor-side guest room UI are not implemented in this patch. The browser build and live two-device WebRTC test were not run in this environment because web dependencies could not be installed. Do not deploy this as a complete implementation of the full requested scope.
