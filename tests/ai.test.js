// © 2026 MD Gausur Rahman Nabil. All rights reserved. MedAI Hospital.
import test from "node:test";
import assert from "node:assert/strict";
process.env.MONGODB_URI ||= "mongodb://localhost/test"; process.env.JWT_SECRET ||= "x".repeat(40);
process.env.OPENROUTER_API_KEY = "k"; process.env.OPENROUTER_MODEL = "meta/free-a:free"; process.env.OPENROUTER_FALLBACK_MODELS = "meta/free-b:free";
const { callAI, parseJsonLoose } = await import("../apps/api/src/ai.js");
const ok = text => new Response(JSON.stringify({ choices: [{ message: { content: text } }] }), { status: 200 });
const err = (status, message) => new Response(JSON.stringify({ error: { code: status, message } }), { status, headers: { "retry-after": "0" } });
const real = globalThis.fetch;
const run = async (fake, fn) => { const calls = []; globalThis.fetch = async (_u, o) => { const b = JSON.parse(o.body); calls.push(b); return fake(b, calls.length); }; try { return await fn(calls); } finally { globalThis.fetch = real; } };

test("429 on first model falls through to the fallback model", async () => {
  const out = await run((b, n) => (b.model === "meta/free-a:free" ? err(429, "rate limited") : ok("hello")), async calls => { const t = await callAI([{ role: "user", content: "hi" }], { maxTokens: 100 }); assert.ok(calls.some(c => c.model === "meta/free-b:free")); return t; });
  assert.equal(out, "hello");
});
test("402 lowers max_tokens and retries", async () => {
  await run((b, n) => (n === 1 ? err(402, "You requested up to 2000 tokens, but can only afford 500") : ok("fine")), async calls => { const t = await callAI([{ role: "user", content: "hi" }], { maxTokens: 2000 }); assert.equal(t, "fine"); assert.ok(calls[1].max_tokens < 500); });
});
test("system role rejected -> merged into user message", async () => {
  await run((b, n) => (n === 1 ? err(400, "Developer instruction is not enabled for this model") : ok("merged")), async calls => { const t = await callAI([{ role: "system", content: "SYS" }, { role: "user", content: "Q" }]); assert.equal(t, "merged"); assert.ok(!calls[1].messages.some(m => m.role === "system")); assert.match(calls[1].messages[0].content, /SYS/); });
});
test("no model can read the image -> text-only retry with OCR text", async () => {
  const img = [{ type: "text", text: "OCR text of the report ".repeat(10) }, { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } }];
  await run(b => (JSON.stringify(b.messages).includes("image_url") ? err(404, "No endpoints found that support image input") : ok("from-ocr")), async () => { assert.equal(await callAI([{ role: "user", content: img }]), "from-ocr"); });
});
test("invalid key is a clear error", async () => {
  await run(() => err(401, "No auth"), async () => { await assert.rejects(callAI([{ role: "user", content: "x" }]), /key is invalid/); });
});
test("parseJsonLoose handles fences and trailing commas", () => {
  assert.deepEqual(parseJsonLoose('```json\n{"a":1,}\n```'), { a: 1 });
  assert.equal(parseJsonLoose("no json"), null);
});
