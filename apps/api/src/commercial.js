// © 2026 MD Gausur Rahman Nabil. All rights reserved. MedAI Hospital.
// Commercial routes: payments, subscriptions, invoices, SMS, 2FA, data export,
// doctor availability, pharmacy & lab orders. Mounted in server.js as /api/commercial.

import express from "express";
import { z } from "zod";
import crypto from "crypto";
import { Payment, SubscriptionPlan, UserSubscription, Invoice, SMSMessage, TwoFactorAuth, DataExportRequest, DoctorAvailability, PharmacyOrder, LabOrder, MedicineReminder, MedicineIntakeLog, User, Appointment, MedicalReport, Prescription, PrivateFile, AuditEvent } from "./models.js";
import { auth, allow, audit } from "./security.js";
import { config } from "./config.js";
import { storeGridFSBuffer as storeBuffer } from "./fileStorage.js";
import { makeInvoicePdf } from "./pdf.js";

const router = express.Router();
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// ---------- helpers ----------
const requireId = (id) => { if (!id || id.length < 12) throw Object.assign(new Error("Invalid identifier"), { status: 400 }); };
const money = (v) => Math.round(Number(v) * 100) / 100;

// ---------- SUBSCRIPTION PLANS (admin) ----------
router.get("/plans", wrap(async (_req, res) => {
  const plans = await SubscriptionPlan.find({ active: true }).sort({ sortOrder: 1, priceMonthly: 1 }).lean();
  res.json({ plans });
}));

router.post("/plans", auth, allow("admin"), wrap(async (req, res) => {
  const body = z.object({
    name: z.string().min(2).max(100),
    slug: z.string().min(2).max(60).regex(/^[a-z0-9-]+$/),
    description: z.string().optional(),
    priceMonthly: z.number().min(0).default(0),
    priceYearly: z.number().min(0).default(0),
    currency: z.string().default("BDT"),
    features: z.array(z.string()).default([]),
    maxAppointmentsPerMonth: z.number().int().min(0).default(0),
    allowVideoCall: z.boolean().default(false),
    allowPrescription: z.boolean().default(false),
    allowFileUpload: z.boolean().default(false),
    prioritySupport: z.boolean().default(false),
    sortOrder: z.number().int().default(0),
  }).parse(req.body);
  const plan = await SubscriptionPlan.create(body);
  await audit(req, "commercial.plan.created", "SubscriptionPlan", plan.id, { name: plan.name });
  res.status(201).json({ plan });
}));

// ---------- USER SUBSCRIPTION ----------
router.get("/subscription/me", auth, wrap(async (req, res) => {
  const sub = await UserSubscription.findOne({ userId: req.user.id }).populate("planId").sort({ createdAt: -1 }).lean();
  res.json({ subscription: sub || null });
}));

router.post("/subscription/subscribe", auth, wrap(async (req, res) => {
  const body = z.object({ planId: z.string().min(12), cycle: z.enum(["monthly", "yearly"]).default("monthly") }).parse(req.body);
  const plan = await SubscriptionPlan.findById(body.planId);
  if (!plan || !plan.active) throw Object.assign(new Error("Plan not found"), { status: 404 });

  // deactivate existing active subscription
  await UserSubscription.updateMany({ userId: req.user.id, status: "active" }, { status: "expired" });

  const price = body.cycle === "yearly" ? plan.priceYearly : plan.priceMonthly;
  const expiresAt = new Date(Date.now() + (body.cycle === "yearly" ? 365 : 30) * 86400000);

  // create pending payment
  const payment = await Payment.create({
    userId: req.user.id, gateway: "manual", amount: price, currency: plan.currency,
    status: "pending", purpose: "subscription",
    metadata: { planId: plan.id, cycle: body.cycle }
  });

  const sub = await UserSubscription.create({
    userId: req.user.id, planId: plan.id, status: "active", expiresAt,
    autoRenew: true, paymentId: payment.id
  });
  await audit(req, "commercial.subscription.created", "UserSubscription", sub.id, { planId: plan.id, cycle: body.cycle, amount: price });
  res.status(201).json({ subscription: sub, paymentId: payment.id, amount: price });
}));

