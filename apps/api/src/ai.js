// © 2026 MD Gausur Rahman Nabil. All rights reserved. MedAI Hospital.
// One place for every AI call. Built for FREE OpenRouter models (":free"), which are often
// rate limited (429), text-only, strict about the "system" role, and fail with 402 when max_tokens is too large.
import { config } from "./config.js";

const URL = "https://openrouter.ai/api/v1/chat/completions";
const sleep = ms => new Promise(r => setTimeout(r, ms));
const list = v => String(v || "").split(",").map(s => s.trim()).filter(Boolean);

export function hasImage(messages) {
  return messages.some(m => Array.isArray(m.content) && m.content.some(p => p?.type === "image_url"));
}
function stripImages(messages) {
  return messages.map(m => Array.isArray(m.content)
    ? { ...m, content: m.content.filter(p => p?.type !== "image_url").map(p => p.text || "").join("\n") }
    : m);
}
function mergeSystem(messages) {
  const sys = messages.filter(m => m.role === "system").map(m => (typeof m.content === "string" ? m.content : "")).join("\n");
  const rest = messages.filter(m => m.role !== "system").map(m => ({ ...m }));
  if (!sys) return rest;
  const i = rest.findIndex(m => m.role === "user");
  if (i < 0) return [{ role: "user", content: sys }];
  const u = rest[i];
  rest[i] = { ...u, content: Array.isArray(u.content) ? [{ type: "text", text: sys + "\n\n" }, ...u.content] : sys + "\n\n" + u.content };
  return rest;
}
// Order: vision model(s) first for images, then the main model, then fallbacks, de-duplicated.
export function modelChain({ vision } = {}) {
  const chain = [];
  if (vision) chain.push(...list(process.env.OPENROUTER_VISION_MODEL));
  chain.push(config.openRouterModel);
  chain.push(...list(process.env.OPENROUTER_FALLBACK_MODELS));
  // Safety net for free-tier users: OpenRouter's free router picks any free model that is up right now.
  if (/:free$/.test(config.openRouterModel) && !chain.includes("openrouter/free")) chain.push("openrouter/free");
  return [...new Set(chain.filter(Boolean))];
}
const fail = (message, status = 502, extra = {}) => Object.assign(new Error(message), { status, expose: true, ...extra });

