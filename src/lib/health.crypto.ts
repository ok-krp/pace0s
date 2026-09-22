import { generateMnemonic } from "bip39";

const DB_NAME = "pace-health-e2ee";
const STORE_NAME = "keys";
const KEY_PREFIX = "health-v";
const CURRENT_VERSION_ID = "health-current-version";
const DEVICE_PRIVATE_ID = "device-private-v1";
const DEVICE_PUBLIC_ID = "device-public-v1";
const DEVICE_ID_ID = "device-id-v1";

export const HEALTH_E2EE_ALGORITHM = "AES-256-GCM" as const;
export const HEALTH_E2EE_KEY_WRAP_ALGORITHM = "ECDH-P256/AES-256-KW" as const;
export const HEALTH_E2EE_RECOVERY_ALGORITHM = "PBKDF2-SHA-256/AES-256-GCM" as const;
export const HEALTH_E2EE_CURRENT_KEY_VERSION = 1;
export const HEALTH_E2EE_RECOVERY_PBKDF2_ITERATIONS = 600_000;

function keyId(version: number): string {
  if (!Number.isInteger(version) || version < 1) throw new Error("Invalid health key version");
  return `${KEY_PREFIX}${version}`;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB unavailable"));
  });
}

async function readStore<T>(id: string): Promise<T | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const request = tx.objectStore(STORE_NAME).get(id);
    request.onsuccess = () => resolve((request.result as T | undefined) ?? null);
    request.onerror = () => reject(request.error ?? new Error("Unable to read E2EE state"));
  });
}

async function writeStore(id: string, value: unknown): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(value, id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Unable to store E2EE state"));
  });
}

async function deleteStore(id: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Unable to remove E2EE state"));
  });
}

export async function getCurrentHealthKeyVersion(): Promise<number> {
  return (await readStore<number>(CURRENT_VERSION_ID)) ?? HEALTH_E2EE_CURRENT_KEY_VERSION;
}

export async function setCurrentHealthKeyVersion(version: number): Promise<void> {
  if (!Number.isInteger(version) || version < 1) throw new Error("Invalid health key version");
  await writeStore(CURRENT_VERSION_ID, version);
}

async function getStoredKey(version: number): Promise<CryptoKey | null> {
  return readStore<CryptoKey>(keyId(version));
}

async function storeKey(version: number, key: CryptoKey): Promise<void> {
  await writeStore(keyId(version), key);
}

export async function createHealthMasterKey(version: number): Promise<CryptoKey> {
  const existing = await getStoredKey(version);
  if (existing) return existing;
  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
  await storeKey(version, key);
  return key;
}

export async function getHealthEncryptionKey(version = await getCurrentHealthKeyVersion()): Promise<CryptoKey> {
  return createHealthMasterKey(version);
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

export async function encryptHealthPayload(payload: unknown, keyVersion = await getCurrentHealthKeyVersion()) {
  const key = await getHealthEncryptionKey(keyVersion);
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(payload));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, plaintext);
  return {
    ciphertext: toBase64(new Uint8Array(ciphertext)),
    nonce: toBase64(nonce),
    algorithm: HEALTH_E2EE_ALGORITHM,
    key_version: resolvedVersion,
  };
}

export async function decryptHealthPayload(
  ciphertext: string,
  nonce: string,
  keyVersion = await getCurrentHealthKeyVersion(),
): Promise<unknown> {
  const key = await getHealthEncryptionKey(keyVersion);
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64(nonce) }, key, fromBase64(ciphertext));
  return JSON.parse(new TextDecoder().decode(plaintext));
}

async function importDevicePublicKey(publicKey: JsonWebKey): Promise<CryptoKey> {
  if (publicKey.kty !== "EC" || publicKey.crv !== "P-256" || !publicKey.x || !publicKey.y) {
    throw new Error("Invalid ECDH-P256 public key");
  }
  return crypto.subtle.importKey("jwk", publicKey, { name: "ECDH", namedCurve: "P-256" }, false, []);
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
  keyVersion = await getCurrentHealthKeyVersion(),
) {
  const masterKey = await getHealthEncryptionKey(keyVersion);
  const wrappingKey = await deriveDeviceWrappingKey(peerPublicKey);
  const wrapped = await crypto.subtle.wrapKey("raw", masterKey, wrappingKey, "AES-KW");
  return { envelope: toBase64(new Uint8Array(wrapped)), key_version: resolvedVersion, algorithm: HEALTH_E2EE_KEY_WRAP_ALGORITHM };
}