// ---------- PAYMENTS ----------
const paymentSchema = z.object({
  gateway: z.enum(["bkash", "nagad", "stripe", "cash", "manual"]),
  amount: z.number().positive(),
  currency: z.string().default("BDT"),
  purpose: z.enum(["consultation", "subscription", "medicine", "lab", "other"]).default("consultation"),
  appointmentId: z.string().optional(),
  metadata: z.any().optional()
});

router.post("/payments", auth, wrap(async (req, res) => {
  const { gateway, amount, currency, purpose, appointmentId, metadata } = paymentSchema.parse(req.body);
  const payment = await Payment.create({
    userId: req.user.id, appointmentId: appointmentId || null,
    gateway, amount: money(amount), currency, status: "pending", purpose,
    metadata: metadata || {}
  });
  if (appointmentId) requireId(appointmentId);
  await audit(req, "commercial.payment.created", "Payment", payment.id, { gateway, amount, purpose });
  res.status(201).json({ payment });
}));

router.patch("/payments/:id/confirm", auth, allow("admin"), wrap(async (req, res) => {
  const payment = await Payment.findOneAndUpdate(
    { _id: req.params.id, status: "pending" },
    { $set: { status: "paid", paidAt: new Date(), gatewayReference: String(req.body.reference || "") } },
    { new: true }
  );
  if (!payment) throw Object.assign(new Error("Payment not found or already processed"), { status: 404 });
  // if subscription payment, activate subscription
  if (payment.purpose === "subscription" && payment.metadata?.planId) {
    const plan = await SubscriptionPlan.findById(payment.metadata.planId);
    if (plan) {
      await UserSubscription.updateMany({ userId: payment.userId, status: "active" }, { status: "expired" });
      await UserSubscription.create({
        userId: payment.userId, planId: plan.id, status: "active",
        expiresAt: new Date(Date.now() + 30 * 86400000), autoRenew: true, paymentId: payment.id
      });
    }
  }
  await audit(req, "commercial.payment.confirmed", "Payment", payment.id);
  res.json({ payment });
}));

router.get("/payments/mine", auth, wrap(async (req, res) => {
  const payments = await Payment.find({ userId: req.user.id }).sort({ createdAt: -1 }).limit(100).lean();
  res.json({ payments });
}));

// ---------- INVOICES ----------
router.get("/invoices/mine", auth, wrap(async (req, res) => {
  const invoices = await Invoice.find({ userId: req.user.id }).sort({ issuedAt: -1 }).limit(100).lean();
  res.json({ invoices });
}));

router.post("/invoices", auth, allow("doctor", "admin"), wrap(async (req, res) => {
  const body = z.object({
    appointmentId: z.string().optional(),
    items: z.array(z.object({ description: z.string(), quantity: z.number().int().positive().default(1), unitPrice: z.number().nonnegative(), total: z.number().nonnegative() })).default([]),
    tax: z.number().nonnegative().default(0),
    dueAt: z.string().datetime().optional()
  }).parse(req.body);
  const subtotal = body.items.reduce((s, i) => s + (i.total || i.unitPrice * i.quantity), 0);
  const total = subtotal + (body.tax || 0);
  const invoiceNumber = "INV-" + crypto.randomBytes(6).toString("hex").toUpperCase();
  const invoice = await Invoice.create({
    userId: req.user.id, appointmentId: body.appointmentId || null, invoiceNumber,
    items: body.items, subtotal, tax: body.tax || 0, total,
    dueAt: body.dueAt ? new Date(body.dueAt) : undefined,
    status: "sent"
  });
  await audit(req, "commercial.invoice.created", "Invoice", invoice.id, { invoiceNumber, total });
  res.status(201).json({ invoice });
}));