async function once(model, messages, { temperature, maxTokens, timeoutMs }) {
  let res;
  try {
    res = await fetch(URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.openRouterKey}`, "Content-Type": "application/json", "HTTP-Referer": config.clientOrigin, "X-Title": "MedAI Hospital" },
      body: JSON.stringify({ model, messages, temperature, max_tokens: maxTokens }),
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (e) {
    const timed = /timeout|abort/i.test(String(e?.name || e?.message));
    return { retry: true, error: timed ? "AI timed out" : "Could not reach the AI provider", status: 504 };
  }
  let data = null; try { data = await res.json(); } catch { /* non-JSON body */ }
  const err = data?.error; // OpenRouter sometimes returns HTTP 200 with an error object
  const code = Number(err?.code) || (!res.ok ? res.status : 0);
  const detail = String(err?.message || data?.message || "").slice(0, 220);
  if (code) return { code, detail, retryAfter: Number(res.headers.get("retry-after")) || 0, error: detail || `HTTP ${code}` };
  const text = data?.choices?.[0]?.message?.content;
  const out = Array.isArray(text) ? text.map(p => p?.text || "").join("") : text;
  if (!out || !String(out).trim()) return { code: 204, detail: "empty answer", error: "AI response was empty" };
  return { ok: true, text: String(out) };
}

/**
 * callAI(messages, {temperature, maxTokens, vision, timeoutMs}) -> string
 * Tries the model chain; retries 429/5xx/empty with backoff; fixes 402 (lower max_tokens) and
 * "system role not supported"; if an image cannot be read by any model, retries text-only (OCR text is still in the prompt).
 */
export async function callAI(messages, { temperature = 0.1, maxTokens = 1500, vision, timeoutMs = 50000 } = {}) {
  if (!config.openRouterKey) throw fail("AI provider is not configured. Add OPENROUTER_API_KEY on the server.", 503);
  const img = vision ?? hasImage(messages);
  const started = Date.now();
  const budgetLeft = () => 110000 - (Date.now() - started); // stay under typical proxy limits
  let last = null, tokens = maxTokens, textOnly = false;
  const tried = [];
  for (const model of modelChain({ vision: img })) {
    let msgs = textOnly ? stripImages(messages) : messages, merged = false, popped = false;
    for (let attempt = 0; attempt < 2; attempt++) {
      if (budgetLeft() < 8000) break;
      const r = await once(model, merged ? mergeSystem(msgs) : msgs, { temperature, maxTokens: tokens, timeoutMs: Math.min(timeoutMs, budgetLeft() - 2000) });
      if (r.ok) return r.text;
      last = r; tried.push(`${model}: ${r.code || r.status || "net"}`);
      if (r.code === 401 || r.code === 403) throw fail("AI provider key is invalid or has no access. Check OPENROUTER_API_KEY.", 503, { tried });
      if (r.code === 402) { // not enough credit for this many tokens: ask for fewer
        const m = /afford (\d+)/i.exec(r.detail || ""); const afford = m ? Number(m[1]) : 0;
        if (!popped && tokens > 400) { popped = true; tokens = Math.max(300, Math.min(Math.floor(tokens / 2), afford ? afford - 20 : tokens)); continue; }
        break;
      }
      if (r.code === 400 && /developer instruction|system (prompt|message|role)|instruction.*not enabled/i.test(r.detail || "") && !merged) { merged = true; continue; }
      if (r.code === 429 || r.code >= 500 || r.retry || r.code === 204) { // busy: short wait, then retry once / go to next model
        if (attempt === 0) await sleep(Math.min(8000, Math.max(1200, (r.retryAfter || 0) * 1000)));
        continue;
      }
      break; // 400/404 (e.g. model has no image support) -> next model
    }
  }
  // Nobody could read the image: continue with OCR text only, if there is any
  if (img && !textOnly) {
    const hasText = messages.some(m => Array.isArray(m.content) ? m.content.some(p => p?.type === "text" && String(p.text).length > 60) : false);
    if (hasText && budgetLeft() > 10000) { textOnly = true; try { return await callAI(stripImages(messages), { temperature, maxTokens, vision: false, timeoutMs }); } catch (e) { last = last || { error: e.message }; } }
  }
  const code = last?.code;
  const msg = code === 429 ? "The free AI is busy right now (rate limit). Please wait a minute and try again, or add a fallback model in OPENROUTER_FALLBACK_MODELS."
    : code === 402 ? "The AI account has no credit for this request. Use a :free model or add credit on OpenRouter."
    : code === 404 && img ? "The configured AI model cannot read images. Set OPENROUTER_VISION_MODEL to a vision-capable model."
    : last?.status === 504 ? "AI timed out. Try a smaller, clearer photo or fewer files at once."
    : "AI provider request failed" + (last?.detail ? ": " + last.detail : ".");
  throw fail(msg, code === 429 ? 429 : 502, { tried });
}

/** Parse JSON out of a model answer (handles ```json fences and chatter). Returns null when impossible. */
export function parseJsonLoose(raw) {
  const s = String(raw || "").replace(/```(?:json)?/gi, "");
  const m = s.match(/\{[\s\S]*\}/); if (!m) return null;
  try { return JSON.parse(m[0]); } catch { /* try trimming trailing commas */ }
  try { return JSON.parse(m[0].replace(/,\s*([}\]])/g, "$1")); } catch { return null; }
}

/** Lightweight live check used by the admin "Test AI" button. */
export async function pingAI() {
  const t = Date.now();
  const text = await callAI([{ role: "user", content: "Reply with the single word OK." }], { maxTokens: 20, temperature: 0, timeoutMs: 25000 });
  return { ok: true, ms: Date.now() - t, sample: text.slice(0, 40), models: modelChain() };
}
