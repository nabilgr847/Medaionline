// © 2026 MD Gausur Rahman Nabil. All rights reserved. MedAI Hospital.
// V3.8: AI medicine + test suggestions, prescription prefill, combined multi-report analysis, admin recovery tools.
import mongoose from "mongoose";
import crypto from "crypto";
import fs from "fs/promises";
import rateLimit from "express-rate-limit";
import { User, Appointment, MedicalReport, Prescription, Medicine, MultiAnalysis, SystemError, CallSession, CallSignal, AuditEvent } from "./models.js";
import { auth, allow, hashPassword, audit } from "./security.js";
import { config } from "./config.js";
import { ageFromDob, normSex } from "./reportRules.js";
import { escapeRegex } from "./util.js";

const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const mk = (minutes, limit, error) => rateLimit({ windowMs: minutes * 60000, limit, standardHeaders: true, legacyHeaders: false, message: { error } });
const aiLim = mk(60, 30, "AI limit reached. Try again later.");
const recoveryLim = mk(60, 5, "Too many recovery attempts. Try again in an hour.");
const str = (v, n) => String(v ?? "").trim().slice(0, n);
const validId = id => mongoose.isValidObjectId(id);

// ---- clinical block of a prescription (history, complaints, past tests, etc.) ----
export const CLINICAL_KEYS = ["complaints", "history", "examination", "vitals", "diagnosis", "pastTests", "advice", "followUp"];
export function cleanClinical(raw) {
  const o = {}; raw = raw && typeof raw === "object" ? raw : {};
  for (const k of CLINICAL_KEYS) o[k] = str(raw[k], k === "history" || k === "pastTests" ? 3000 : 1500);
  return o;
}
export function clinicalForSigning(rx) {
  const c = rx.clinical || {}; const out = {}; let any = false;
  for (const k of CLINICAL_KEYS) { out[k] = String(c[k] || ""); if (out[k]) any = true; }
  return any ? out : null;
}

