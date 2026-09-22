const DB_NAME = "pace-health-e2ee";
const STORE_NAME = "keys";
const KEY_PREFIX = "health-v";
const DEVICE_PRIVATE_ID = "device-private-v1";
const DEVICE_PUBLIC_ID = "device-public-v1";

export const HEALTH_E2EE_ALGORITHM = "AES-256-GCM" as const;
export const HEALTH_E2EE_KEY_WRAP_ALGORITHM = "ECDH-P256/AES-256-KW" as const;
export const HEALTH_E2EE_CURRENT_KEY_VERSION = 1;

function keyId(version: number): string {
  if (!Number.isInteger(version) || version < 1) throw new Error("Invalid health key version");
  return `${KEY_PREFIX}${version}`;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB unavailable"));
  });
}

async function getStoredKey(version: number): Promise<CryptoKey | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const request = tx.objectStore(STORE_NAME).get(keyId(version));
    request.onsuccess = () => resolve((request.result as CryptoKey | undefined) ?? null);
    request.onerror = () => reject(request.error ?? new Error("Unable to read health encryption key"));
  });
}

async function storeKey(version: number, key: CryptoKey): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(key, keyId(version));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Unable to store health encryption key"));
  });
}

export async function getHealthEncryptionKey(version = HEALTH_E2EE_CURRENT_KEY_VERSION): Promise<CryptoKey> {
  const existing = await getStoredKey(version);
  if (existing) return existing;

  const key = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"],
  );
  await storeKey(version, key);
  return key;
}

export async function createHealthMasterKey(version: number): Promise<CryptoKey> {
  const existing = await getStoredKey(version);
  if (existing) return existing;

  const key = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"],
  );
  await storeKey(version, key);
  return key;
}

function toBase64(bytes: Uint8Array): string {
  let value = "";
  for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value);
}

function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  const raw = atob(value);
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}

export async function encryptHealthPayload(
  payload: unknown,
  keyVersion = HEALTH_E2EE_CURRENT_KEY_VERSION,
): Promise<{ ciphertext: string; nonce: string; algorithm: typeof HEALTH_E2EE_ALGORITHM; key_version: number }> {
  const key = await getHealthEncryptionKey(keyVersion);
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(payload));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, plaintext);

  return {
    ciphertext: toBase64(new Uint8Array(ciphertext)),
    nonce: toBase64(nonce),
    algorithm: HEALTH_E2EE_ALGORITHM,
    key_version: keyVersion,
  };
}

export async function decryptHealthPayload(
  ciphertext: string,
  nonce: string,
  keyVersion = HEALTH_E2EE_CURRENT_KEY_VERSION,
): Promise<unknown> {
  const key = await getHealthEncryptionKey(keyVersion);
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64(nonce) },
    key,
    fromBase64(ciphertext),
  );
  return JSON.parse(new TextDecoder().decode(plaintext));
}

async function importDevicePublicKey(publicKey: JsonWebKey): Promise<CryptoKey> {
  if (publicKey.kty !== "EC" || publicKey.crv !== "P-256" || !publicKey.x || !publicKey.y) {
    throw new Error("Invalid ECDH-P256 public key");
  }

  return crypto.subtle.importKey(
    "jwk",
    publicKey,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
}

async function deriveDeviceWrappingKey(peerPublicKey: JsonWebKey): Promise<CryptoKey> {
  const pair = await getHealthDeviceKeyPair();
  const publicKey = await importDevicePublicKey(peerPublicKey);

  return crypto.subtle.deriveKey(
    { name: "ECDH", public: publicKey },
    pair.privateKey,
    { name: "AES-KW", length: 256 },
    false,
    ["wrapKey", "unwrapKey"],
  );
}

export async function wrapHealthMasterKeyForDevice(
  peerPublicKey: JsonWebKey,
  keyVersion = HEALTH_E2EE_CURRENT_KEY_VERSION,
): Promise<{ envelope: string; key_version: number; algorithm: typeof HEALTH_E2EE_KEY_WRAP_ALGORITHM }> {
  const masterKey = await getHealthEncryptionKey(keyVersion);
  const wrappingKey = await deriveDeviceWrappingKey(peerPublicKey);
  const wrapped = await crypto.subtle.wrapKey("raw", masterKey, wrappingKey, "AES-KW");

  return {
    envelope: toBase64(new Uint8Array(wrapped)),
    key_version: keyVersion,
    algorithm: HEALTH_E2EE_KEY_WRAP_ALGORITHM,
  };
}

export async function unwrapHealthMasterKeyFromDevice(
  envelope: string,
  senderPublicKey: JsonWebKey,
  keyVersion: number,
): Promise<CryptoKey> {
  const wrappingKey = await deriveDeviceWrappingKey(senderPublicKey);

  const masterKey = await crypto.subtle.unwrapKey(
    "raw",
    fromBase64(envelope),
    wrappingKey,
    "AES-KW",
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"],
  );

  await storeKey(keyVersion, masterKey);
  return masterKey;
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

export async function clearHealthEncryptionKey(version = HEALTH_E2EE_CURRENT_KEY_VERSION): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(keyId(version));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Unable to remove health encryption key"));
  });
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