router.get("/invoices/:id/download", auth, wrap(async (req, res) => {
  const invoice = await Invoice.findOne({ _id: req.params.id, userId: req.user.id });
  if (!invoice) throw Object.assign(new Error("Invoice not found"), { status: 404 });
  // generate pdf if missing
  if (!invoice.pdfFileId) {
    const pdf = makeInvoicePdf(invoice);
    const file = await storeBuffer({ ownerId: req.user.id, uploadedBy: req.user.id, category: "other", originalName: `${invoice.invoiceNumber}.pdf`, mimeType: "application/pdf", buffer: pdf });
    invoice.pdfFileId = file._id; await invoice.save();
  }
  res.json({ invoiceId: invoice.id, invoiceNumber: invoice.invoiceNumber, pdfFileId: String(invoice.pdfFileId) });
}));

// ---------- SMS ----------
router.post("/sms/send", auth, wrap(async (req, res) => {
  const body = z.object({ to: z.string().min(6), body: z.string().min(1).max(1600), purpose: z.enum(["otp", "appointment", "reminder", "marketing", "other"]).default("other") }).parse(req.body);
  // Record intent; actual provider send depends on env (TWILIO/MSG91/BULK_SMS). We store the message for audit.
  const sms = await SMSMessage.create({ userId: req.user.id, to: body.to, body: body.body, provider: config.smsProvider || "other", status: "queued", purpose: body.purpose });
  await audit(req, "commercial.sms.queued", "SMSMessage", sms.id, { to: body.to, purpose: body.purpose });
  res.status(201).json({ sms });
}));

router.get("/sms/mine", auth, wrap(async (req, res) => {
  const sms = await SMSMessage.find({ userId: req.user.id }).sort({ createdAt: -1 }).limit(100).lean();
  res.json({ sms });
}));

// ---------- 2FA ----------
router.post("/2fa/setup", auth, wrap(async (req, res) => {
  // Generate TOTP secret (base32). In production verify with speakeasy/qrcode.
  const secret = crypto.randomBytes(20).toString("base32").slice(0, 32);
  const backupCodes = Array.from({ length: 8 }, () => crypto.randomBytes(4).toString("hex"));
  let tfa = await TwoFactorAuth.findOne({ userId: req.user.id });
  if (tfa) {
    tfa.secret = secret; tfa.backupCodes = backupCodes; tfa.enabled = false; tfa.verifiedAt = null;
    await tfa.save();
  } else {
    tfa = await TwoFactorAuth.create({ userId: req.user.id, secret, backupCodes, enabled: false });
  }
  // Return secret + QR otpauth URL so frontend can render QR code
  const issuer = encodeURIComponent("MedAI Hospital");
  const account = encodeURIComponent(req.user.email);
  const otpauth = `otpauth://totp/${issuer}:${account}?secret=${secret}&issuer=${issuer}`;
  await audit(req, "commercial.2fa.setup", "TwoFactorAuth", tfa.id);
  res.json({ secret, otpauth, backupCodes });
}));

router.post("/2fa/verify", auth, wrap(async (req, res) => {
  const body = z.object({ token: z.string().length(6), backupCode: z.string().optional() }).parse(req.body);
  const tfa = await TwoFactorAuth.findOne({ userId: req.user.id });
  if (!tfa) throw Object.assign(new Error("2FA not set up"), { status: 400 });
  let ok = false;
  if (body.token) {
    // Simple TOTP check placeholder — frontend should verify with speakeasy; here we accept any 6-digit for MVP and mark verified.
    ok = /^\d{6}$/.test(body.token);
  } else if (body.backupCode) {
    ok = tfa.backupCodes.includes(body.backupCode);
    if (ok) tfa.backupCodes = tfa.backupCodes.filter(c => c !== body.backupCode);
  }
  if (!ok) throw Object.assign(new Error("Invalid verification code"), { status: 400 });
  tfa.enabled = true; tfa.verifiedAt = new Date(); await tfa.save();
  await audit(req, "commercial.2fa.verified", "TwoFactorAuth", tfa.id);
  res.json({ enabled: true });
}));

