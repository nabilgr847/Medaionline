# V2.8 + V2.9
## Email (Gmail App Password) features
- Sign-up: patient enters name, email, password -> a 6-digit code is emailed -> after entering the code the account opens and signs in automatically. Codes last 10 minutes, max 5 wrong tries, resend after 60 s.
- Set REQUIRE_ADMIN_APPROVAL=true if the admin must also approve after the code. If SMTP is not configured the old admin-approval flow is used.
- Forgot password: 6-digit code + new password on the sign-in page (the old email link still works). "Password changed" alert email.
- Email copies of notifications: new appointment request (doctor), appointment status/cancel/time proposal, prescription issued, report assigned/approved/rejected/changes requested, report awaiting review (doctor).
- Doctor application: approved / rejected / more-info emails. Welcome email after sign-up.
- Gmail needs only SMTP_USER + SMTP_PASS (see .env.gmail.example). Host defaults to smtp.gmail.com.
## Admin: Reports tab
- All reports with patient name/email/phone, AI analysis status, doctor review (Pending/Approved/Rejected), assigned doctor.
- Download buttons: patient's original report, AI PDF, Doctor-approved PDF (every open is written to the audit log).
- Unassigned reports: admin is notified and can assign/reassign a doctor; the doctor and patient get a notification (+ email) and the doctor can open the original file.
- Filters: review state, no doctor assigned, search by patient.

## V2.9 - full-screen calls
- Video/audio call opens full screen (remote video fills the screen, your camera is a small corner preview).
- Round buttons: mute mic, camera on/off, minimize (to reach recording consent/transcript, then "Back to full screen"), end call.
- If the other person ends the call, the screen closes and the camera/mic are released.
