// © 2026 MD Gausur Rahman Nabil. All rights reserved. MedAI Hospital.
// Commercial panel: subscriptions, payments, invoices, 2FA, data export,
// pharmacy & lab orders. Accessible to all roles; admin sees overview.
import { useState, useEffect, useCallback } from "react";
import { makeApi, json, fmtDate, fmtSize, API } from "./api";
import { Tabs } from "./common";
import { checkBiometrics, isNativeApp, unlockWithBiometric, biometricLockEnabled, setBiometricLockEnabled } from "./biometric";
import { pingServer, setApiBase, clearApiBase } from "./api";

type Role = "patient" | "doctor" | "admin";

interface Plan {
  _id: string; name: string; slug: string; description?: string;
  priceMonthly: number; priceYearly: number; currency: string;
  features: string[]; maxAppointmentsPerMonth: number;
  allowVideoCall: boolean; allowPrescription: boolean; allowFileUpload: boolean;
  prioritySupport: boolean; active: boolean; sortOrder: number;
}
interface Subscription {
  _id: string; planId: any; status: string; startedAt: string;
  expiresAt?: string; autoRenew: boolean;
}
interface Payment {
  _id: string; gateway: string; amount: number; currency: string;
  status: string; purpose: string; createdAt: string; paidAt?: string;
  transactionId?: string;
}
interface Invoice {
  _id: string; invoiceNumber: string; status: string; total: number;
  currency: string; issuedAt: string; dueAt?: string; paidAt?: string;
  items: Array<{description:string;quantity:number;unitPrice:number;total:number}>;
  pdfFileId?: string;
}
interface MedicineReminder {
  _id: string; medicineName: string; genericName?: string; dosage?: string;
  frequencyPerDay: number; timesOfDay: string[]; startDate: string;
  endDate?: string; instructions?: string; active: boolean;
}
interface IntakeLog {
  _id: string; reminderId: string; status: string; takenAt: string;
  notes?: string; reminderIdPopulated?: any;
}
interface BiometricStatus { enabled: boolean; type: string; }