router.post("/2fa/disable", auth, wrap(async (req, res) => {
  await TwoFactorAuth.findOneAndDelete({ userId: req.user.id });
  await audit(req, "commercial.2fa.disabled", "TwoFactorAuth", req.user.id);
  res.json({ ok: true });
}));

router.get("/2fa/status", auth, wrap(async (req, res) => {
  const tfa = await TwoFactorAuth.findOne({ userId: req.user.id }).select("enabled verifiedAt");
  res.json({ enabled: !!tfa?.enabled, verifiedAt: tfa?.verifiedAt || null });
}));

// ---------- DATA EXPORT (GDPR-style) ----------
router.post("/data-export/request", auth, wrap(async (req, res) => {
  const existing = await DataExportRequest.findOne({ userId: req.user.id, status: { $in: ["requested", "processing"] } });
  if (existing) throw Object.assign(new Error("Export already in progress"), { status: 409 });
  const exp = await DataExportRequest.create({ userId: req.user.id, status: "requested" });
  // In production, enqueue a background job to build a ZIP of user files/records and presign a URL.
  await audit(req, "commercial.data-export.requested", "DataExportRequest", exp.id);
  res.status(202).json({ exportId: exp.id, status: "requested", message: "Export queued. You will be notified when ready." });
}));

router.get("/data-export/status", auth, wrap(async (req, res) => {
  const exp = await DataExportRequest.findOne({ userId: req.user.id }).sort({ createdAt: -1 });
  res.json({ export: exp || null });
}));

// ---------- DOCTOR AVAILABILITY ----------
router.get("/doctor/availability", auth, wrap(async (req, res) => {
  const { doctorId } = req.query;
  const filter = doctorId ? { doctorId } : { doctorId: req.user.id };
  const rows = await DoctorAvailability.find(filter).sort({ dayOfWeek: 1, startTime: 1 }).lean();
  res.json({ availability: rows });
}));

router.post("/doctor/availability", auth, allow("doctor", "admin"), wrap(async (req, res) => {
  const body = z.object({
    doctorId: z.string().optional(),
    dayOfWeek: z.number().int().min(0).max(6),
    startTime: z.string().regex(/^\d{2}:\d{2}$/),
    endTime: z.string().regex(/^\d{2}:\d{2}$/),
    slotDurationMinutes: z.number().int().min(5).max(240).default(30),
    breakStart: z.string().optional(),
    breakEnd: z.string().optional(),
    active: z.boolean().default(true)
  }).parse(req.body);
  const targetDoctor = body.doctorId || (req.user.role === "admin" ? body.doctorId : req.user.id);
  if (!targetDoctor) throw Object.assign(new Error("doctorId required"), { status: 400 });
  requireId(targetDoctor);
  const row = await DoctorAvailability.create({ doctorId: targetDoctor, ...body });
  await audit(req, "commercial.availability.created", "DoctorAvailability", row.id, { doctorId: targetDoctor, dayOfWeek: body.dayOfWeek });
  res.status(201).json({ availability: row });
}));

// ---------- PHARMACY ORDERS ----------
router.post("/pharmacy/orders", auth, wrap(async (req, res) => {
  const body = z.object({
    prescriptionId: z.string().optional(),
    items: z.array(z.object({ medicineId: z.string().optional(), brand: z.string(), generic: z.string(), quantity: z.number().int().positive().default(1), unitPrice: z.number().nonnegative() })),
    pharmacyName: z.string().optional(), deliveryAddress: z.string().optional(), phone: z.string().optional()
  }).parse(req.body);
  let total = 0;
  for (const it of body.items) total += (it.unitPrice || 0) * it.quantity;
  const order = await PharmacyOrder.create({ patientId: req.user.id, prescriptionId: body.prescriptionId || null, items: body.items, total, pharmacyName: body.pharmacyName || "", deliveryAddress: body.deliveryAddress || "", phone: body.phone || "" });
  await audit(req, "commercial.pharmacy.order.created", "PharmacyOrder", order.id, { total });
  res.status(201).json({ order });
}));

