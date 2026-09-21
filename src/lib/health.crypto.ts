const DB_NAME = "pace-health-e2ee";
const STORE_NAME = "keys";
const KEY_ID = "health-v1";
const DEVICE_PRIVATE_ID = "device-private-v1";
const DEVICE_PUBLIC_ID = "device-public-v1";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB unavailable"));
  });
}
async function getStoredKey(): Promise<CryptoKey | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const request = tx.objectStore(STORE_NAME).get(KEY_ID);
    request.onsuccess = () => resolve((request.result as CryptoKey | undefined) ?? null);
    request.onerror = () => reject(request.error ?? new Error("Unable to read health encryption key"));
  });
}
async function storeKey(key: CryptoKey): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(key, KEY_ID);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Unable to store health encryption key"));
  });
}
export async function getHealthEncryptionKey(): Promise<CryptoKey> {
  const existing = await getStoredKey();
  if (existing) return existing;
  // The health master key must be locally exportable so it can be wrapped for a paired device. It is never sent to the server in plaintext; only ciphertext/envelopes leave the device.\n  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
  await storeKey(key);
  return key;
}
function toBase64(bytes: Uint8Array): string {
  let value = "";
  for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value);
}
function fromBase64(value: string): Uint8Array {
  const raw = atob(value);
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}
export async function encryptHealthPayload(payload: unknown): Promise<{ ciphertext: string; nonce: string }> {
  const key = await getHealthEncryptionKey();
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(payload));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, plaintext);
  return { ciphertext: toBase64(new Uint8Array(ciphertext)), nonce: toBase64(nonce) };
}
export async function decryptHealthPayload(ciphertext: string, nonce: string): Promise<unknown> {
  const key = await getHealthEncryptionKey();
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64(nonce) }, key, fromBase64(ciphertext));
  return JSON.parse(new TextDecoder().decode(plaintext));
}
export async function clearHealthEncryptionKey(): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(KEY_ID);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Unable to remove health encryption key"));
  });
}


export async function getHealthDeviceKeyPair(): Promise<CryptoKeyPair> {
  const db = await openDb();
  const existing = await new Promise<{ privateKey?: CryptoKey; publicKey?: CryptoKey }>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const privateRequest = tx.objectStore(STORE_NAME).get(DEVICE_PRIVATE_ID);
    const publicRequest = tx.objectStore(STORE_NAME).get(DEVICE_PUBLIC_ID);
    tx.oncomplete = () => resolve({ privateKey: privateRequest.result, publicKey: publicRequest.result });
    tx.onerror = () => reject(tx.error ?? new Error("Unable to read health device key pair"));
  });
  if (existing.privateKey && existing.publicKey) {
    return { privateKey: existing.privateKey, publicKey: existing.publicKey };
  }

  const pair = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveKey"],
  );
  const privateJwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  const privateKey = await crypto.subtle.importKey(
    "jwk",
    privateJwk,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    ["deriveKey"],
  );
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(privateKey, DEVICE_PRIVATE_ID);
    tx.objectStore(STORE_NAME).put(pair.publicKey, DEVICE_PUBLIC_ID);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Unable to store health device key pair"));
  });
  return { privateKey, publicKey: pair.publicKey };
}

export async function getHealthDevicePublicKey(): Promise<JsonWebKey> {
  const pair = await getHealthDeviceKeyPair();
  return crypto.subtle.exportKey("jwk", pair.publicKey);
}

export async function clearHealthDeviceKeyPair(): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(DEVICE_PRIVATE_ID);
    tx.objectStore(STORE_NAME).delete(DEVICE_PUBLIC_ID);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Unable to remove health device key pair"));
  });
}