export async function unwrapHealthMasterKeyFromDevice(
  envelope: string,
  senderPublicKey: JsonWebKey,
  keyVersion: number,
): Promise<CryptoKey> {
  const wrappingKey = await deriveDeviceWrappingKey(senderPublicKey);
  const masterKey = await crypto.subtle.unwrapKey(
    "raw", fromBase64(envelope), wrappingKey, "AES-KW",
    { name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"],
  );
  await storeKey(keyVersion, masterKey);
  await setCurrentHealthKeyVersion(Math.max(await getCurrentHealthKeyVersion(), keyVersion));
  return masterKey;
}

export async function getHealthDeviceKeyPair(): Promise<CryptoKeyPair> {
  const [privateKey, publicKey] = await Promise.all([
    readStore<CryptoKey>(DEVICE_PRIVATE_ID),
    readStore<CryptoKey>(DEVICE_PUBLIC_ID),
  ]);
  if (privateKey && publicKey) return { privateKey, publicKey };

  const pair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveKey"]);
  const privateJwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  const persistedPrivateKey = await crypto.subtle.importKey(
    "jwk", privateJwk, { name: "ECDH", namedCurve: "P-256" }, false, ["deriveKey"],
  );
  await writeStore(DEVICE_PRIVATE_ID, persistedPrivateKey);
  await writeStore(DEVICE_PUBLIC_ID, pair.publicKey);
  return { privateKey: persistedPrivateKey, publicKey: pair.publicKey };
}

export async function getHealthDevicePublicKey(): Promise<JsonWebKey> {
  return crypto.subtle.exportKey("jwk", (await getHealthDeviceKeyPair()).publicKey);
}

export async function getRegisteredHealthDeviceId(): Promise<string | null> {
  return readStore<string>(DEVICE_ID_ID);
}

export async function setRegisteredHealthDeviceId(deviceId: string): Promise<void> {
  if (!/^[0-9a-f-]{36}$/i.test(deviceId)) throw new Error("Invalid device id");
  await writeStore(DEVICE_ID_ID, deviceId);
}

async function deriveRecoveryKey(mnemonic: string, salt: Uint8Array): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey("raw", new TextEncoder().encode(mnemonic.normalize("NFKD")), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: HEALTH_E2EE_RECOVERY_PBKDF2_ITERATIONS, hash: "SHA-256" },
    baseKey, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"],
  );
}

export async function createHealthRecoveryEnvelope(keyVersion = await getCurrentHealthKeyVersion()) {
  const mnemonic = generateMnemonic(128);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const recoveryKey = await deriveRecoveryKey(mnemonic, salt);
  const masterKey = await getHealthEncryptionKey(keyVersion);
  const rawMasterKey = await crypto.subtle.exportKey("raw", masterKey);
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const aad = new TextEncoder().encode(`pace-health-recovery-v1:${resolvedVersion}`);
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce, additionalData: new Uint8Array([...salt, ...aad]) },
    recoveryKey, rawMasterKey,
  );
  return {
    mnemonic,
    envelope: `${toBase64(salt)}.${toBase64(new Uint8Array(encrypted))}`,
    nonce: toBase64(nonce),
    algorithm: HEALTH_E2EE_RECOVERY_ALGORITHM,
    key_version: resolvedVersion,
  };
}

export async function unwrapHealthMasterKeyFromRecovery(
  mnemonic: string, envelope: string, nonce: string, keyVersion: number,
): Promise<CryptoKey> {
  const [saltB64, ciphertextB64] = envelope.split(".");
  if (!saltB64 || !ciphertextB64) throw new Error("Invalid recovery envelope");
  const salt = fromBase64(saltB64);
  const recoveryKey = await deriveRecoveryKey(mnemonic.trim(), salt);
  const aad = new TextEncoder().encode(`pace-health-recovery-v1:${keyVersion}`);
  const rawMasterKey = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64(nonce), additionalData: new Uint8Array([...salt, ...aad]) },
    recoveryKey, fromBase64(ciphertextB64),
  );
  const masterKey = await crypto.subtle.importKey("raw", rawMasterKey, { name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
  await storeKey(keyVersion, masterKey);
  await setCurrentHealthKeyVersion(keyVersion);
  return masterKey;
}

export async function clearHealthEncryptionKey(version = 1): Promise<void> { await deleteStore(keyId(version)); }
export async function clearHealthDeviceKeyPair(): Promise<void> {
  await deleteStore(DEVICE_PRIVATE_ID);
  await deleteStore(DEVICE_PUBLIC_ID);
  await deleteStore(DEVICE_ID_ID);
}