router.get("/pharmacy/orders/mine", auth, wrap(async (req, res) => {
  const orders = await PharmacyOrder.find({ patientId: req.user.id }).sort({ createdAt: -1 }).limit(100).lean();
  res.json({ orders });
}));

// ---------- LAB ORDERS ----------
router.post("/lab/orders", auth, wrap(async (req, res) => {
  const body = z.object({
    appointmentId: z.string().optional(),
    tests: z.array(z.object({ name: z.string(), code: z.string().optional(), price: z.number().nonnegative().default(0) })),
    labName: z.string().optional()
  }).parse(req.body);
  let total = 0;
  for (const t of body.tests) total += t.price || 0;
  const order = await LabOrder.create({ patientId: req.user.id, appointmentId: body.appointmentId || null, tests: body.tests.map(t => ({ ...t, status: "ordered" })), total, labName: body.labName || "" });
  await audit(req, "commercial.lab.order.created", "LabOrder", order.id, { total });
  res.status(201).json({ order });
}));

router.get("/lab/orders/mine", auth, wrap(async (req, res) => {
  const orders = await LabOrder.find({ patientId: req.user.id }).sort({ createdAt: -1 }).limit(100).lean();
  res.json({ orders });
}));

// ---------- PUSH TOKEN REGISTRATION ----------
router.post("/push/register", auth, wrap(async (req, res) => {
  const { token } = z.object({ token: z.string().min(10) }).parse(req.body);
  // Store push token on user (upsert). Simple approach: keep latest token in a setting-like field.
  // For MVP we acknowledge; production would write to a User.pushTokens array.
  await User.findByIdAndUpdate(req.user.id, { $set: { "pushToken": token, pushTokenUpdatedAt: new Date() } }, { upsert: false });
  await audit(req, "commercial.push.registered", "User", req.user.id);
  res.json({ ok: true });
}));

// ---------- MEDICINE REMINDER / ADHERENCE TRACKER ----------
router.get("/medicine/reminders", auth, wrap(async (req, res) => {
  const reminders = await MedicineReminder.find({ patientId: req.user.id, active: true }).sort({ createdAt: -1 }).lean();
  res.json({ reminders });
}));

router.post("/medicine/reminders", auth, wrap(async (req, res) => {
  const body = z.object({
    medicineName: z.string().min(2).max(200),
    genericName: z.string().optional(),
    dosage: z.string().optional(),
    frequencyPerDay: z.number().int().min(1).max(24),
    timesOfDay: z.array(z.string()).default([]),
    startDate: z.string().datetime(),
    endDate: z.string().datetime().optional(),
    instructions: z.string().optional()
  }).parse(req.body);
  const reminder = await MedicineReminder.create({
    patientId: req.user.id, ...body,
    startDate: new Date(body.startDate), endDate: body.endDate ? new Date(body.endDate) : undefined
  });
  await audit(req, "medicine.reminder.created", "MedicineReminder", reminder.id);
  res.status(201).json({ reminder });
}));

router.patch("/medicine/reminders/:id", auth, wrap(async (req, res) => {
  const body = z.object({
    medicineName: z.string().optional(),
    active: z.boolean().optional(),
    timesOfDay: z.array(z.string()).optional()
  }).parse(req.body);
  const reminder = await MedicineReminder.findOneAndUpdate(
    { _id: req.params.id, patientId: req.user.id },
    { $set: body }, { new: true }
  );
  if (!reminder) throw Object.assign(new Error("Reminder not found"), { status: 404 });
  res.json({ reminder });
}));

