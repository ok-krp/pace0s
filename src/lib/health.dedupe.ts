import {
  encryptHealthPayload,
  getCurrentHealthKeyVersion,
  getHealthEncryptionKey,
} from "@/lib/health.crypto";

const HEALTH_DEDUPE_HKDF_SALT = new TextEncoder().encode(
  "paceos-health-e2ee-dedupe-v1",
);

const HEALTH_DEDUPE_HKDF_INFO = new TextEncoder().encode(
  "paceos/health/dedupe-hmac-sha256/v1",
);

export type HealthDedupeIdentity = {
  type: string;
  date: string;
  source: string;
  external_id: string;
};

export type HealthSampleForE2ee = {
  ts: string;
  type: string;
  value: number;
  source: string;
  source_id?: string | null;
  external_id?: string | null;
  metadata?: Record<string, unknown> | null;
  created_at?: string;
};

function canonicalizeHealthDedupeIdentity(
  identity: HealthDedupeIdentity,
): string {
  const canonicalDate = new Date(identity.date);
  if (Number.isNaN(canonicalDate.getTime())) {
    throw new Error("Invalid health sample date.");
  }

  return JSON.stringify([
    identity.type.normalize("NFC"),
    canonicalDate.toISOString(),
    identity.source.normalize("NFC"),
    identity.external_id.normalize("NFC"),
  ]);
}

async function deriveHealthDedupeKey(
  healthMasterKey: CryptoKey,
): Promise<CryptoKey> {
  const rawMasterKey = await crypto.subtle.exportKey("raw", healthMasterKey);
  const hkdfKey = await crypto.subtle.importKey(
    "raw",
    rawMasterKey,
    "HKDF",
    false,
    ["deriveKey"],
  );

  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: HEALTH_DEDUPE_HKDF_SALT,
      info: HEALTH_DEDUPE_HKDF_INFO,
    },
    hkdfKey,
    { name: "HMAC", hash: "SHA-256", length: 256 },
    false,
    ["sign"],
  );
}

function toHex(value: ArrayBuffer): string {
  return Array.from(new Uint8Array(value), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export async function generateHealthDedupeHash(
  identity: HealthDedupeIdentity,
  healthMasterKey: CryptoKey,
): Promise<string> {
  if (
    !identity.type ||
    !identity.date ||
    !identity.source ||
    !identity.external_id
  ) {
    throw new Error(
      "A stable type, date, source and external_id are required for health deduplication.",
    );
  }

  const dedupeKey = await deriveHealthDedupeKey(healthMasterKey);
  const canonicalIdentity = canonicalizeHealthDedupeIdentity(identity);
  const mac = await crypto.subtle.sign(
    "HMAC",
    dedupeRootKey,
    new TextEncoder().encode(canonicalIdentity),
  );

  return toHex(mac);
}

export async function encryptHealthSampleForUpload(
  sample: HealthSampleForE2ee,
): Promise<{
  ciphertext: string;
  nonce: string;
  algorithm: "AES-256-GCM";
  key_version: number;
  dedupe_hash: string;
}> {
  if (!Number.isFinite(sample.value)) {
    throw new Error("Health sample value must be finite.");
  }

  const keyVersion = await getCurrentHealthKeyVersion();
  const healthMasterKey = await getHealthEncryptionKey(keyVersion);

  const dedupeHash = await generateHealthDedupeHash(
    {
      type: sample.type,
      date: sample.ts,
      source: sample.source,
      external_id: sample.external_id ?? "",
    },
    healthMasterKey,
  );

  const encrypted = await encryptHealthPayload(sample, keyVersion);

  return {
    ...encrypted,
    dedupe_hash: dedupeHash,
  };
}
