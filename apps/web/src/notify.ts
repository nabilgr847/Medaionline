// © 2026 MD Gausur Rahman Nabil. All rights reserved. MedAI Hospital.
// Medicine reminder notifications.
//
// Two very different worlds, one small API:
//   * Inside the Android app the LocalNotifications plugin schedules real alarms, so the
//     reminder fires even when the app is closed or the phone is locked.
//   * In a browser a page cannot schedule anything while it is closed. There we notify
//     while MedAI is open and say so plainly instead of promising what we cannot deliver.
import { isNativeApp } from "./biometric";

export type Reminder = {
  _id: string;
  medicineName: string;
  dosage?: string;
  timesOfDay?: string[];
  active?: boolean;
  startDate?: string;
  endDate?: string;
};

const DEDUPE_KEY = "medai_reminder_sent";
const NOTIFY_PREF = "medai_reminders_on";

type NativePlugin = {
  requestPermissions: () => Promise<{ display: string }>;
  checkPermissions: () => Promise<{ display: string }>;
  schedule: (o: { notifications: any[] }) => Promise<void>;
  cancel: (o: { notifications: { id: number }[] }) => Promise<void>;
  getPending: () => Promise<{ notifications: any[] }>;
};

function plugin(): NativePlugin | null {
  try {
    const p = (window as any)?.Capacitor?.Plugins?.LocalNotifications;
    return p && typeof p.schedule === "function" ? (p as NativePlugin) : null;
  } catch { return null; }
}

export const notifySupported = (): boolean => {
  if (isNativeApp()) return !!plugin();
  try { return typeof Notification !== "undefined"; } catch { return false; }
};

export function remindersEnabled(): boolean {
  try { return localStorage.getItem(NOTIFY_PREF) === "1"; } catch { return false; }
}

export function setRemindersEnabled(on: boolean) {
  try { on ? localStorage.setItem(NOTIFY_PREF, "1") : localStorage.removeItem(NOTIFY_PREF); } catch { /* ignore */ }
  window.dispatchEvent(new Event("medai-reminders-pref"));
}

/** Asks the OS/browser for permission. Must be called from a click. */
export async function requestNotifyPermission(): Promise<{ ok: boolean; message: string }> {
  const native = plugin();
  if (native) {
    try {
      const res = await native.requestPermissions();
      const ok = res.display === "granted";
      return { ok, message: ok ? "Notifications allowed." : "Android blocked notifications. Open Settings → Apps → MedAI Hospital → Notifications and allow them." };
    } catch {
      return { ok: false, message: "Could not ask Android for notification permission." };
    }
  }
  if (typeof Notification === "undefined") {
    return { ok: false, message: "This browser cannot show notifications. Install the MedAI app for reminders that work when it is closed." };
  }
  if (Notification.permission === "granted") return { ok: true, message: "Notifications allowed." };
  if (Notification.permission === "denied") {
    return { ok: false, message: "Notifications are blocked for this site. Allow them in the browser's site settings, then try again." };
  }
  const result = await Notification.requestPermission();
  return result === "granted"
    ? { ok: true, message: "Notifications allowed. Keep MedAI open (or installed) to get them." }
    : { ok: false, message: "Notifications were not allowed. You can still see today's doses in the Medicine tracker." };
}

/** "08:30" → { hour: 8, minute: 30 } */
function parseTime(value: string): { hour: number; minute: number } | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(value || "").trim());
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

const today = () => new Date().toISOString().slice(0, 10);

function activeToday(r: Reminder, now = new Date()): boolean {
  if (r.active === false) return false;
  const d = now.toISOString().slice(0, 10);
  if (r.startDate && d < String(r.startDate).slice(0, 10)) return false;
  if (r.endDate && d > String(r.endDate).slice(0, 10)) return false;
  return true;
}

/** Stable notification ids so a reschedule replaces the old alarms instead of piling up. */
function notificationId(index: number): number {
  return 1000 + index;
}

/**
 * Schedules the daily alarms (Android) or starts the in-page checker (browser).
 * Safe to call often: it always replaces what came before.
 */
