// © 2026 MD Gausur Rahman Nabil. All rights reserved. MedAI Hospital.
// Two-factor authentication used to be broken twice over: setup crashed ("Unknown encoding:
// base32") and verification accepted ANY six digits. These tests pin the real thing down
// with the official RFC vectors, so it cannot silently regress again.
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
  base32Encode, base32Decode, generateSecret, generateBackupCodes,
  hashCode, hotp, totp, verifyTotp, otpauthUrl,
} from "../apps/api/src/totp.js";

// RFC 6238 uses the ASCII secret "12345678901234567890".
const RFC_SECRET = Buffer.from("12345678901234567890", "ascii");
const RFC_BASE32 = base32Encode(RFC_SECRET);

test("base32 round-trips and uses only the RFC 4648 alphabet", () => {
  const random = crypto.randomBytes(20);
  assert.deepEqual(base32Decode(base32Encode(random)), random);
  assert.match(base32Encode(random), /^[A-Z2-7]+$/);
  assert.equal(base32Encode(Buffer.from("12345678901234567890", "ascii")), "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
});

test("base32 decoding tolerates spaces and padding but rejects junk", () => {
  assert.deepEqual(base32Decode("GEZD GNBV"), base32Decode("GEZDGNBV"));
  assert.deepEqual(base32Decode("GEZDGNBV===="), base32Decode("GEZDGNBV"));
  assert.throws(() => base32Decode("GEZD1NBV"), /Invalid base32/);
});

test("RFC 6238 test vectors (SHA-1, 8 digits)", () => {
  const vectors = [
    [59, "94287082"],
    [1111111109, "07081804"],
    [1111111111, "14050471"],
    [1234567890, "89005924"],
    [2000000000, "69279037"],
    [20000000000, "65353130"],
  ];
  for (const [seconds, expected] of vectors) {
    assert.equal(totp(RFC_BASE32, { time: seconds * 1000, digits: 8 }), expected, `T=${seconds}`);
  }
});

test("HOTP counters match the RFC 4226 examples", () => {
  assert.equal(hotp(RFC_SECRET, 0), "755224");
  assert.equal(hotp(RFC_SECRET, 1), "287082");
  assert.equal(hotp(RFC_SECRET, 2), "359152");
});

test("a fresh secret is 32 base32 characters and unique", () => {
  const a = generateSecret();
  const b = generateSecret();
  assert.equal(a.length, 32);
  assert.match(a, /^[A-Z2-7]+$/);
  assert.notEqual(a, b);
});

test("the current code is accepted, a wrong one is not", () => {
  const secret = generateSecret();
  const now = 1_700_000_000_000;
  const good = totp(secret, { time: now });
  assert.equal(verifyTotp(secret, good, { time: now }).ok, true);
  const wrong = good === "000000" ? "111111" : "000000";
  assert.equal(verifyTotp(secret, wrong, { time: now }).ok, false);
  assert.equal(verifyTotp(secret, "12345", { time: now }).ok, false, "five digits");
  assert.equal(verifyTotp(secret, "abcdef", { time: now }).ok, false, "letters");
});

test("clock skew of one step is tolerated, three steps is not", () => {
  const secret = generateSecret();
  const now = 1_700_000_000_000;
  const previous = totp(secret, { time: now - 30_000 });
  const threeBack = totp(secret, { time: now - 90_000 });
  assert.equal(verifyTotp(secret, previous, { time: now, window: 1 }).ok, true);
  assert.equal(verifyTotp(secret, threeBack, { time: now, window: 1 }).ok, false);
});

test("the same code cannot be used twice (replay protection)", () => {
  const secret = generateSecret();
  const now = 1_700_000_000_000;
  const code = totp(secret, { time: now });
  const first = verifyTotp(secret, code, { time: now });
  assert.equal(first.ok, true);
  const second = verifyTotp(secret, code, { time: now, lastStep: first.step });
  assert.equal(second.ok, false, "a replayed code must be rejected");
});

test("backup codes are readable, unique and only comparable when hashed", () => {
  const codes = generateBackupCodes();
  assert.equal(codes.length, 8);
  assert.equal(new Set(codes).size, 8);
  for (const c of codes) {
    assert.match(c, /^[0-9A-F]{5}-[0-9A-F]{5}$/);
  }
  assert.equal(hashCode(codes[0].toLowerCase()), hashCode(codes[0]), "case-insensitive match");
  assert.notEqual(hashCode(codes[0]), codes[0], "stored value must not be the usable code");
});

test("the otpauth URI is what an authenticator app expects", () => {
  const secret = generateSecret();
  const url = new URL(otpauthUrl({ secret, account: "patient@example.com" }));
  assert.equal(url.protocol, "otpauth:");
  assert.equal(url.host, "totp");
  assert.equal(url.searchParams.get("secret"), secret);
  assert.equal(url.searchParams.get("issuer"), "MedAI Hospital");
  assert.equal(url.searchParams.get("digits"), "6");
  assert.equal(url.searchParams.get("period"), "30");
  assert.match(decodeURIComponent(url.pathname), /MedAI Hospital:patient@example\.com/);
});