async function aiJson(system, payload, maxTokens = 1400) {
  if (!config.openRouterKey) throw Object.assign(new Error("AI provider is not configured"), { status: 503 });
  const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${config.openRouterKey}`, "Content-Type": "application/json", "HTTP-Referer": config.clientOrigin, "X-Title": "MedAI Hospital" },
    body: JSON.stringify({ model: config.openRouterModel, messages: [{ role: "system", content: system }, { role: "user", content: JSON.stringify(payload) }], temperature: 0.2, max_tokens: maxTokens })
  });
  if (!r.ok) throw Object.assign(new Error("AI provider request failed"), { status: 502 });
  const d = await r.json(); const raw = String(d.choices?.[0]?.message?.content || "");
  try { return JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] || "{}"); } catch { return {}; }
}

const isAbnormal = s => !!s && !/^(normal|ok|within|unknown|check|n\/a)/i.test(String(s).trim());
const fmtD = d => d ? new Date(d).toISOString().slice(0, 10) : "";
const compactFindings = r => (r.findings || []).filter(f => isAbnormal(f.status)).slice(0, 25).map(f => `${f.name} ${f.value}${f.unit ? " " + f.unit : ""} (${f.status})`);

// Everything the doctor already has about the patient, for prefill + AI context.
async function buildRxContext(doctorId, { appointmentId, reportId }, ACCESS) {
  let appt = null, rep = null;
  if (reportId && validId(reportId)) rep = await MedicalReport.findOne({ _id: reportId, doctorId });
  else if (appointmentId && validId(appointmentId)) appt = await Appointment.findOne({ _id: appointmentId, doctorId, status: { $in: ACCESS } });
  if (!appt && !rep) return null;
  const patientId = (appt || rep).patientId;
  const patient = await User.findById(patientId).select("name dateOfBirth gender allergies currentMedicines medicalHistory");
  const [reports, rxs] = await Promise.all([
    MedicalReport.find({ patientId, "findings.0": { $exists: true } }).sort({ createdAt: -1 }).limit(6).select("docType findings advisedTests createdAt signedAt"),
    Prescription.find({ patientId, status: "signed" }).sort({ signedAt: -1 }).limit(5).select("items.generic advisedTests clinical.diagnosis signedAt")
  ]);
  const history = [patient?.medicalHistory, appt?.pastDiseases, appt?.pastInfo].map(x => String(x || "").trim()).filter(Boolean).join("\n");
  const pastTests = [
    ...reports.map(r => { const ab = compactFindings(r); return `${fmtD(r.signedAt || r.createdAt)} ${r.docType} report${ab.length ? " - abnormal: " + ab.join("; ") : " - no abnormal values"}`; }),
    ...rxs.filter(x => x.advisedTests).map(x => `${fmtD(x.signedAt)} advised: ${String(x.advisedTests).replace(/\s*\n\s*/g, ", ")}`)
  ].join("\n");
  const complaints = appt ? String(appt.problem || "") : String(rep.aiExplanation || "").slice(0, 400);
  return { appt, rep, patient, reports, rxs, prefill: { complaints, history, pastTests: pastTests.slice(0, 3000) } };
}

export function installV38(router, { notify, ACCESS, PRESCRIBE, sendMailSafe }) {
  // ================= Prescription prefill (no AI) =================
  router.get("/rx-prefill", auth, allow("doctor"), wrap(async (req, res) => {
    const c = await buildRxContext(req.user.id, req.query, PRESCRIBE);
    if (!c) return res.status(403).json({ error: "Open one of your active appointments or assigned reports first" });
    const p = c.patient;
    res.json({ prefill: c.prefill, patient: { name: p?.name, ageYears: ageFromDob(p?.dateOfBirth), sex: normSex(p?.gender), allergies: p?.allergies || [] } });
  }));

  // ================= AI: medicines + tests + diagnosis (replaces the old medicine-only route) =================
  router.post("/ai/medicine-suggestions", auth, allow("doctor"), aiLim, wrap(async (req, res) => {
    const c = await buildRxContext(req.user.id, req.body || {}, PRESCRIBE);
    if (!c) return res.status(403).json({ error: "Open one of your active appointments or assigned reports first" });
    const typed = str(req.body.diagnosis, 600);
    const p = c.patient;
    const allergies = (p?.allergies || []).map(x => String(x).toLowerCase()), current = (p?.currentMedicines || []).map(x => String(x).toLowerCase());
    const ctx = {
      doctorDiagnosis: typed || "(not entered - infer a working diagnosis from the information below)",
      complaints: c.prefill.complaints, pastHistory: c.prefill.history, previousTestsAndReports: c.prefill.pastTests,
      ageYears: ageFromDob(p?.dateOfBirth), sex: normSex(p?.gender), allergies: p?.allergies || [], currentMedicines: p?.currentMedicines || [],
      previousMedicines: c.rxs.flatMap(x => (x.items || []).map(i => i.generic)).filter(Boolean).slice(0, 20)
    };
    const system = 'You assist a licensed Bangladeshi doctor writing a prescription. Using the complaints, past history and previous tests, reply ONLY with JSON: {"workingDiagnosis":"short","suggestions":[{"generic":"","class":"","reason":"one short sentence","cautions":"key cautions incl. conflict with allergies/current medicines"}],"tests":[{"name":"","reason":"one short sentence","priority":"routine|soon|urgent"}],"advice":"2-4 short lifestyle/diet/rest lines","followUp":"e.g. review after 5 days or when to return urgently"}. Up to 5 commonly used GENERIC (INN) medicines and up to 6 tests that are useful NOW; do not repeat a test that was already done recently with a normal result. Never give doses, durations or brand names. Never claim certainty; the doctor decides. Skip any medicine that matches a listed allergy.';
    const out = await aiJson(system, ctx, 1300);
    const prevAdvised = c.rxs.map(x => String(x.advisedTests || "").toLowerCase()).join(" ");
    const suggestions = [];
    for (const x of (out.suggestions || []).slice(0, 5)) {
      const generic = str(x.generic, 80); if (generic.length < 3) continue;
      const brands = await Medicine.find({ active: true, reviewStatus: "verified", generic: new RegExp(escapeRegex(generic.split(/[ ,(]/)[0]), "i") }).limit(6).select("brand generic strength form manufacturer");
      const lower = generic.toLowerCase();
      suggestions.push({ generic, class: str(x.class, 80), reason: str(x.reason, 240), cautions: str(x.cautions, 300),
        allergyConflict: allergies.some(a => a && (lower.includes(a) || a.includes(lower))),
        alreadyTaking: current.some(m => m && (m.includes(lower) || lower.includes(m))), brands });
    }
    const tests = (out.tests || []).slice(0, 6).map(t => ({ name: str(t.name, 100), reason: str(t.reason, 200), priority: ["routine", "soon", "urgent"].includes(t.priority) ? t.priority : "routine" }))
      .filter(t => t.name.length >= 2).map(t => ({ ...t, advisedBefore: prevAdvised.includes(t.name.toLowerCase()) }));
    await audit(req, "ai.medicine_test_suggestions", c.rep ? "MedicalReport" : "Appointment", String((c.rep || c.appt)._id), { meds: suggestions.length, tests: tests.length });
    res.json({ workingDiagnosis: str(out.workingDiagnosis, 300), suggestions, tests, advice: str(out.advice, 600), followUp: str(out.followUp, 300), prefill: c.prefill,
      disclaimer: "AI suggestions are options for the treating doctor only, not a prescription. Check allergies, history and current medicines yourself, and enter doses yourself." });
  }));

  // ================= Combined analysis of several reports =================
  const canSee = async (doctorId, patientId) => !!(await Appointment.exists({ doctorId, patientId, status: { $in: ACCESS } })) || !!(await MedicalReport.exists({ doctorId, patientId }));
  const num = v => { const m = String(v ?? "").replace(/,/g, "").match(/-?\d+(\.\d+)?/); return m ? Number(m[0]) : null; };
  function buildTrends(reports) {
    const map = new Map();
    for (const r of reports) for (const f of r.findings || []) {
      const k = String(f.key || f.name || "").toLowerCase().trim(); if (!k) continue;
      if (!map.has(k)) map.set(k, { name: f.name, unit: f.unit || "", normalRange: f.normalRange || "", points: [] });
      map.get(k).points.push({ date: fmtD(r.signedAt || r.reviewedAt || r.createdAt), value: f.value, num: num(f.value), status: f.status || "" });
    }
    const out = [];
    for (const t of map.values()) {
      if (t.points.length < 2) continue;
      const a = t.points[0].num, b = t.points[t.points.length - 1].num; t.direction = "unknown";
      if (a != null && b != null) { const ch = a === 0 ? 0 : (b - a) / Math.abs(a); t.direction = Math.abs(ch) < 0.05 ? "stable" : ch > 0 ? "rising" : "falling"; t.changePct = Math.round(ch * 100); }
      t.stillAbnormal = isAbnormal(t.points[t.points.length - 1].status); out.push(t);
    }
    return out.sort((x, y) => Number(y.stillAbnormal) - Number(x.stillAbnormal)).slice(0, 40);
  }
  router.post("/ai/multi-report-analysis", auth, allow("patient", "doctor"), aiLim, wrap(async (req, res) => {
    const ids = Array.isArray(req.body.reportIds) ? [...new Set(req.body.reportIds.map(String))].filter(validId).slice(0, 10) : [];
    if (ids.length < 2) return res.status(400).json({ error: "Select at least 2 reports to analyse together" });
    const isDoc = req.user.role === "doctor";
    const patientId = isDoc ? req.body.patientId : req.user.id;
    if (!validId(patientId)) return res.status(400).json({ error: "Patient is required" });
    if (isDoc && !(await canSee(req.user.id, patientId))) return res.status(403).json({ error: "You can only analyse reports of your own patients" });
    const reports = (await MedicalReport.find({ _id: { $in: ids }, patientId, "findings.0": { $exists: true } })).sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    if (reports.length < 2) return res.status(400).json({ error: "At least 2 of the selected reports must already be analysed (they need test values)" });
    const patient = await User.findById(patientId).select("name dateOfBirth gender allergies currentMedicines medicalHistory");
    const trends = buildTrends(reports);
    const lang = req.body.lang === "bn" ? "bn" : "en";
    const payload = {
      patient: { ageYears: ageFromDob(patient?.dateOfBirth), sex: normSex(patient?.gender), history: str(patient?.medicalHistory, 600), currentMedicines: patient?.currentMedicines || [], allergies: patient?.allergies || [] },
      reports: reports.map(r => ({ date: fmtD(r.signedAt || r.createdAt), type: r.docType, abnormal: compactFindings(r), valuesChecked: (r.findings || []).length })),
      trendsAcrossReports: trends.slice(0, 25).map(t => ({ test: t.name, direction: t.direction, changePct: t.changePct, stillAbnormal: t.stillAbnormal, values: t.points.map(p => `${p.date}: ${p.value}`) })), language: lang
    };
    const system = 'You help a patient and their licensed doctor understand SEVERAL medical reports together. Reply ONLY with JSON: {"summary":"3-5 sentences, plain words","patterns":["cross-report patterns"],"possibleConditions":[{"name":"","likelihood":"low|moderate|high","evidence":["values that support it"],"note":"what to confirm"}],"suggestedSpecialty":"","suggestedTests":[{"name":"","reason":""}],"urgency":"routine|soon|urgent","redFlags":["only if values are dangerously abnormal"]}. Possible conditions are possibilities to discuss with a doctor, NOT a diagnosis. Maximum 5. Base ONLY on the supplied values; if data is insufficient say so. Never give doses or medicine names. Write all text in ' + (lang === "bn" ? "Bangla (Bengali script), keeping test names in English" : "English") + ".";
    const ai = await aiJson(system, payload, 1600);
    const clean = {
      summary: str(ai.summary, 1500), patterns: (ai.patterns || []).slice(0, 8).map(x => str(x, 250)),
      possibleConditions: (ai.possibleConditions || []).slice(0, 5).map(c => ({ name: str(c.name, 120), likelihood: ["low", "moderate", "high"].includes(c.likelihood) ? c.likelihood : "low", evidence: (c.evidence || []).slice(0, 6).map(x => str(x, 160)), note: str(c.note, 300) })).filter(c => c.name),
      suggestedSpecialty: str(ai.suggestedSpecialty, 80), suggestedTests: (ai.suggestedTests || []).slice(0, 6).map(t => ({ name: str(t.name, 100), reason: str(t.reason, 200) })).filter(t => t.name),
      urgency: ["routine", "soon", "urgent"].includes(ai.urgency) ? ai.urgency : "routine", redFlags: (ai.redFlags || []).slice(0, 5).map(x => str(x, 200))
    };
    if (reports.some(r => /urgent|critical|emergency/i.test(String(r.urgencyLevel || "")))) clean.urgency = "urgent"; // deterministic rules can raise, never lower
    const doctorId = isDoc ? req.user.id : (reports.slice().reverse().find(r => r.doctorId)?.doctorId || null);
    const a = await MultiAnalysis.create({ patientId, doctorId, requestedBy: req.user.id, requestedByRole: req.user.role, reportIds: reports.map(r => r._id), trends, ai: clean });
    if (doctorId) { if (!isDoc) await notify(doctorId, "multi_analysis_review", "Combined report analysis to review", `${patient?.name || "A patient"} analysed ${reports.length} reports together. Please review the AI result.`, "MultiAnalysis", a.id); }
    else for (const ad of await User.find({ role: "admin", status: "active" }).select("_id")) await notify(ad._id, "multi_analysis_review", "Combined analysis needs a doctor", `${patient?.name || "A patient"} has a combined report analysis with no doctor assigned.`, "MultiAnalysis", a.id);
    await audit(req, "ai.multi_report_analysis", "MultiAnalysis", a.id, { reports: reports.length });
    res.status(201).json({ analysis: a });
  }));
  const shapeForPatient = a => { const o = a.toObject(); return { ...o, ai: o.status === "approved" ? undefined : o.ai, doctorFinal: o.status === "approved" ? o.doctorFinal : undefined, draft: o.status === "pending_doctor_review" ? o.ai : undefined }; };
  router.get("/multi-analyses/mine", auth, allow("patient"), wrap(async (req, res) => {
    const list = await MultiAnalysis.find({ patientId: req.user.id }).sort({ createdAt: -1 }).limit(30).populate("doctorId", "name doctorProfile.specialty");
    res.json({ analyses: list.map(a => { const o = shapeForPatient(a); if (o.status === "rejected") { o.draft = undefined; } return o; }) });
  }));
  router.get("/doctor/multi-analyses", auth, allow("doctor"), wrap(async (req, res) => {
    const list = await MultiAnalysis.find({ $or: [{ doctorId: req.user.id }, { doctorId: null }] }).sort({ createdAt: -1 }).limit(50).populate("patientId", "name gender dateOfBirth");
    res.json({ analyses: list });
  }));
  router.get("/doctor/patients-with-reports", auth, allow("doctor"), wrap(async (req, res) => {
    const ids = await Appointment.distinct("patientId", { doctorId: req.user.id, status: { $in: ACCESS } });
    const more = await MedicalReport.distinct("patientId", { doctorId: req.user.id });
    const uniq = [...new Set([...ids, ...more].map(String))];
    const users = await User.find({ _id: { $in: uniq } }).select("name");
    const out = [];
    for (const u of users) { const reports = await MedicalReport.find({ patientId: u._id, "findings.0": { $exists: true } }).sort({ createdAt: -1 }).limit(15).select("docType createdAt signedAt urgencyLevel"); if (reports.length >= 2) out.push({ _id: u._id, name: u.name, reports }); }
    res.json({ patients: out });
  }));
  router.post("/multi-analyses/:id/review", auth, allow("doctor"), wrap(async (req, res) => {
    if (!validId(req.params.id)) return res.status(404).json({ error: "Not found" });
    const a = await MultiAnalysis.findById(req.params.id);
    if (!a || (a.doctorId && String(a.doctorId) !== String(req.user.id))) return res.status(404).json({ error: "Analysis not found" });
    const decision = req.body.decision === "reject" ? "reject" : "approve";
    const f = req.body.final || {};
    if (decision === "approve" && str(f.summary, 2000).length < 5) return res.status(400).json({ error: "Write or keep the summary before approving" });
    a.doctorId = req.user.id; a.status = decision === "approve" ? "approved" : "rejected"; a.reviewedAt = new Date(); a.doctorNote = str(req.body.note, 1500);
    a.doctorFinal = { summary: str(f.summary, 2000), conditions: (f.conditions || []).slice(0, 8).map(c => ({ name: str(c.name, 120), likelihood: str(c.likelihood, 20), note: str(c.note, 300) })).filter(c => c.name), tests: (f.tests || []).slice(0, 10).map(x => str(x, 120)).filter(Boolean), specialty: str(f.specialty, 80), advice: str(f.advice, 1200), urgency: ["routine", "soon", "urgent"].includes(f.urgency) ? f.urgency : "routine" };
    await a.save();
    await notify(a.patientId, decision === "approve" ? "report_approved" : "report_changes_requested", decision === "approve" ? "Combined report analysis approved" : "Combined report analysis needs attention", decision === "approve" ? "Your doctor reviewed the combined analysis of your reports. Open My reports to read it." : "Your doctor could not confirm the combined analysis. Please book an appointment to discuss your reports.", "MultiAnalysis", a.id);
    await audit(req, "multi_analysis." + decision, "MultiAnalysis", a.id);
    res.json({ analysis: a });
  }));
  router.get("/admin/multi-analyses", auth, allow("admin"), wrap(async (_req, res) => {
    res.json({ analyses: await MultiAnalysis.find().sort({ createdAt: -1 }).limit(60).populate("patientId", "name").populate("doctorId", "name") });
  }));

  // ================= Admin: health, one-click fixes, user access doctor =================
  router.get("/admin/system/health", auth, allow("admin"), wrap(async (_req, res) => {
    const checks = []; const add = (id, label, ok, detail, fix) => checks.push({ id, label, ok, detail, fix: ok ? "" : fix });
    let dbOk = false; try { await mongoose.connection.db.admin().ping(); dbOk = mongoose.connection.readyState === 1; } catch { dbOk = false; }
    add("db", "Database", dbOk, dbOk ? "Connected" : "Not connected", "Check MONGODB_URI and MongoDB Atlas network access (allow 0.0.0.0/0), then restart the API on Render.");
    add("ai", "AI provider key", !!config.openRouterKey, config.openRouterKey ? "OPENROUTER_API_KEY is set" : "Missing", "Set OPENROUTER_API_KEY in the Render API environment. AI features are off until then.");
    add("smtp", "Email (Gmail)", !!(config.smtpUser && config.smtpPass), config.smtpUser ? "SMTP user " + config.smtpUser : "Missing", "Set SMTP_USER and SMTP_PASS (Gmail app password). Sign-up codes and password emails need this.");
    add("signing", "Prescription signing keys", !!(config.signingPrivateKey && config.signingPublicKey), config.signingPrivateKey ? "Keys loaded" : "Missing", "Run scripts/generate-prescription-signing-keys.js and set both PRESCRIPTION_SIGNING_*_BASE64 variables.");
    let st = true, sd = config.uploadDir; try { await fs.access(config.uploadDir, fs.constants.W_OK); } catch { st = false; }
    add("storage", "File storage", st, st ? sd : "Not writable: " + sd, "Attach a Render disk at the UPLOAD_DIR path or point UPLOAD_DIR to a writable folder.");
    add("recovery", "Emergency admin recovery key", !!(process.env.ADMIN_RECOVERY_KEY && process.env.ADMIN_RECOVERY_KEY.length >= 24), process.env.ADMIN_RECOVERY_KEY ? "Set" : "Not set", "Set ADMIN_RECOVERY_KEY (24+ random characters) in Render. It lets you reset the admin password if you are locked out.");
    const since = new Date(Date.now() - 24 * 3600 * 1000);
    const open = await SystemError.countDocuments({ resolvedAt: null, createdAt: { $gte: since } });
    add("errors", "Server errors (last 24h)", open === 0, open + " unresolved", "Open the error list below, read the messages and fix the cause (or press Resolve all if they are old).");
    const top = await SystemError.aggregate([{ $match: { resolvedAt: null, createdAt: { $gte: since } } }, { $group: { _id: "$message", n: { $sum: 1 }, last: { $max: "$createdAt" }, path: { $last: "$path" } } }, { $sort: { n: -1 } }, { $limit: 6 }]);
    res.json({ checks, topErrors: top.map(t => ({ message: t._id, count: t.n, last: t.last, path: t.path })), serverTime: new Date() });
  }));
  router.post("/admin/system/fix", auth, allow("admin"), wrap(async (req, res) => {
    const action = String(req.body.action || ""); let message = "";
    if (action === "rebuild_indexes") { await Appointment.createIndexes(); await CallSession.createIndexes(); await MultiAnalysis.createIndexes(); message = "Database indexes rebuilt."; }
    else if (action === "resolve_all_errors") { const r = await SystemError.updateMany({ resolvedAt: null }, { $set: { resolvedAt: new Date(), resolvedBy: req.user.id } }); message = `${r.modifiedCount} errors marked resolved.`; }
    else if (action === "clear_stale_calls") { const r = await CallSignal.deleteMany({ createdAt: { $lt: new Date(Date.now() - 3600 * 1000) } }); message = `${r.deletedCount} old call signals removed. New calls will start clean.`; }
    else if (action === "test_email") { const me = await User.findById(req.user.id).select("email contactEmail"); const ok = await sendMailSafe(me.contactEmail || me.email, "MedAI Hospital test email", "This is a test email from the MedAI admin System tab. Email sending works."); message = ok ? "Test email sent to " + (me.contactEmail || me.email) : "Email failed. Check SMTP_USER / SMTP_PASS (Gmail app password, no spaces)."; }
    else if (action === "test_ai") { try { const o = await aiJson('Reply ONLY with JSON {"ok":true}', { ping: 1 }, 20); message = o.ok ? "AI provider works." : "AI answered but unexpectedly. Try again."; } catch (e) { message = "AI test failed: " + e.message; } }
    else return res.status(400).json({ error: "Unknown fix action" });
    await audit(req, "system.fix." + action, "System", ""); res.json({ message });
  }));
  const WHY = { pending_email: "The email code was never entered.", pending_approval: "Waiting for admin approval.", pending_verification: "Doctor documents are not verified yet.", rejected: "The sign-up was rejected.", suspended: "The account is suspended." };
  router.get("/admin/users/:id/access-check", auth, allow("admin"), wrap(async (req, res) => {
    if (!validId(req.params.id)) return res.status(404).json({ error: "User not found" });
    const u = await User.findById(req.params.id).select("name email contactEmail role status lastLoginAt passwordChangedAt doctorProfile.verifiedAt +passwordResetExpires +otpExpires");
    if (!u) return res.status(404).json({ error: "User not found" });
    const problems = [], actions = [];
    if (u.status !== "active") { problems.push(WHY[u.status] || "Account is not active."); if (u.role === "doctor" && u.status === "pending_verification") actions.push("Verify the doctor in 'Doctor verification' (not forced here)."); else actions.push("Press 'Unlock / activate account'."); }
    if (!u.contactEmail && !u.email.includes("@")) problems.push("No valid email on file.");
    if (!u.lastLoginAt) problems.push("This user has never signed in.");
    if (!problems.length) problems.push("Nothing wrong with the account itself. The password may be forgotten or the browser may be using an old cached app.");
    actions.push("Send or issue a new password from 'Users' (reset password).", "Ask the user to clear the browser cache or reinstall the app if the site shows a blank page.");
    res.json({ user: { name: u.name, email: u.email, role: u.role, status: u.status, lastLoginAt: u.lastLoginAt }, problems, actions, canActivate: u.status !== "active" && !(u.role === "doctor" && u.status === "pending_verification") });
  }));
  router.post("/admin/users/:id/fix-access", auth, allow("admin"), wrap(async (req, res) => {
    if (!validId(req.params.id)) return res.status(404).json({ error: "User not found" });
    const u = await User.findById(req.params.id).select("role status"); if (!u || u.role === "admin") return res.status(404).json({ error: "User not found" });
    if (u.role === "doctor" && u.status === "pending_verification") return res.status(409).json({ error: "Verify this doctor in Doctor verification instead" });
    await User.updateOne({ _id: u._id }, { $set: { status: "active" }, $unset: { otpHash: 1, otpExpires: 1, otpAttempts: 1, otpSentAt: 1, otpPurpose: 1, passwordResetHash: 1, passwordResetExpires: 1 } });
    await audit(req, "admin.fix_access", "User", u.id, { from: u.status }); res.json({ message: "Account is active and sign-in codes were cleared. Reset the password if they forgot it." });
  }));

  // Emergency recovery when the admin cannot sign in at all. Works only if ADMIN_RECOVERY_KEY is set on the server.
  router.post("/auth/admin-recovery", recoveryLim, wrap(async (req, res) => {
    const server = process.env.ADMIN_RECOVERY_KEY || "";
    if (server.length < 24) return res.status(404).json({ error: "Not available" });
    const h = x => crypto.createHash("sha256").update(String(x)).digest();
    if (!crypto.timingSafeEqual(h(req.body.key || ""), h(server))) { await AuditEvent.create({ action: "admin_recovery.failed", ip: req.ip }).catch(() => {}); return res.status(403).json({ error: "Recovery key is wrong" }); }
    const email = String(req.body.email || config.adminEmail || "").toLowerCase().trim(); const pw = String(req.body.newPassword || "");
    if (pw.length < 14 || pw.length > 128) return res.status(400).json({ error: "New password must be 14 to 128 characters" });
    let u = await User.findOne({ email });
    if (u && u.role !== "admin") return res.status(409).json({ error: "That email is not an admin account" });
    const passwordHash = await hashPassword(pw);
    if (!u) { if (email !== config.adminEmail) return res.status(404).json({ error: "No admin with that email" }); u = await User.create({ name: "MedAI Super Admin", email, passwordHash, role: "admin", status: "active" }); }
    else { await User.updateOne({ _id: u._id }, { $set: { passwordHash, status: "active", passwordChangedAt: new Date() }, $unset: { otpHash: 1, otpExpires: 1, otpAttempts: 1, passwordResetHash: 1, passwordResetExpires: 1 } }); }
    await AuditEvent.create({ actorId: u._id, action: "admin_recovery.password_reset", targetType: "User", targetId: String(u._id), ip: req.ip }).catch(() => {});
    res.json({ message: "Admin password reset. Sign in with the new password." });
  }));
}
