// © 2026 MD Gausur Rahman Nabil. All rights reserved. MedAI Hospital.
// Fingerprint / face sign-in for the BROWSER (WebAuthn platform authenticator).
//
// The Android app already unlocks with the phone's own biometric prompt
// (apps/web/src/biometric.ts). On a PC or in a mobile browser there is no such bridge, so
// the same idea is done with WebAuthn: Windows Hello (face or fingerprint), Touch ID,
// Android screen-lock biometrics, or a security key.
//
// Security notes that matter here:
//   * a credential is a PUBLIC key; the private key never leaves the phone/PC;
//   * the origin and RP ID are checked against an allowlist, never taken from the request;
//   * the signature counter is stored and must not go backwards (cloned-key detection);
//   * challenges are single-use, expire after 5 minutes and are bound to the user;
//   * a passkey login still refuses suspended / unapproved accounts.
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server";
import { WebAuthnCredential } from "./models.js";
import { config } from "./config.js";

/**
 * RP ID = the site's registrable domain. Passkeys are tied to it, so it must be stable in
 * production. `WEBAUTHN_RP_ID` / `WEBAUTHN_ORIGINS` let Render set the real values; the
 * defaults cover the deployed website and local development.
 */
export const RP = (() => {
  const rpID = (process.env.WEBAUTHN_RP_ID || "medaionline-1.onrender.com").trim().toLowerCase();
  const configured = (process.env.WEBAUTHN_ORIGINS || "")
    .split(",")
    .map((value) => value.trim().replace(/\/+$/, ""))
    .filter(Boolean);
  const origins = configured.length
    ? configured
    : [
        `https://${rpID}`,
        "http://localhost:5173",
        "http://localhost:4173",
        "http://127.0.0.1:5173",
        "http://127.0.0.1:4173",
      ];
  return { rpID, rpName: config.appName, origins };
})();

const CHALLENGE_TTL_MS = 5 * 60 * 1000;

/**
 * In-memory challenge store: a challenge only lives for the few seconds between the two
 * requests of one ceremony. Entries are single-use, so a replayed body cannot work.
 */
const challenges = new Map();

export function rememberChallenge(key, challenge) {
  const now = Date.now();
  for (const [storedKey, entry] of challenges) if (entry.expiresAt < now) challenges.delete(storedKey);
  challenges.set(key, { challenge, expiresAt: now + CHALLENGE_TTL_MS });
}

export function takeChallenge(key) {
  const entry = challenges.get(key);
  if (!entry) return "";
  challenges.delete(key);
  return entry.expiresAt < Date.now() ? "" : entry.challenge;
}

const toBase64 = (value) => Buffer.from(value).toString("base64url");
const fromBase64 = (value) => new Uint8Array(Buffer.from(String(value), "base64url"));

/** Public view of a stored credential — never includes the public key bytes. */
export const publicCredential = (row) => ({
  id: String(row._id),
  label: row.label || "This device",
  createdAt: row.createdAt,
  lastUsedAt: row.lastUsedAt,
});

export async function countCredentials(userId) {
  return WebAuthnCredential.countDocuments({ userId });
}

export async function listCredentials(userId) {
  const rows = await WebAuthnCredential.find({ userId }).sort({ createdAt: -1 });
  return rows.map(publicCredential);
}

/** Registration: options for adding THIS device's fingerprint / face to the account. */
export async function registrationOptions(user) {
  const existing = await WebAuthnCredential.find({ userId: user._id }).select("credentialId transports");
  const options = await generateRegistrationOptions({
    rpName: RP.rpName,
    rpID: RP.rpID,
    userID: new TextEncoder().encode(String(user._id)),
    userName: user.email,
    userDisplayName: user.name || user.email,
    attestationType: "none",
    excludeCredentials: existing.map((row) => ({ id: fromBase64(row.credentialId), transports: row.transports || undefined })),
    authenticatorSelection: {
      // A device the patient already carries: phone fingerprint/face, Windows Hello, Touch ID.
      authenticatorAttachment: "platform",
      residentKey: "preferred",
      userVerification: "required",
    },
  });
  rememberChallenge(`reg:${user.id}`, options.challenge);
  return options;
}

/** Registration: verify the browser's answer and store the public key. */
export async function registrationVerify({ user, response, label }) {
  const expectedChallenge = takeChallenge(`reg:${user.id}`);
  if (!expectedChallenge) throw new Error("This request expired. Please try again.");
  const verification = await verifyRegistrationResponse({
    response,
    expectedChallenge,
    expectedOrigin: RP.origins,
    expectedRPID: RP.rpID,
    requireUserVerification: true,
  });
  if (!verification.verified || !verification.registrationInfo) throw new Error("The fingerprint/face check could not be verified.");
  const { credential } = verification.registrationInfo;
  await WebAuthnCredential.findOneAndUpdate(
    { credentialId: toBase64(credential.id) },
    {
      $set: {
        userId: user._id,
        credentialId: toBase64(credential.id),
        publicKey: toBase64(credential.publicKey),
        counter: credential.counter || 0,
        transports: credential.transports || [],
        deviceType: verification.registrationInfo.credentialDeviceType || "",
        backedUp: !!verification.registrationInfo.credentialBackedUp,
        label: String(label || "This device").slice(0, 60),
      },
    },
    { upsert: true, new: true },
  );
  return true;
}

/** Authentication: options for signing in with a fingerprint / face already registered. */
export async function authenticationOptions(email) {
  const rows = await WebAuthnCredential.find({}).populate({ path: "userId", match: { email: String(email || "").toLowerCase().trim() }, select: "email status" });
  const owned = rows.filter((row) => row.userId);
  if (!owned.length) return null;
  const options = await generateAuthenticationOptions({
    rpID: RP.rpID,
    allowCredentials: owned.map((row) => ({ id: fromBase64(row.credentialId), transports: row.transports || undefined })),
    userVerification: "required",
  });
  rememberChallenge(`auth:${String(email).toLowerCase().trim()}`, options.challenge);
  return options;
}

/** Authentication: verify the assertion. Returns the credential owner (or throws). */
export async function authenticationVerify({ email, response }) {
  const key = String(email || "").toLowerCase().trim();
  const expectedChallenge = takeChallenge(`auth:${key}`);
  if (!expectedChallenge) throw new Error("This sign-in request expired. Please try again.");
  const credentialId = String(response?.id || "");
  if (!credentialId) throw new Error("No fingerprint/face credential was returned.");
  const row = await WebAuthnCredential.findOne({ credentialId }).populate("userId", "name email role status");
  if (!row || !row.userId) throw new Error("This device is not registered for this account.");
  const verification = await verifyAuthenticationResponse({
    response,
    expectedChallenge,
    expectedOrigin: RP.origins,
    expectedRPID: RP.rpID,
    requireUserVerification: true,
    credential: {
      id: fromBase64(row.credentialId),
      publicKey: fromBase64(row.publicKey),
      counter: row.counter || 0,
      transports: row.transports || undefined,
    },
  });
  if (!verification.verified) throw new Error("That fingerprint/face did not match.");
  row.counter = verification.authenticationInfo.newCounter;
  row.lastUsedAt = new Date();
  await row.save();
  return row.userId;
}
