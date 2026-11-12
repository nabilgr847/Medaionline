// © 2026 MD Gausur Rahman Nabil. All rights reserved. MedAI Hospital.
// Browser fingerprint / face sign-in (WebAuthn "passkeys").
//
// The Android app uses the phone's own biometric prompt (see biometric.ts). A PC or a mobile
// browser has no such bridge, so this module talks to the platform authenticator instead:
// Windows Hello (face or fingerprint), Touch ID, Android screen-lock biometrics, or a key.
// Only a public key is ever stored on the server; the private key stays in the device.
import { startRegistration, startAuthentication, browserSupportsWebAuthn, platformAuthenticatorIsAvailable } from "@simplewebauthn/browser";

const EMAIL_KEY = "medai_passkey_email";

export function rememberPasskeyEmail(email: string) {
  try { email ? localStorage.setItem(EMAIL_KEY, email.toLowerCase().trim()) : localStorage.removeItem(EMAIL_KEY); } catch { /* ignore */ }
}
export function passkeyEmail(): string {
  try { return localStorage.getItem(EMAIL_KEY) || ""; } catch { return ""; }
}

/** True only when the browser can do a *platform* (built-in) fingerprint/face check. */
export async function passkeysSupported(): Promise<boolean> {
  try {
    if (!browserSupportsWebAuthn()) return false;
    // A USB security key is not what the patient expects here, so require the built-in sensor.
    return await platformAuthenticatorIsAvailable();
  } catch { return false; }
}

const CLIENT_TIMEOUT = "That took too long. Try again and confirm with your fingerprint or face when the device asks.";

/** Adds this device's fingerprint / face to the signed-in account. */
export async function addPasskey(api: any, label: string) {
  const { options } = await api("/auth/webauthn/register/options", { method: "POST", body: JSON.stringify({}) });
  let response: any;
  try {
    response = await startRegistration({ optionsJSON: options });
  } catch (error: any) {
    if (error?.name === "NotAllowedError" || error?.name === "AbortError") throw new Error("Cancelled. Nothing was added.");
    if (error?.name === "InvalidStateError") throw new Error("This device is already added to your account.");
    throw new Error(error?.message || "The device did not complete the fingerprint/face check.");
  }
  const result = await api("/auth/webauthn/register/verify", { method: "POST", body: JSON.stringify({ response, label }) });
  return result?.credentials || [];
}

/** Signs in with a fingerprint / face already registered for this email. */
export async function signInWithPasskey(api: any, email: string) {
  const key = email.toLowerCase().trim();
  const { options } = await api("/auth/webauthn/login/options", { method: "POST", body: JSON.stringify({ email: key }) });
  let response: any;
  try {
    response = await startAuthentication({ optionsJSON: options });
  } catch (error: any) {
    if (error?.name === "NotAllowedError" || error?.name === "AbortError") throw new Error("Cancelled fingerprint/face sign-in.");
    throw new Error(error?.message || CLIENT_TIMEOUT);
  }
  const result = await api("/auth/webauthn/login/verify", { method: "POST", body: JSON.stringify({ email: key, response }) });
  rememberPasskeyEmail(key);
  return result as { token: string; user: { id: string; name: string; email: string; role: string } };
}

export async function listPasskeys(api: any): Promise<Array<{ id: string; label: string; createdAt: string; lastUsedAt?: string }>> {
  const d = await api("/auth/webauthn/credentials");
  return d?.credentials || [];
}

export async function removePasskey(api: any, id: string) {
  const d = await api(`/auth/webauthn/credentials/${id}`, { method: "DELETE" });
  return d?.credentials || [];
}
