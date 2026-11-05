# V3.6.5 fixes
- Guest room: doctor/admin can sign in inside the room and send messages as Doctor/Admin (previously a doctor on another browser silently joined as patient).
- Unassigned rooms are claimed by the first doctor who signs in; wrong-doctor errors are now shown instead of swallowed.
- Video: auto full screen when connected, tap to enlarge/minimize, mute/camera/end buttons (WhatsApp-style).
- "Request failed" / "Upload failed" on dashboard, AI chat and uploads: global rate limiter (180/15 min per IP) was exhausted by 1-second room polling. Limiter raised to 600, polling endpoints exempt (own 300/min limiter), JSON 429 message, friendlier client messages.
- Guest-room TURN: now also accepts TURN_USERNAME/TURN_CREDENTIAL (Metered). Before, guest video used TURN only with TURN_SHARED_SECRET, so mobile-network calls failed even with Metered configured. Added graceful SIGTERM/unhandledRejection handling and TURN env keys in render.yaml.
- Web: added an error screen (ErrorBoundary + startup check in index.html) so a crash or failed script load shows the real error instead of a blank page. Removed stale tsconfig.tsbuildinfo from the repo.
