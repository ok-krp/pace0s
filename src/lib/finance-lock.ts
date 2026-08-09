// Verrou partagé Finance + Investissements.
// - PIN haché (SHA-256) stocké en localStorage
// - Déverrouillage en sessionStorage (vidé à la fermeture d'onglet)
// - Option "lockOnEnter" : exige re-saisie à chaque visite (ignore le cache de session)
// - Biométrie (WebAuthn / Face ID / empreinte) — vérification locale via platform authenticator

const KEY_HASH = "pace.privacy.pin.hash";
const KEY_UNLOCKED = "pace.privacy.unlocked";
const KEY_LOCK_ON_ENTER = "pace.privacy.lockOnEnter";
const KEY_BIO_CREDENTIAL = "pace.privacy.bioCredentialId"; // base64url

// Migration des anciennes clés (finance-only)
function migrate() {
  try {
    const old = localStorage.getItem("pace.finance.pin.hash");
    if (old && !localStorage.getItem(KEY_HASH)) localStorage.setItem(KEY_HASH, old);
    const oldUnlocked = sessionStorage.getItem("pace.finance.unlocked");
    if (oldUnlocked && !sessionStorage.getItem(KEY_UNLOCKED)) sessionStorage.setItem(KEY_UNLOCKED, oldUnlocked);
  } catch {
    /* ignore */
  }
}
if (typeof window !== "undefined") migrate();

export async function hashPin(pin: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(pin));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function getStoredHash(): string | null {
  try { return localStorage.getItem(KEY_HASH); } catch { return null; }
}

export async function setPin(pin: string) {
  const h = await hashPin(pin);
  localStorage.setItem(KEY_HASH, h);
  sessionStorage.setItem(KEY_UNLOCKED, "1");
}

export function clearPin() {
  localStorage.removeItem(KEY_HASH);
  sessionStorage.removeItem(KEY_UNLOCKED);
  clearBiometric();
}

export function isProtected(): boolean {
  return !!getStoredHash();
}

export function isUnlocked(): boolean {
  if (getLockOnEnter()) return false; // exige re-saisie à chaque visite
  return sessionStorage.getItem(KEY_UNLOCKED) === "1";
}

export function lockSession() {
  sessionStorage.removeItem(KEY_UNLOCKED);
}

export async function tryUnlock(pin: string): Promise<boolean> {
  const stored = getStoredHash();
  if (!stored) return true;
  const h = await hashPin(pin);
  if (h === stored) {
    sessionStorage.setItem(KEY_UNLOCKED, "1");
    return true;
  }
  return false;
}

// --- Option "demander à chaque visite" ---
export function getLockOnEnter(): boolean {
  try { return localStorage.getItem(KEY_LOCK_ON_ENTER) === "1"; } catch { return false; }
}
export function setLockOnEnter(v: boolean) {
  try {
    if (v) localStorage.setItem(KEY_LOCK_ON_ENTER, "1");
    else localStorage.removeItem(KEY_LOCK_ON_ENTER);
  } catch { /* ignore */ }
}

// --- Biométrie (WebAuthn platform authenticator) ---
function b64uEncode(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64uDecode(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const norm = (s + pad).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(norm);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function isBiometricAvailable(): Promise<boolean> {
  if (typeof window === "undefined" || !window.PublicKeyCredential) return false;
  try {
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}
export function isBiometricEnabled(): boolean {
  try { return !!localStorage.getItem(KEY_BIO_CREDENTIAL); } catch { return false; }
}
export function clearBiometric() {
  try { localStorage.removeItem(KEY_BIO_CREDENTIAL); } catch { /* ignore */ }
}

export async function enrollBiometric(): Promise<void> {
  if (!(await isBiometricAvailable())) throw new Error("Biométrie indisponible sur cet appareil.");
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const userId = crypto.getRandomValues(new Uint8Array(16));
  const cred = (await navigator.credentials.create({
    publicKey: {
      challenge: challenge.buffer as ArrayBuffer,
      rp: { name: "LifeTracker", id: window.location.hostname },
      user: { id: userId.buffer as ArrayBuffer, name: "lifetracker-local", displayName: "LifeTracker" },
      pubKeyCredParams: [
        { type: "public-key", alg: -7 },   // ES256
        { type: "public-key", alg: -257 }, // RS256
      ],
      authenticatorSelection: {
        authenticatorAttachment: "platform",
        userVerification: "required",
        residentKey: "preferred",
      },
      timeout: 60000,
      attestation: "none",
    },
  })) as PublicKeyCredential | null;
  if (!cred) throw new Error("Enregistrement annulé.");
  localStorage.setItem(KEY_BIO_CREDENTIAL, b64uEncode(cred.rawId));
}

export async function verifyBiometric(): Promise<boolean> {
  const stored = (() => { try { return localStorage.getItem(KEY_BIO_CREDENTIAL); } catch { return null; } })();
  if (!stored) return false;
  try {
    const challenge = crypto.getRandomValues(new Uint8Array(32));
    const assertion = await navigator.credentials.get({
      publicKey: {
        challenge: challenge.buffer as ArrayBuffer,
        allowCredentials: [{ type: "public-key", id: b64uDecode(stored).buffer as ArrayBuffer }],
        userVerification: "required",
        timeout: 60000,
        rpId: window.location.hostname,
      },
    });
    if (assertion) {
      sessionStorage.setItem(KEY_UNLOCKED, "1");
      return true;
    }
    return false;
  } catch {
    return false;
  }
}