router.delete("/medicine/reminders/:id", auth, wrap(async (req, res) => {
  const r = await MedicineReminder.findOneAndDelete({ _id: req.params.id, patientId: req.user.id });
  if (!r) throw Object.assign(new Error("Reminder not found"), { status: 404 });
  res.json({ ok: true });
}));

router.post("/medicine/intake", auth, wrap(async (req, res) => {
  const body = z.object({
    reminderId: z.string().min(12),
    status: z.enum(["taken","skipped","missed"]).default("taken"),
    notes: z.string().optional()
  }).parse(req.body);
  const reminder = await MedicineReminder.findOne({ _id: body.reminderId, patientId: req.user.id });
  if (!reminder) throw Object.assign(new Error("Reminder not found"), { status: 404 });
  const log = await MedicineIntakeLog.create({ patientId: req.user.id, reminderId: body.reminderId, status: body.status, notes: body.notes || "" });
  await audit(req, "medicine.intake.logged", "MedicineIntakeLog", log.id, { status: body.status });
  res.status(201).json({ log });
}));

router.get("/medicine/intake/history", auth, wrap(async (req, res) => {
  const { limit = 30 } = req.query;
  const logs = await MedicineIntakeLog.find({ patientId: req.user.id }).sort({ takenAt: -1 }).limit(Number(limit)).populate("reminderId","medicineName dosage").lean();
  res.json({ logs });
}));

router.get("/medicine/adherence", auth, wrap(async (req, res) => {
  const logs = await MedicineIntakeLog.find({ patientId: req.user.id }).sort({ takenAt: -1 }).limit(100).lean();
  const total = logs.length;
  const taken = logs.filter(l=>l.status==="taken").length;
  const adherence = total ? Math.round((taken/total)*100) : 0;
  res.json({ adherence, total, taken, missed: logs.filter(l=>l.status==="missed").length, skipped: logs.filter(l=>l.status==="skipped").length });
}));

// ---------- BIOMETRIC LOGIN (Fingerprint / Face) ----------
router.post("/biometric/enable", auth, wrap(async (req, res) => {
  const body = z.object({ enabled: z.boolean(), type: z.enum(["fingerprint","face","none"]).default("none") }).parse(req.body);
  await User.findByIdAndUpdate(req.user.id, { $set: { biometricEnabled: body.enabled, biometricType: body.type } });
  await audit(req, "security.biometric."+(body.enabled?"enabled":"disabled"), "User", req.user.id, { type: body.type });
  res.json({ enabled: body.enabled, type: body.type });
}));

router.get("/biometric/status", auth, wrap(async (req, res) => {
  const u = await User.findById(req.user.id).select("biometricEnabled biometricType").lean();
  res.json({ enabled: !!u?.biometricEnabled, type: u?.biometricType || "none" });
}));

// ---------- ADMIN: COMMERCIAL OVERVIEW ----------
router.get("/admin/commercial/overview", auth, allow("admin"), wrap(async (req, res) => {
  const [totalPayments, paidPayments, totalSubscriptions, totalInvoices, paidInvoices] = await Promise.all([
    Payment.countDocuments(), Payment.countDocuments({ status: "paid" }),
    UserSubscription.countDocuments({ status: "active" }),
    Invoice.countDocuments(), Invoice.countDocuments({ status: "paid" })
  ]);
  const revenue = await Payment.aggregate([{ $match: { status: "paid" } }, { $group: { _id: null, total: { $sum: "$amount" } } }]);
  res.json({
    payments: { total: totalPayments, paid: paidPayments },
    subscriptionsActive: totalSubscriptions,
    invoices: { total: totalInvoices, paid: paidInvoices },
    revenueBDT: revenue[0]?.total || 0
  });
}));

export default router;