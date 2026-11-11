// © 2026 MD Gausur Rahman Nabil. All rights reserved. MedAI Hospital.
import dotenv from "dotenv";
import path from "path";
dotenv.config();
// Do not crash the whole process on a missing variable: a crashed container only shows
// "Failed to fetch" to the web app / APK. Collect the problems instead, boot the HTTP
// server, and answer every request with the exact reason (see server.js).
export const configProblems = [];
for (const key of ["MONGODB_URI", "JWT_SECRET"]) if (!process.env[key]) configProblems.push(`Missing environment variable: ${key}`);
if (process.env.JWT_SECRET && process.env.JWT_SECRET.length < 32) configProblems.push("JWT_SECRET must be at least 32 characters");
if (configProblems.length) console.error("CONFIGURATION PROBLEM:", configProblems.join(" | "));
export const config = {
  port: Number(process.env.PORT || 4000),
  mongoUri: process.env.MONGODB_URI,
  jwtSecret: process.env.JWT_SECRET,
  jwtExpires: process.env.JWT_EXPIRES_IN || "1d",
  clientOrigin: process.env.CLIENT_ORIGIN || "http://localhost:5173",
  adminEmail: process.env.ADMIN_EMAIL?.toLowerCase().trim(),
  adminPassword: process.env.ADMIN_PASSWORD,
  openRouterKey: process.env.OPENROUTER_API_KEY,
  openRouterModel: process.env.OPENROUTER_MODEL || "openai/gpt-4o-mini",
  uploadDir: path.resolve(process.env.UPLOAD_DIR || (process.env.NODE_ENV === "production" ? "/var/data/uploads" : "./private_uploads")),
  maxUploadMb: Number(process.env.MAX_UPLOAD_MB || 12),
  smtpHost: process.env.SMTP_HOST || (process.env.SMTP_USER ? "smtp.gmail.com" : undefined), smtpPort:Number(process.env.SMTP_PORT||587),
  smtpSecure: process.env.SMTP_SECURE === "true", smtpUser:process.env.SMTP_USER,
  smtpPass:(process.env.SMTP_PASS||"").replace(/\s+/g,"")||undefined, smtpFrom:process.env.SMTP_FROM||(process.env.SMTP_USER?`MedAI Hospital <${process.env.SMTP_USER}>`:"MedAI Hospital <no-reply@example.com>"),
  requireAdminApproval: process.env.REQUIRE_ADMIN_APPROVAL === "true",
  appPublicUrl:process.env.APP_PUBLIC_URL||"http://localhost:5173",
  signingPrivateKey:process.env.PRESCRIPTION_SIGNING_PRIVATE_KEY_BASE64?Buffer.from(process.env.PRESCRIPTION_SIGNING_PRIVATE_KEY_BASE64,"base64").toString("utf8"):process.env.PRESCRIPTION_SIGNING_PRIVATE_KEY?.replace(/\\n/g,"\n"),
  signingPublicKey:process.env.PRESCRIPTION_SIGNING_PUBLIC_KEY_BASE64?Buffer.from(process.env.PRESCRIPTION_SIGNING_PUBLIC_KEY_BASE64,"base64").toString("utf8"):process.env.PRESCRIPTION_SIGNING_PUBLIC_KEY?.replace(/\\n/g,"\n"),
  smsProvider:process.env.SMS_PROVIDER||"other",
  twilioAccountSid:process.env.TWILIO_ACCOUNT_SID, twilioAuthToken:process.env.TWILIO_AUTH_TOKEN, twilioFrom:process.env.TWILIO_FROM,
  msg91ApiKey:process.env.MSG91_API_KEY, msg91SenderId:process.env.MSG91_SENDER_ID,
  stripeSecretKey:process.env.STRIPE_SECRET_KEY, stripeWebhookSecret:process.env.STRIPE_WEBHOOK_SECRET,
  bkashAppKey:process.env.BKASH_APP_KEY, bkashAppSecret:process.env.BKASH_APP_SECRET, bkashUsername:process.env.BKASH_USERNAME, bkashPassword:process.env.BKASH_PASSWORD,
  nagadMerchantId:process.env.NAGAD_MERCHANT_ID, nagadUsername:process.env.NAGAD_USERNAME, nagadPassword:process.env.NAGAD_PASSWORD,
  appName:process.env.APP_NAME||"MedAI Hospital", supportEmail:process.env.SUPPORT_EMAIL||"support@medai.example"
};
