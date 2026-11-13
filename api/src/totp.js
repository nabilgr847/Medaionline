// © 2026 MD Gausur Rahman Nabil. All rights reserved. MedAI Hospital.
// RFC 4648 base32 + RFC 6238 TOTP, without a dependency.
//
// The previous code called `crypto.randomBytes(20).toString("base32")`. Node has no such
// encoding, so the two-factor setup threw `TypeError: Unknown encoding: base32` and the
// patient saw "Internal server error" — and that was the *only* thing protecting 2FA,
// because verification accepted any six digits. Both halves are fixed here.
import crypto from "node:crypto";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** RFC 4648 base32 (no padding) — the format authenticator apps expect. */
export function base32Encode(buf) {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(str) {
  const clean = String(str || "").toUpperCase().replace(/[\s=-]/g, "");
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of clean) {
    const idx = ALPHABET.indexOf(ch);
    if (idx === -1) throw new Error("Invalid base32 character");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** A new 160-bit secret, exactly what Google Authenticator / Authy expect. */
export function generateSecret(bytes = 20) {
  return base32Encode(crypto.randomBytes(bytes));
}

/** Human-readable recovery codes; stored hashed, shown once. */
export function generateBackupCodes(count = 8) {
  return Array.from({ length: count }, () => {
    const raw = crypto.randomBytes(5).toString("hex").toUpperCase();      // 10 hex chars
    return raw.slice(0, 5) + "-" + raw.slice(5);
  });
}

export function hashCode(code) {
  return crypto.createHash("sha256").update(String(code || "").trim().toUpperCase()).digest("hex");
}

/** RFC 4226 HOTP for a counter. */
export function hotp(secretBuffer, counter, digits = 6) {
  const msg = Buffer.alloc(8);
  msg.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  msg.writeUInt32BE(counter >>> 0, 4);
  const hmac = crypto.createHmac("sha1", secretBuffer).update(msg).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary = ((hmac[offset] & 0x7f) << 24) | (hmac[offset + 1] << 16) | (hmac[offset + 2] << 8) | hmac[offset + 3];
  return String(binary % 10 ** digits).padStart(digits, "0");
}

export const STEP_SECONDS = 30;

/** The code for a given moment. */
export function totp(secret, { time = Date.now(), step = STEP_SECONDS, digits = 6 } = {}) {
  return hotp(base32Decode(secret), Math.floor(time / 1000 / step), digits);
}

export const currentStep = (time = Date.now(), step = STEP_SECONDS) => Math.floor(time / 1000 / step);

/**
 * Checks a code from the authenticator app.
 *  - accepts the current step and ±`window` steps (clock skew)
 *  - refuses a step that was already used, so a code cannot be replayed
 * Returns { ok, step } — store `step` as lastStep after a success.
 */
export function verifyTotp(secret, token, { time = Date.now(), step = STEP_SECONDS, digits = 6, window = 1, lastStep = 0 } = {}) {
  const code = String(token || "").replace(/\s/g, "");
  if (!new RegExp(`^\\d{${digits}}$`).test(code)) return { ok: false, step: 0 };
  let secretBuffer;
  try { secretBuffer = base32Decode(secret); } catch { return { ok: false, step: 0 }; }
  const center = currentStep(time, step);
  const given = Buffer.from(code);
  for (let offset = -window; offset <= window; offset++) {
    const candidateStep = center + offset;
    if (candidateStep <= Number(lastStep || 0)) continue;        // already used: replay
    const expected = Buffer.from(hotp(secretBuffer, candidateStep, digits));
    if (expected.length === given.length && crypto.timingSafeEqual(expected, given)) {
      return { ok: true, step: candidateStep };
    }
  }
  return { ok: false, step: 0 };
}

/** otpauth:// URI that an authenticator app reads from a QR code. */
export function otpauthUrl({ secret, account, issuer = "MedAI Hospital" }) {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account || "")}`;
  const params = new URLSearchParams({ secret, issuer, algorithm: "SHA1", digits: "6", period: String(STEP_SECONDS) });
  return `otpauth://totp/${label}?${params.toString()}`;
}