export async function syncReminders(reminders: Reminder[]): Promise<{ scheduled: number; mode: "native" | "in-page" | "off"; message: string }> {
  if (!remindersEnabled()) return { scheduled: 0, mode: "off", message: "" };

  const native = plugin();
  const wanted = reminders.filter((r) => activeToday(r) && (r.timesOfDay || []).length);

  if (native) {
    try {
      const pending = await native.getPending().catch(() => ({ notifications: [] }));
      const mine = (pending.notifications || []).filter((n) => Number(n.id) >= 1000 && Number(n.id) < 2000);
      if (mine.length) await native.cancel({ notifications: mine.map((n) => ({ id: Number(n.id) })) }).catch(() => {});

      const notifications: any[] = [];
      let index = 0;
      for (const r of wanted) {
        for (const time of r.timesOfDay || []) {
          const t = parseTime(time);
          if (!t) continue;
          notifications.push({
            id: notificationId(index++),
            title: `Time for ${r.medicineName}`,
            body: [r.dosage, `${time} dose`, "Open MedAI to log it as taken or skipped."].filter(Boolean).join(" · "),
            schedule: { on: { hour: t.hour, minute: t.minute }, allowWhileIdle: true, repeats: true },
            smallIcon: "ic_stat_icon",
            channelId: "medai-reminders",
          });
        }
      }
      if (notifications.length) {
        await native.schedule({ notifications });
      }
      return { scheduled: notifications.length, mode: "native", message: notifications.length ? `${notifications.length} daily reminder${notifications.length === 1 ? "" : "s"} scheduled on this phone.` : "No active reminders to schedule." };
    } catch (e: any) {
      return { scheduled: 0, mode: "native", message: "Could not schedule reminders: " + (e?.message || "unknown error") };
    }
  }

  // Browser: check every 30 s while the page is alive.
  startInPageChecker(wanted);
  return { scheduled: wanted.length, mode: "in-page", message: "Reminders will appear while MedAI is open. Install the app to be notified when it is closed." };
}

let checker: number | null = null;
let checkerReminders: Reminder[] = [];

export function startInPageChecker(reminders: Reminder[]) {
  checkerReminders = reminders;
  if (checker !== null) return;
  checker = window.setInterval(tick, 30_000);
  tick();
}

export function stopInPageChecker() {
  if (checker !== null) { window.clearInterval(checker); checker = null; }
  checkerReminders = [];
}

function alreadySent(key: string): boolean {
  try {
    const raw = localStorage.getItem(DEDUPE_KEY);
    const map = raw ? JSON.parse(raw) : {};
    return map[key] === today();
  } catch { return false; }
}

function markSent(key: string) {
  try {
    const raw = localStorage.getItem(DEDUPE_KEY);
    const map = raw && typeof raw === "object" ? JSON.parse(raw) : {};
    map[key] = today();
    localStorage.setItem(DEDUPE_KEY, JSON.stringify(map));
  } catch { /* ignore */ }
}

async function tick() {
  if (!remindersEnabled() || typeof Notification === "undefined") return;
  if (Notification.permission !== "granted") return;
  const now = new Date();
  const hhmm = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  for (const r of checkerReminders) {
    if (!activeToday(r)) continue;
    for (const time of r.timesOfDay || []) {
      if (String(time).slice(0, 5) !== hhmm) continue;
      const key = `${r._id}:${hhmm}`;
      if (alreadySent(key)) continue;
      markSent(key);
      showWebNotification(r, hhmm);
    }
  }
}

async function showWebNotification(r: Reminder, time: string) {
  const options = {
    body: [r.dosage, `${time} dose`, "Open MedAI to log it as taken or skipped."].filter(Boolean).join(" · "),
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    tag: `medai-${r._id}-${time}`,
    data: { url: "/" },
  };
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) await reg.showNotification(`Time for ${r.medicineName}`, options);
    else new Notification(`Time for ${r.medicineName}`, options);
  } catch { /* the browser can refuse; the tracker still lists the dose */ }
}