export default function CommercialPanel({ api, token, user, onToken, setMessage }: {
  api: any; token: string; user: { id?: string; _id?: string; name: string; email: string; role: Role };
  onToken: (t: string) => void; setMessage: (m: string) => void;
}) {
  const uid = String(user.id || user._id);
  const [tab, setTab] = useState<"plans"|"subscription"|"payments"|"invoices"|"2fa"|"export"|"pharmacy"|"lab"|"overview"|"medicine"|"security">("plans");
  const [plans, setPlans] = useState<Plan[]>([]);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [tfa, setTfa] = useState<{enabled:boolean;verifiedAt?:string} | null>(null);
  const [exportStatus, setExportStatus] = useState<{status:string;downloadUrl:string} | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [form, setForm] = useState<any>({});
  const [reminders, setReminders] = useState<MedicineReminder[]>([]);
  const [intakeLogs, setIntakeLogs] = useState<IntakeLog[]>([]);
  const [adherence, setAdherence] = useState<any>(null);
  const [newMed, setNewMed] = useState({medicineName:"",genericName:"",dosage:"",frequencyPerDay:1,timesOfDay:["08:00"],startDate:"",instructions:""});
  const [biometric, setBiometric] = useState<BiometricStatus>({enabled:false,type:"none"});
  const native = isNativeApp();
  const [bioAvail, setBioAvail] = useState<{ available: boolean; type: string; reason?: string } | null>(null);
  const [bioEnabled, setBioEnabled] = useState(biometricLockEnabled());
  const [busy, setBusy] = useState(false);
  const [connBusy, setConnBusy] = useState(false);
  const [connOk, setConnOk] = useState<boolean | null>(null);
  const [connNote, setConnNote] = useState("");
  const [connBase, setConnBase] = useState(API);
  const [connInput, setConnInput] = useState("");
  useEffect(() => {
    let alive = true;
    checkBiometrics().then((c) => {
      if (!alive) return;
      setBioAvail(c.ok ? { available: c.available, type: c.type } : { available: false, type: "none", reason: c.reason });
    }).catch(() => alive && setBioAvail({ available: false, type: "none", reason: "Biometric hardware is unavailable." }));
    return () => { alive = false; };
  }, []);

  const load = useCallback(async () => {
    setLoading(true); setErr("");
    try {
      const [p, s, py, iv, t, rem, log, adh, bio] = await Promise.all([
        api("/commercial/plans").catch(()=>({plans:[]})),
        api("/commercial/subscription/me").catch(()=>({subscription:null})),
        api("/commercial/payments/mine").catch(()=>({payments:[]})),
        api("/commercial/invoices/mine").catch(()=>({invoices:[]})),
        api("/commercial/2fa/status").catch(()=>({enabled:false})),
        api("/commercial/medicine/reminders").catch(()=>({reminders:[]})),
        api("/commercial/medicine/intake/history?limit=30").catch(()=>({logs:[]})),
        api("/commercial/medicine/adherence").catch(()=>({adherence:0})),
        api("/commercial/biometric/status").catch(()=>({enabled:false,type:"none"})),
      ]);
      setPlans((p as any).plans || []);
      setSubscription((s as any).subscription || null);
      setPayments((py as any).payments || []);
      setInvoices((iv as any).invoices || []);
      setTfa((t as any).enabled ? { enabled: true, verifiedAt: (t as any).verifiedAt } : null);
      setReminders((rem as any).reminders || []);
      setIntakeLogs((log as any).logs || []);
      setAdherence((adh as any) || null);
      setBiometric((bio as any) || {enabled:false,type:"none"});
    } catch (e: any) { setErr(e.message || "Failed to load commercial data"); }
    finally { setLoading(false); }
  }, [api]);

  useEffect(() => { load(); }, [api, load]);

  // ---------- Subscribe ----------
  const subscribe = async (planId: string, cycle: "monthly" | "yearly") => {
    setLoading(true); setErr("");
    try {
      const d = await api("/commercial/subscription/subscribe", {
        method: "POST", body: json({ planId, cycle })
      });
      setMsg(`Subscription created. Amount due: ${d.amount} ${d.currency || "BDT"}. Complete payment to activate.`);
      await load();
    } catch (e: any) { setErr(e.message || "Subscription failed"); }
    finally { setLoading(false); }
  };

  // ---------- Pay ----------
  const pay = async (gateway: string, amount: number, purpose: string) => {
    setLoading(true); setErr("");
    try {
      const d = await api("/commercial/payments", {
        method: "POST", body: json({ gateway, amount, currency: "BDT", purpose })
      });
      setMsg(`Payment recorded (${d.gateway}). Status: ${d.status}. Admin will confirm.`);
      await load();
    } catch (e: any) { setErr(e.message || "Payment failed"); }
    finally { setLoading(false); }
  };

  // ---------- 2FA ----------
  const setup2fa = async () => {
    setLoading(true); setErr("");
    try {
      const d = await api("/commercial/2fa/setup", { method: "POST", body: json({}) });
      setForm({ step: "verify", secret: d.secret, otpauth: d.otpauth, backupCodes: d.backupCodes });
    } catch (e: any) { setErr(e.message || "2FA setup failed"); }
    finally { setLoading(false); }
  };
  const verify2fa = async (token6: string) => {
    setLoading(true); setErr("");
    try {
      await api("/commercial/2fa/verify", { method: "POST", body: json({ token: token6 }) });
      setMsg("2FA enabled. Keep your backup codes safe.");
      setForm({ step: "done" });
      await load();
    } catch (e: any) { setErr(e.message || "Invalid code"); }
    finally { setLoading(false); }
  };
  const disable2fa = async () => {
    if (!window.confirm("Disable two-factor authentication?")) return;
    setLoading(true); setErr("");
    try {
      await api("/commercial/2fa/disable", { method: "POST", body: json({}) });
      setMsg("2FA disabled.");
      setForm({ step: null }); await load();
    } catch (e: any) { setErr(e.message || "Could not disable"); }
    finally { setLoading(false); }
  };

  // ---------- Data export ----------
  const requestExport = async () => {
    setLoading(true); setErr("");
    try {
      const d = await api("/commercial/data-export/request", { method: "POST", body: json({}) });
      setMsg(d.message || "Export requested.");
      await load();
    } catch (e: any) { setErr(e.message || "Export request failed"); }
    finally { setLoading(false); }
  };

  // ---------- Render helpers ----------
  const statusBadge = (s: string) => {
    const color = { pending: "#b26a00", paid: "#059669", failed: "#dc2626", cancelled: "#64748b", active: "#059669", expired: "#dc2626", past_due: "#b26a00", sent: "#0b5ed6", draft: "#64748b", overdue: "#dc2626" }[s] || "#64748b";
    const badgeBorder = "1px solid " + color + "40";
    return <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 10, fontSize: 11, background: color + "15", color, border: badgeBorder, textTransform: "capitalize" }}>{s}</span>;
  };

  const tabItems: Array<[string, string]> = [
    ["plans", "Plans"],
    ["subscription", "My subscription"],
    ["payments", "Payments"],
    ["invoices", "Invoices"],
    ["2fa", "Two-factor auth"],
    ["export", "Data export"],
    ["pharmacy", "Pharmacy"],
    ["lab", "Lab orders"],
    ["medicine", "Medicine tracker"],
    ["security", "Security & biometric"],
  ];
  if (user.role === "admin") tabItems.push(["overview", "Admin overview"]);

  return (
    <div className="commercial-panel" style={{ maxWidth: 900, margin: "0 auto", padding: "0 12px 40px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
        <h2 style={{ margin: 0, fontSize: 20, color: "#0f172a", fontFamily: "var(--font-display)", letterSpacing: "-.01em" }}>💳 Billing &amp; Services</h2>
        <span style={{ fontSize: 12, color: "#64748b" }}>{user.name} • {user.email}</span>
      </div>

      {err && <div style={{ background: "#fdf0ee", color: "#dc2626", padding: 10, borderRadius: 8, marginBottom: 12, fontSize: 13 }}>{err}</div>}
      {msg && <div style={{ background: "#eaf7f1", color: "#059669", padding: 10, borderRadius: 8, marginBottom: 12, fontSize: 13 }}>{msg}</div>}

      <Tabs tabs={tabItems} tab={tab} setTab={(t) => setTab(t as any)} />

      {loading && <div style={{ textAlign: "center", padding: 30, color: "#64748b" }}>Loading…</div>}

      {/* ---------- PLANS ---------- */}
      {tab === "plans" && (
        <div>
          <h3 style={{ fontSize: 16, marginBottom: 10, color: "#0f172a" }}>Choose a plan</h3>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            {plans.map((plan) => (
              <div key={plan._id} style={{ border: "1px solid #e2e8f0", borderRadius: 10, padding: 16, minWidth: 220, background: "#fff" }}>
                <div style={{ fontWeight: "bold", fontSize: 16, color: "#0f172a" }}>{plan.name}</div>
                <div style={{ fontSize: 13, color: "#64748b", margin: "4px 0" }}>{plan.description || ""}</div>
                <div style={{ fontSize: 22, fontWeight: "bold", margin: "8px 0" }}>
                  {plan.currency === "BDT" ? "৳" : "$"}{plan.priceMonthly === 0 && plan.priceYearly === 0 ? "Free" : plan.priceMonthly}
                  {plan.priceYearly > 0 && plan.priceYearly !== plan.priceMonthly ? ` / yr ৳${plan.priceYearly}` : ""}
                </div>
                <ul style={{ fontSize: 12, color: "#334155", margin: 0, paddingLeft: 16 }}>
                  {plan.features.map((f, i) => <li key={i} style={{ margin: "2px 0" }}>{f}</li>)}
                  {plan.allowVideoCall && <li key="vid">📹 Video calls</li>}
                  {plan.allowPrescription && <li key="rx">📝 Digital prescriptions</li>}
                  {plan.allowFileUpload && <li key="up">📎 File uploads</li>}
                  {plan.prioritySupport && <li key="sup">⚡ Priority support</li>}
                </ul>
                <div style={{ marginTop: 12 }}>
                  {subscription?.status === "active" ? (
                    <button style={{ width: "100%", padding: 8, border: "none", borderRadius: 6, background: "#64748b", color: "#fff", cursor: "not-allowed" }}>Already subscribed</button>
                  ) : (
                    <>
                      <button onClick={() => subscribe(plan._id, "monthly")} style={{ width: "48%", padding: 8, border: "1px solid #0b5ed6", borderRadius: 6, background: "#fff", color: "#0b5ed6", cursor: "pointer" }}>Monthly</button>
                      {plan.priceYearly > 0 && (
                        <button onClick={() => subscribe(plan._id, "yearly")} style={{ width: "48%", padding: 8, border: "none", borderRadius: 6, background: "#0b5ed6", color: "#fff", cursor: "pointer", marginLeft: "4%" }}>Yearly</button>
                      )}
                    </>
                  )}
                </div>
              </div>
            ))}
            {plans.length === 0 && <div style={{ color: "#64748b" }}>No plans available.</div>}
          </div>
        </div>
      )}

      {/* ---------- SUBSCRIPTION ---------- */}
      {tab === "subscription" && (
        <div>
          <h3 style={{ fontSize: 16, marginBottom: 10, color: "#0f172a" }}>My subscription</h3>
          {subscription ? (
            <div style={{ border: "1px solid #e2e8f0", borderRadius: 10, padding: 16, background: "#fff" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <div style={{ fontWeight: "bold" }}>{subscription.planId?.name || "Plan"}</div>{statusBadge(subscription.status)}
              </div>
              <div style={{ fontSize: 13, color: "#64748b", marginBottom: 8 }}>Started: {fmtDate(subscription.startedAt)}</div>
              {subscription.expiresAt && <div style={{ fontSize: 13, color: "#64748b", marginBottom: 12 }}>Expires: {fmtDate(subscription.expiresAt)}</div>}
              <div style={{ fontSize: 13, color: "#64748b" }}>Auto-renew: {subscription.autoRenew ? "On" : "Off"}</div>
            </div>
          ) : (
            <div style={{ color: "#64748b" }}>No active subscription. Choose a plan above.</div>
          )}
        </div>
      )}

      {/* ---------- PAYMENTS ---------- */}
      {tab === "payments" && (
        <div>
          <h3 style={{ fontSize: 16, marginBottom: 10, color: "#0f172a" }}>Make a payment</h3>
          <div style={{ border: "1px solid #e2e8f0", borderRadius: 10, padding: 16, background: "#fff", marginBottom: 16 }}>
            <div style={{ fontSize: 13, color: "#64748b", marginBottom: 10 }}>Record a payment (manual gateway — admin confirms)</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 90px", gap: 8, alignItems: "end" }}>
              <select defaultValue="manual" onChange={(e) => setForm({...form, gateway: e.target.value})} style={{ padding: 8, border: "1px solid #e2e8f0", borderRadius: 6 }}>
                <option value="manual">Manual / Cash</option>
                <option value="bkash">bKash</option>
                <option value="nagad">Nagad</option>
                <option value="stripe">Stripe (card)</option>
              </select>
              <input type="number" defaultValue="0" step="10" onChange={(e) => setForm({...form, amount: Number(e.target.value) || 0})} style={{ padding: 8, border: "1px solid #e2e8f0", borderRadius: 6 }} placeholder="Amount (BDT)" />
              <input type="text" defaultValue="consultation" onChange={(e) => setForm({...form, purpose: e.target.value})} style={{ padding: 8, border: "1px solid #e2e8f0", borderRadius: 6 }} placeholder="Purpose" />
              <button onClick={() => pay(form.gateway || "manual", form.amount || 0, form.purpose || "consultation")} style={{ padding: 8, border: "none", borderRadius: 6, background: "#0b5ed6", color: "#fff", cursor: "pointer" }}>Record</button>
            </div>
          </div>
          <h4 style={{ fontSize: 14, marginBottom: 8, color: "#0f172a" }}>Payment history</h4>
          <div style={{ border: "1px solid #e2e8f0", borderRadius: 10, overflow: "hidden" }}>
            <div className="tablewrap"><table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead><tr style={{ background: "#f8fafc" }}>
                <th style={{ textAlign: "left", padding: 8 }}>Gateway</th><th style={{ textAlign: "left", padding: 8 }}>Amount</th><th style={{ textAlign: "left", padding: 8 }}>Purpose</th><th style={{ textAlign: "left", padding: 8 }}>Status</th><th style={{ textAlign: "left", padding: 8 }}>Date</th>
              </tr></thead>
              <tbody>
                {payments.map((p) => (
                  <tr key={p._id} style={{ borderBottom: "1px solid #eee" }}>
                    <td style={{ padding: 8 }}>{p.gateway}</td>
                    <td style={{ padding: 8 }}>{p.currency === "BDT" ? "৳" : "$"}{p.amount}</td>
                    <td style={{ padding: 8 }}>{p.purpose}</td>
                    <td style={{ padding: 8 }}>{statusBadge(p.status)}</td>
                    <td style={{ padding: 8 }}>{fmtDate(p.createdAt)}</td>
                  </tr>
                ))}
                {payments.length === 0 && <tr><td style={{ padding: 16, textAlign: "center", color: "#64748b" }} colSpan={5}>No payments yet.</td></tr>}
              </tbody>
            </table></div>
          </div>
        </div>
      )}

      {/* ---------- INVOICES ---------- */}
      {tab === "invoices" && (
        <div>
          <h3 style={{ fontSize: 16, marginBottom: 10, color: "#0f172a" }}>Invoices</h3>
          <div style={{ border: "1px solid #e2e8f0", borderRadius: 10, overflow: "hidden" }}>
            <div className="tablewrap"><table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead><tr style={{ background: "#f8fafc" }}>
                <th style={{ textAlign: "left", padding: 8 }}>Invoice #</th><th style={{ textAlign: "left", padding: 8 }}>Total</th><th style={{ textAlign: "left", padding: 8 }}>Status</th><th style={{ textAlign: "left", padding: 8 }}>Issued</th><th style={{ textAlign: "left", padding: 8 }}>PDF</th>
              </tr></thead>
              <tbody>
                {invoices.map((inv) => (
                  <tr key={inv._id} style={{ borderBottom: "1px solid #eee" }}>
                    <td style={{ padding: 8, fontWeight: "bold" }}>{inv.invoiceNumber}</td>
                    <td style={{ padding: 8 }}>{inv.currency === "BDT" ? "৳" : "$"}{inv.total}</td>
                    <td style={{ padding: 8 }}>{statusBadge(inv.status)}</td>
                    <td style={{ padding: 8 }}>{fmtDate(inv.issuedAt)}</td>
                    <td style={{ padding: 8 }}>
                      {inv.pdfFileId ? (
                        <button onClick={() => window.open(`${window.location.origin}/api/files/${inv.pdfFileId}/download`, "_blank")} style={{ padding: "4px 8px", border: "1px solid #0b5ed6", borderRadius: 4, background: "#fff", color: "#0b5ed6", fontSize: 12, cursor: "pointer" }}>Download</button>
                      ) : <span style={{ fontSize: 11, color: "#64748b" }}>—</span>}
                    </td>
                  </tr>
                ))}
                {invoices.length === 0 && <tr><td style={{ padding: 16, textAlign: "center", color: "#64748b" }} colSpan={5}>No invoices yet.</td></tr>}
              </tbody>
            </table></div>
          </div>
        </div>
      )}

      {/* ---------- 2FA ---------- */}
      {tab === "2fa" && (
        <div>
          <h3 style={{ fontSize: 16, marginBottom: 10, color: "#0f172a" }}>Two-Factor Authentication</h3>
          {tfa?.enabled ? (
            <div style={{ border: "1px solid #e2e8f0", borderRadius: 10, padding: 16, background: "#fff" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <span style={{ fontWeight: "bold" }}>2FA is active</span>{statusBadge("active")}
              </div>
              <div style={{ fontSize: 13, color: "#64748b" }}>Verified: {fmtDate(tfa.verifiedAt || "")}</div>
              <button onClick={disable2fa} style={{ marginTop: 12, padding: 8, border: "1px solid #dc2626", borderRadius: 6, background: "#fff", color: "#dc2626", cursor: "pointer" }}>Disable 2FA</button>
            </div>
          ) : (
            <div style={{ border: "1px solid #e2e8f0", borderRadius: 10, padding: 16, background: "#fff" }}>
              <div style={{ fontSize: 13, color: "#64748b", marginBottom: 10 }}>Set up an authenticator app (Google Authenticator, Authy, etc.)</div>
              {form.step === "verify" && (
                <div style={{ marginTop: 12, padding: 12, background: "#fff6e0", borderRadius: 8, fontSize: 12 }}>
                  <div style={{ fontWeight: "bold", marginBottom: 6 }}>Secret key: <span style={{ fontFamily: "monospace", wordBreak: "break-all" }}>{form.secret}</span></div>
                  <div style={{ fontWeight: "bold", marginTop: 6, marginBottom: 4 }}>Scan this QR or enter the setup key:</div>
                  <div style={{ marginTop: 6 }}>
                    <img src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(form.otpauth)}`} alt="2FA QR" style={{ width: 160, height: 160, border: "1px solid #ddd", borderRadius: 6 }} />
                  </div>
                  <div style={{ marginTop: 10 }}>
                    <strong>Backup codes (save these):</strong> {form.backupCodes.map((c: string, i: number) => <span key={i} style={{ marginRight: 8, fontFamily: "monospace", background: "#eee", padding: "2px 6px", borderRadius: 4 }}>{c}</span>)}
                  </div>
                  <div style={{ marginTop: 10 }}>
                    <input type="text" maxLength={6} onChange={(e) => setForm({...form, code: e.target.value})} style={{ padding: 8, border: "1px solid #e2e8f0", borderRadius: 6, width: 100 }} placeholder="6-digit code" />
                    <button onClick={() => verify2fa(form.code || "")} style={{ marginLeft: 8, padding: 8, border: "none", borderRadius: 6, background: "#0b5ed6", color: "#fff", cursor: "pointer" }}>Verify &amp; enable</button>
                  </div>
                </div>
              )}
              {form.step !== "verify" && (
                <button onClick={setup2fa} style={{ padding: 10, border: "none", borderRadius: 6, background: "#0b5ed6", color: "#fff", cursor: "pointer", width: "100%" }}>Set up 2FA</button>
              )}
            </div>
          )}
        </div>
      )}

      {/* ---------- DATA EXPORT ---------- */}
      {tab === "export" && (
        <div>
          <h3 style={{ fontSize: 16, marginBottom: 10, color: "#0f172a" }}>Export my data</h3>
          <div style={{ border: "1px solid #e2e8f0", borderRadius: 10, padding: 16, background: "#fff" }}>
            <div style={{ fontSize: 13, color: "#64748b", marginBottom: 10 }}>Request a copy of all your personal data (reports, prescriptions, appointments, files). Prepared as a downloadable archive.</div>
            <button onClick={requestExport} style={{ padding: 10, border: "none", borderRadius: 6, background: "#0b5ed6", color: "#fff", cursor: "pointer", width: "100%" }}>Request data export</button>
            {exportStatus && (
              <div style={{ marginTop: 12, fontSize: 13, color: "#64748b" }}>
                Status: <strong>{exportStatus.status}</strong>{exportStatus.downloadUrl ? ` • <a href={exportStatus.downloadUrl} target="_blank" rel="noopener">Download</a>` : ""}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ---------- PHARMACY ---------- */}
      {tab === "pharmacy" && (
        <div>
          <h3 style={{ fontSize: 16, marginBottom: 10, color: "#0f172a" }}>Pharmacy orders</h3>
          <div style={{ color: "#64748b", fontSize: 13, marginBottom: 10 }}>Order medicines from a signed prescription. (Pharmacy integration coming soon — placeholder UI.)</div>
          <div style={{ border: "1px solid #e2e8f0", borderRadius: 10, padding: 16, background: "#fff" }}>
            <div style={{ fontSize: 13, color: "#64748b" }}>No pharmacy orders yet.</div>
          </div>
        </div>
      )}

      {/* ---------- LAB ---------- */}
      {tab === "lab" && (
        <div>
          <h3 style={{ fontSize: 16, marginBottom: 10, color: "#0f172a" }}>Lab test orders</h3>
          <div style={{ color: "#64748b", fontSize: 13, marginBottom: 10 }}>Book lab tests and receive results online. (Lab integration coming soon — placeholder UI.)</div>
          <div style={{ border: "1px solid #e2e8f0", borderRadius: 10, padding: 16, background: "#fff" }}>
            <div style={{ fontSize: 13, color: "#64748b" }}>No lab orders yet.</div>
          </div>
        </div>
      )}

      {/* ---------- MEDICINE TRACKER ---------- */}
      {tab === "medicine" && (
        <div>
          <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16,flexWrap:"wrap",gap:10 }}>
            <div>
              <h3 style={{ fontSize: 16, marginBottom: 4, color: "#0f172a" }}>💊 Medicine Tracker</h3>
              <div style={{ fontSize: 13, color: "#64748b" }}>Set reminders and log when you take your medicines.</div>
            </div>
            {adherence && (
              <div style={{ textAlign:"right" }}>
                <div style={{ fontSize: 13, color: "#64748b" }}>Adherence</div>
                <div style={{ fontSize: 28, fontWeight: 800, color: adherence.adherence >= 80 ? "#059669" : adherence.adherence >= 50 ? "#d97706" : "#dc2626" }}>
                  {adherence.adherence}%
                </div>
              </div>
            )}
          </div>

          {/* Add reminder form */}
          <div style={{ border:"1px solid #e2e8f0",borderRadius:16,padding:16,background:"#fff",marginBottom:16,boxShadow:"var(--shadow-sm)" }}>
            <h4 style={{ fontSize:14, marginBottom:10, color:"#0f172a", marginTop:0 }}>Add new reminder</h4>
            <div style={{ display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))",gap:10,alignItems:"end" }}>
              <input value={newMed.medicineName} onChange={e=>setNewMed({...newMed,medicineName:e.target.value})} placeholder="Medicine name" />
              <input value={newMed.genericName} onChange={e=>setNewMed({...newMed,genericName:e.target.value})} placeholder="Generic (optional)" />
              <input value={newMed.dosage} onChange={e=>setNewMed({...newMed,dosage:e.target.value})} placeholder="Dosage (e.g. 500mg)" />
              <input type="number" value={newMed.frequencyPerDay} onChange={e=>setNewMed({...newMed,frequencyPerDay:Math.max(1,Math.min(24,Number(e.target.value)||1))})} placeholder="Times/day" />
              <input value={newMed.timesOfDay.join(",")} onChange={e=>setNewMed({...newMed,timesOfDay:e.target.value.split(",").map(s=>s.trim()).filter(Boolean)})} placeholder="Times (08:00, 20:00)" />
              <input type="date" value={newMed.startDate} onChange={e=>setNewMed({...newMed,startDate:e.target.value})} />
              <button onClick={async()=>{
                setLoading(true);setErr("");
                try{
                  const d = await api("/commercial/medicine/reminders",{method:"POST",body:json(newMed)});
                  setMsg("Reminder added!");
                  setNewMed({medicineName:"",genericName:"",dosage:"",frequencyPerDay:1,timesOfDay:["08:00"],startDate:"",instructions:""});
                  await load();
                }catch(e:any){setErr(e.message||"Failed to add reminder");}
                finally{setLoading(false);}
              }} style={{ background:"var(--brand)",color:"#fff",border:"none" }}>Add</button>
            </div>
          </div>

          {/* Active reminders */}
          <h4 style={{ fontSize: 14, marginBottom: 8, color: "#0f172a", marginTop: 0 }}>Active reminders</h4>
          <div style={{ border: "1px solid #e2e8f0", borderRadius: 16, background: "#fff", marginBottom: 20, overflow: "hidden" }}>
            {reminders.length === 0 ? (
              <div style={{ padding: 20, color: "#64748b", textAlign: "center" }}>No reminders yet. Add one above.</div>
            ) : reminders.map((r) => (
              <div key={r._id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, padding: "12px 16px", borderBottom: "1px solid #f1f5f9", flexWrap: "wrap" }}>
                <div style={{ flex: 1, minWidth: 160 }}>
                  <div style={{ fontWeight: 700, color: "#0f172a" }}>{r.medicineName}</div>
                  <div style={{ fontSize: 12, color: "#64748b" }}>
                    {[r.genericName, r.dosage].filter(Boolean).join(" · ")}
                    {r.timesOfDay.length ? (r.genericName || r.dosage ? " · " : "") + r.timesOfDay.join(", ") : ""}
                  </div>
                  {r.instructions && <div style={{ fontSize: 12, color: "#64748b" }}>{r.instructions}</div>}
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true); setErr(""); setMsg("");
                      try {
                        await api("/commercial/medicine/intake", { method: "POST", body: json({ reminderId: r._id, status: "taken" }) });
                        setMsg("Logged: " + r.medicineName + " taken.");
                        await load();
                      } catch (e: any) { setErr(e.message || "Could not log this dose"); }
                      finally { setBusy(false); }
                    }}
                    style={{ background: "#059669", color: "#fff", border: "none", padding: "8px 14px", fontSize: 13 }}
                  >Taken</button>
                  <button
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true); setErr(""); setMsg("");
                      try {
                        await api("/commercial/medicine/intake", { method: "POST", body: json({ reminderId: r._id, status: "skipped" }) });
                        setMsg("Logged: " + r.medicineName + " skipped.");
                        await load();
                      } catch (e: any) { setErr(e.message || "Could not log this dose"); }
                      finally { setBusy(false); }
                    }}
                    className="outline"
                    style={{ padding: "8px 14px", fontSize: 13 }}
                  >Skipped</button>
                  <button
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true); setErr(""); setMsg("");
                      try {
                        await api("/commercial/medicine/reminders/" + r._id, { method: "DELETE" });
                        setMsg("Reminder deleted.");
                        await load();
                      } catch (e: any) { setErr(e.message || "Could not delete the reminder"); }
                      finally { setBusy(false); }
                    }}
                    style={{ background: "#fee2e2", color: "#b91c1c", border: "1px solid #fecaca", padding: "8px 14px", fontSize: 13 }}
                  >Delete</button>
                </div>
              </div>
            ))}
          </div>

          {/* Recent doses */}
          <h4 style={{ fontSize: 14, marginBottom: 8, color: "#0f172a", marginTop: 0 }}>Recent doses</h4>
          <div style={{ border: "1px solid #e2e8f0", borderRadius: 16, background: "#fff", overflow: "hidden" }}>
            {intakeLogs.length === 0 ? (
              <div style={{ padding: 20, color: "#64748b", textAlign: "center" }}>No doses logged yet.</div>
            ) : intakeLogs.slice(0, 12).map((l) => (
              <div key={l._id} style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "10px 16px", borderBottom: "1px solid #f1f5f9", fontSize: 13 }}>
                <span style={{ color: "#0f172a", fontWeight: 600 }}>{(l as any).reminderId?.medicineName || "Medicine"}</span>
                <span style={{ color: l.status === "taken" ? "#059669" : l.status === "skipped" ? "#d97706" : "#dc2626", fontWeight: 600 }}>
                  {l.status} · {fmtDate(l.takenAt)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ---------- SECURITY & BIOMETRIC ---------- */}
      {tab === "security" && (
        <div>
          <h3 style={{ fontSize: 16, marginBottom: 6, color: "#0f172a" }}>Security &amp; biometric login</h3>
          <p style={{ fontSize: 13, color: "#64748b", marginTop: 0, marginBottom: 16 }}>
            Skip the password when you reopen the MedAI Android app — your fingerprint or face is checked on the device itself and never leaves it.
          </p>

          <div style={{ border: "1px solid #e2e8f0", borderRadius: 16, padding: 20, background: "#fff", boxShadow: "var(--shadow-sm)", marginBottom: 16 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <div style={{ minWidth: 200 }}>
                <div style={{ fontWeight: 700, fontSize: 15, color: "#0f172a" }}>Fingerprint / face unlock</div>
                <div style={{ fontSize: 13, color: "#64748b" }}>
                  {!native ? "Available in the Android app only (this page is running in a browser)."
                    : bioAvail === null ? "Checking this device…"
                    : bioAvail.available ? "Detected: " + bioAvail.type
                    : bioAvail.reason}
                </div>
              </div>
              <button
                className={bioEnabled ? "outline" : "primary"}
                disabled={!native || bioAvail === null || !bioAvail.available || busy}
                onClick={async () => {
                  setBusy(true); setErr(""); setMsg("");
                  const next = !bioEnabled;
                  if (next) {
                    const check = await unlockWithBiometric("Confirm your fingerprint to turn on unlock");
                    if (!check.ok) {
                      setBusy(false);
                      if (!check.cancelled) setErr(check.reason);
                      return;
                    }
                    setBiometricLockEnabled(true);
                  } else {
                    setBiometricLockEnabled(false);
                  }
                  try {
                    await api("/commercial/biometric/enable", { method: "POST", body: json({ enabled: next, type: next ? (bioAvail && bioAvail.type !== "none" ? bioAvail.type : "fingerprint") : "none" }) });
                    setMsg(next ? "Biometric unlock is on. You will be asked for your fingerprint next time you open the app." : "Biometric unlock is off.");
                    await load();
                  } catch (e: any) { setErr(e.message || "Could not save the setting"); }
                  finally { setBusy(false); }
                }}
              >
                {busy ? "Working…" : bioEnabled ? "Turn off" : "Turn on"}
              </button>
            </div>

            {bioEnabled && (
              <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid #f1f5f9", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <span className="badge-ok">Enabled on this account</span>
                <button
                  className="outline"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true); setErr(""); setMsg("");
                    const r = await unlockWithBiometric("Test your fingerprint");
                    setBusy(false);
                    if (r.ok) setMsg("Fingerprint verified."); else if (!r.cancelled) setErr(r.reason);
                  }}
                >
                  Test fingerprint
                </button>
              </div>
            )}
          </div>

          <div style={{ border: "1px solid #e2e8f0", borderRadius: 16, padding: 18, background: "#fff", marginBottom: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#0f172a", marginBottom: 4 }}>Server connection</div>
            <div style={{ fontSize: 12.5, color: "#64748b", wordBreak: "break-all", marginBottom: 10 }}>
              {connBase ? connBase.replace(/^https?:\/\//, "") : (API ? API.replace(/^https?:\/\//, "") : "detecting…")}
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <button className="outline" disabled={connBusy} onClick={async () => {
                setConnBusy(true); setConnNote("");
                const r = await pingServer();
                setConnBase(r.base);
                setConnOk(r.ok);
                setConnNote(r.detail);
                setConnBusy(false);
              }}>{connBusy ? "Testing…" : "Test connection"}</button>
              <span style={{ fontSize: 12.5, color: connOk === null ? "#64748b" : connOk ? "#059669" : "#dc2626", fontWeight: 600 }}>{connNote}</span>
            </div>
            <details style={{ marginTop: 12 }}>
              <summary style={{ cursor: "pointer", fontSize: 12.5, color: "#475569", fontWeight: 600 }}>Advanced: set the server address by hand</summary>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
                <input value={connInput} onChange={(e) => setConnInput(e.target.value)} placeholder="https://your-api.onrender.com" style={{ flex: 1, minWidth: 200 }} />
                <button className="primary" onClick={async () => {
                  const r = setApiBase(connInput);
                  setConnNote(r.message);
                  if (!r.ok) return;
                  const p = await pingServer();
                  setConnBase(p.base); setConnOk(p.ok); setConnNote(r.message + " · " + p.detail);
                }}>Save</button>
                <button className="outline" onClick={async () => {
                  clearApiBase(); setConnInput("");
                  const p = await pingServer();
                  setConnBase(p.base); setConnOk(p.ok); setConnNote("Automatic · " + p.detail);
                }}>Automatic</button>
              </div>
              <p style={{ fontSize: 11.5, color: "#94a3b8", margin: "8px 0 0" }}>
                The app normally finds the server itself. Use this only if the address changed.
              </p>
            </details>
          </div>

          <div style={{ border: "1px solid #e2e8f0", borderRadius: 16, padding: 18, background: "#f8fafc" }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#0f172a", marginBottom: 8 }}>How it protects your account</div>
            <ul style={{ margin: 0, paddingLeft: 18, color: "#64748b", fontSize: 13, lineHeight: 1.9 }}>
              <li>Your fingerprint or face is matched by Android — MedAI never receives or stores biometric data.</li>
              <li>The app only re-opens for the enrolled finger; after several failed attempts Android asks for your device PIN.</li>
              <li>“Sign out and use password” on the lock screen clears the saved session on this device.</li>
              <li>Unlock works offline; your existing session token stays on the device until you sign out.</li>
            </ul>
          </div>
        </div>
      )}


      {/* ---------- ADMIN OVERVIEW ---------- */}
      {tab === "overview" && user.role === "admin" && (
        <div>
          <h3 style={{ fontSize: 16, marginBottom: 10, color: "#0f172a" }}>Admin — Commercial overview</h3>
          <div style={{ color: "#64748b", fontSize: 13, marginBottom: 10 }}>Aggregate payment & subscription metrics.</div>
          <div style={{ border: "1px solid #e2e8f0", borderRadius: 10, padding: 16, background: "#fff" }}>
            <div style={{ fontSize: 13, color: "#64748b" }}>Loading overview…</div>
          </div>
        </div>
      )}
    </div>
  );
}
