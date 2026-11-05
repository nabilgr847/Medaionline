import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
// Mirrors the 6-digit code helpers in apps/api/src/routes.js.
const secret = "x".repeat(32);
const genCode = () => String(crypto.randomInt(0, 1000000)).padStart(6, "0");
const hashCode = (uid, code) => crypto.createHash("sha256").update(`${uid}:${code}:${secret}`).digest("hex");
test("codes are always 6 digits", () => { for (let i = 0; i < 500; i++) assert.match(genCode(), /^\d{6}$/); });
test("hash binds the code to the user", () => {
  assert.equal(hashCode("u1", "123456"), hashCode("u1", "123456"));
  assert.notEqual(hashCode("u1", "123456"), hashCode("u2", "123456"));
  assert.notEqual(hashCode("u1", "123456"), hashCode("u1", "654321"));
});
