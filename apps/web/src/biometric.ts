// © 2026 MD Gausur Rahman Nabil. All rights reserved. MedAI Hospital.
// Biometric (fingerprint / face) unlock helper.
//
// Works inside the MedAI Android app (Capacitor). In a normal browser the
// plugin has no native bridge, so every call fails softly and the UI can
// fall back to the password form.

export const BIOMETRIC_LOCK_KEY = "medai_biometric_lock";

/**
 * The session kept for biometric sign-in.
 *
 * "Sign out" must not leave a usable session behind, but the device-lock screen and the
 * "Sign in with fingerprint" button would be pointless without one. So the token is kept
 * in its own slot that only a *successful* fingerprint/face check can use, and it is
 * removed on a real sign-out, on a rejected token, or when the lock is switched off.
 */
export const BIOMETRIC_TOKEN_KEY = "medai_bio_token";

export function saveBiometricToken(token: string) {
  try { token ? localStorage.setItem(BIOMETRIC_TOKEN_KEY, token) : localStorage.removeItem(BIOMETRIC_TOKEN_KEY); } catch { /* ignore */ }
}
export function biometricToken(): string {
  try { return localStorage.getItem(BIOMETRIC_TOKEN_KEY) || ""; } catch { return ""; }
}
export function forgetBiometricToken() {
  try { localStorage.removeItem(BIOMETRIC_TOKEN_KEY); } catch { /* ignore */ }
}

/** A short, human name for the biometric type this device offers. */
export function biometricLabel(type: string): string {
  switch (type) {
    case "fingerprint": return "fingerprint";
    case "faceid":
    case "face": return "face unlock";
    case "iris": return "iris unlock";
    case "touchid": return "Touch ID";
    default: return "fingerprint or face unlock";
  }
}

/** True when the page runs inside the Capacitor Android shell. */
export function isNativeApp(): boolean {
  const cap = (window as any).Capacitor;
  return !!(cap && typeof cap.isNativePlatform === "function" && cap.isNativePlatform());
}

/** Has the user switched biometric unlock on (on this device)? */
export function biometricLockEnabled(): boolean {
  return localStorage.getItem(BIOMETRIC_LOCK_KEY) === "1";
}

export function setBiometricLockEnabled(enabled: boolean) {
  if (enabled) localStorage.setItem(BIOMETRIC_LOCK_KEY, "1");
  else { localStorage.removeItem(BIOMETRIC_LOCK_KEY); forgetBiometricToken(); }
}

export type BiometricCheck =
  | { ok: true; type: string; available: boolean }
  | { ok: false; type: "none"; available: false; reason: string };

const TYPE_NAMES: Record<number, string> = {
  0: "none",
  1: "touchid",
  2: "faceid",
  3: "fingerprint",
  4: "face",
  5: "iris",
};

/** Ask the device whether biometric authentication is usable right now. */
export async function checkBiometrics(): Promise<BiometricCheck> {
  if (!isNativeApp()) {
    return { ok: false, type: "none", available: false, reason: "Biometric unlock is available only in the MedAI Android app." };
  }
  try {
    const mod: any = await import("@aparajita/capacitor-biometric-auth");
    const result = await mod.BiometricAuth.checkBiometry();
    const type = TYPE_NAMES[Number(result?.biometryType)] || "none";
    if (!result?.isAvailable) {
      return {
        ok: false,
        type: "none",
        available: false,
        reason: result?.reason || "No fingerprint or face unlock is set up on this device. Add one in Android Settings → Security.",
      };
    }
    return { ok: true, type: type === "none" ? "fingerprint" : type, available: true };
  } catch (e: any) {
    return { ok: false, type: "none", available: false, reason: e?.message || "Biometric hardware is unavailable on this device." };
  }
}

export type UnlockResult = { ok: true } | { ok: false; cancelled: boolean; reason: string };

/** Show the native fingerprint/face prompt. */
export async function unlockWithBiometric(reason = "Unlock MedAI Hospital"): Promise<UnlockResult> {
  if (!isNativeApp()) {
    return { ok: false, cancelled: false, reason: "Biometric unlock runs only inside the MedAI Android app." };
  }
  try {
    const mod: any = await import("@aparajita/capacitor-biometric-auth");
    await mod.BiometricAuth.authenticate({
      reason,
      cancelTitle: "Use password",
      androidTitle: "MedAI Hospital",
      androidSubtitle: reason,
      allowDeviceCredential: false,
      androidConfirmationRequired: false,
    });
    return { ok: true };
  } catch (e: any) {
    const cancelled = e?.code === "userCancel" || e?.code === "systemCancel" || e?.code === "appCancel";
    const map: Record<string, string> = {
      authenticationFailed: "Fingerprint not recognised. Try again.",
      biometryLockout: "Too many attempts. Unlock with your device PIN, then try again.",
      biometryNotAvailable: "Biometric unlock is not available on this device.",
      biometryNotEnrolled: "No fingerprint or face is enrolled on this device.",
      passcodeNotSet: "Set a device PIN, pattern or password to use biometric unlock.",
    };
    return {
      ok: false,
      cancelled,
      reason: map[String(e?.code)] || e?.message || "Biometric verification failed.",
    };
  }
}
