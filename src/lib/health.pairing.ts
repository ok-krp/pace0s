import {
  getHealthDedupeRootKey,
  getHealthEncryptionKey,
  importHealthDedupeRootKey,
  importHealthMasterKey,
  setCurrentHealthKeyVersion,
} from "@/lib/health.crypto";

const encoder = new TextEncoder();

export const HEALTH_PAIRING_PROTOCOL_VERSION = "pace-health-pairing-v1";
export const HEALTH_PAIRING_ALGORITHM =
  "ECDH-P256/HKDF-SHA256/AES-256-KW" as const;

export type PairingContext = {
  sessionId: string;
  challenge: string;
  senderDeviceId: string;
  recipientDeviceId: string;
  keyVersion: number;
  senderEphemeralPublicKey: JsonWebKey;
  recipientEphemeralPublicKey: JsonWebKey;
};

export type HealthPairingEnvelope = {
  version: 1;
  health_master_key: {
    wrapped_key: string;
    key_version: number;
  };
  dedupe_root_key: {
    wrapped_key: string;
  };
};

function assertP256PublicKey(key: JsonWebKey): void {
  if (
    key.kty !== "EC" ||
    key.crv !== "P-256" ||
    typeof key.x !== "string" ||
    typeof key.y !== "string"
  ) {
    throw new Error("Invalid ECDH P-256 public key");
  }
}

function canonicalPublicKey(key: JsonWebKey): string {
  assertP256PublicKey(key);
  return JSON.stringify({
    crv: key.crv,
    kty: key.kty,
    x: key.x,
    y: key.y,
  });
}

function contextBytes(context: PairingContext): Uint8Array {
  return encoder.encode(
    JSON.stringify([
      HEALTH_PAIRING_PROTOCOL_VERSION,
      context.sessionId.normalize("NFC"),
      context.challenge.normalize("NFC"),
      context.senderDeviceId.normalize("NFC"),
      context.recipientDeviceId.normalize("NFC"),
      context.keyVersion,
      canonicalPublicKey(context.senderEphemeralPublicKey),
      canonicalPublicKey(context.recipientEphemeralPublicKey),
    ]),
  );
}

async function derivePairingBits(
  sharedSecret: ArrayBuffer,
  context: PairingContext,
  purpose: "wrap" | "sas",
): Promise<ArrayBuffer> {
  const ikm = await crypto.subtle.importKey(
    "raw",
    sharedSecret,
    "HKDF",
    false,
    ["deriveBits"],
  );

  const salt = encoder.encode(
    `${HEALTH_PAIRING_PROTOCOL_VERSION}/${purpose}/${context.sessionId}`,
  );

  return crypto.subtle.deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt,
      info: encoder.encode(
        JSON.stringify([purpose, Array.from(contextBytes(context))]),
      ),
    },
    ikm,
    256,
  );
}

export async function createPairingSessionMaterial(): Promise<{
  secret: string;
  secretHash: string;
  challenge: string;
}> {
  const secretBytes = crypto.getRandomValues(new Uint8Array(32));
  const challengeBytes = crypto.getRandomValues(new Uint8Array(32));
  const secret = toBase64Url(secretBytes);
  const challenge = toBase64Url(challengeBytes);
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(secret));
  return {
    secret,
    secretHash: toHex(new Uint8Array(digest)),
    challenge,
  };
}

export async function generatePairingEphemeralKeyPair(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"],
  );
}

export async function exportPairingPublicKey(
  publicKey: CryptoKey,
): Promise<JsonWebKey> {
  return crypto.subtle.exportKey("jwk", publicKey);
}

export async function derivePairingWrappingKey(
  privateKey: CryptoKey,
  peerPublicKey: JsonWebKey,
  context: PairingContext,
): Promise<CryptoKey> {
  assertP256PublicKey(peerPublicKey);

  const importedPeer = await crypto.subtle.importKey(
    "jwk",
    peerPublicKey,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );

  const sharedSecret = await crypto.subtle.deriveBits(
    { name: "ECDH", public: importedPeer },
    privateKey,
    256,
  );

  const wrappingBits = await derivePairingBits(sharedSecret, context, "wrap");

  return crypto.subtle.importKey(
    "raw",
    wrappingBits,
    { name: "AES-KW", length: 256 },
    false,
    ["wrapKey", "unwrapKey"],
  );
}

export async function generatePairingSAS(
  sharedSecret: ArrayBuffer,
  context: PairingContext,
): Promise<string> {
  const sasBits = await derivePairingBits(sharedSecret, context, "sas");
  const view = new DataView(sasBits);
  const value = view.getBigUint64(0, false) % 1_000_000_000n;
  const numeric = value.toString().padStart(9, "0");
  return `${numeric.slice(0, 3)}-${numeric.slice(3, 6)}-${numeric.slice(6, 9)}`;
}

export async function derivePairingSASFromKeys(
  privateKey: CryptoKey,
  peerPublicKey: JsonWebKey,
  context: PairingContext,
): Promise<string> {
  assertP256PublicKey(peerPublicKey);

  const importedPeer = await crypto.subtle.importKey(
    "jwk",
    peerPublicKey,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );

  const sharedSecret = await crypto.subtle.deriveBits(
    { name: "ECDH", public: importedPeer },
    privateKey,
    256,
  );

  return generatePairingSAS(sharedSecret, context);
}

export async function wrapHealthKeyBundle(
  wrappingKey: CryptoKey,
  keyVersion: number,
): Promise<HealthPairingEnvelope> {
  const healthMasterKey = await getHealthEncryptionKey(keyVersion);
  const dedupeRootKey = await getHealthDedupeRootKey();

  const [wrappedHealth, wrappedDedupe] = await Promise.all([
    crypto.subtle.wrapKey("raw", healthMasterKey, wrappingKey, "AES-KW"),
    crypto.subtle.wrapKey("raw", dedupeRootKey, wrappingKey, "AES-KW"),
  ]);

  return {
    version: 1,
    health_master_key: {
      wrapped_key: toBase64Url(new Uint8Array(wrappedHealth)),
      key_version: keyVersion,
    },
    dedupe_root_key: {
      wrapped_key: toBase64Url(new Uint8Array(wrappedDedupe)),
    },
  };
}

export async function unwrapHealthKeyBundle(
  wrappingKey: CryptoKey,
  envelope: HealthPairingEnvelope,
): Promise<{ keyVersion: number }> {
  if (
    envelope.version !== 1 ||
    !Number.isInteger(envelope.health_master_key.key_version) ||
    envelope.health_master_key.key_version < 1
  ) {
    throw new Error("Invalid health pairing envelope");
  }

  const healthMasterKey = await crypto.subtle.unwrapKey(
    "raw",
    fromBase64Url(envelope.health_master_key.wrapped_key),
    wrappingKey,
    "AES-KW",
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"],
  );

  const dedupeRaw = await crypto.subtle.unwrapKey(
    "raw",
    fromBase64Url(envelope.dedupe_root_key.wrapped_key),
    wrappingKey,
    "AES-KW",
    { name: "HMAC", hash: "SHA-256" },
    true,
    ["sign"],
  );

  await importHealthMasterKey(
    envelope.health_master_key.key_version,
    await crypto.subtle.exportKey("raw", healthMasterKey),
  );
  await importHealthDedupeRootKey(await crypto.subtle.exportKey("raw", dedupeRaw));
  await setCurrentHealthKeyVersion(
    Math.max(envelope.health_master_key.key_version, 1),
  );

  return { keyVersion: envelope.health_master_key.key_version };
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\\+/g, "-")
    .replace(/\\//g, "_")
    .replace(/=+$/g, "");
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(
    normalized.length + ((4 - (normalized.length % 4)) % 4),
    "=",
  );
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}
