const WRAP_ALGORITHM = "ECDH-P256/AES-256-GCM";
const KEY_VERSION = 1;

export type HealthE2eeDevicePublicKey = JsonWebKey & {
  kty: "EC";
  crv: "P-256";
  x: string;
  y: string;
};
export type HealthE2eeEnvelope = {
  deviceId: string;
  senderDeviceId: string;
  ciphertext: string;
  nonce: string;
  algorithm: typeof WRAP_ALGORITHM;
  keyVersion: number;
};
function toBase64(bytes: ArrayBuffer | Uint8Array): string {
  const input = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let value = "";
  for (const byte of input) value += String.fromCharCode(byte);
  return btoa(value);
}
function fromBase64(value: string): Uint8Array {
  const raw = atob(value);
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}
export async function generateHealthDeviceKeyPair(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, false, ["deriveKey"]);
}
export async function exportHealthDevicePublicKey(key: CryptoKey): Promise<HealthE2eeDevicePublicKey> {
  return crypto.subtle.exportKey("jwk", key) as Promise<HealthE2eeDevicePublicKey>;
}
async function deriveWrappingKey(privateKey: CryptoKey, peerPublicKey: HealthE2eeDevicePublicKey): Promise<CryptoKey> {
  const publicKey = await crypto.subtle.importKey("jwk", peerPublicKey, { name: "ECDH", namedCurve: "P-256" }, false, []);
  return crypto.subtle.deriveKey({ name: "ECDH", public: publicKey }, privateKey, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}
function envelopeAad(deviceId: string, senderDeviceId: string, keyVersion: number): Uint8Array {
  return new TextEncoder().encode(`pace-health-e2ee|device=${deviceId}|sender=${senderDeviceId}|v=${keyVersion}`);
}
export async function createHealthKeyEnvelope(args: {
  healthKey: CryptoKey;
  senderPrivateKey: CryptoKey;
  recipientPublicKey: HealthE2eeDevicePublicKey;
  deviceId: string;
  senderDeviceId: string;
  keyVersion?: number;
}): Promise<HealthE2eeEnvelope> {
  const keyVersion = args.keyVersion ?? KEY_VERSION;
  const wrappingKey = await deriveWrappingKey(args.senderPrivateKey, args.recipientPublicKey);
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const wrapped = await crypto.subtle.wrapKey("raw", args.healthKey, wrappingKey, {
    name: "AES-GCM", iv: nonce, additionalData: envelopeAad(args.deviceId, args.senderDeviceId, keyVersion),
  });
  return { deviceId: args.deviceId, senderDeviceId: args.senderDeviceId, ciphertext: toBase64(wrapped), nonce: toBase64(nonce), algorithm: WRAP_ALGORITHM, keyVersion };
}
export async function unwrapHealthKeyEnvelope(args: {
  envelope: HealthE2eeEnvelope;
  recipientPrivateKey: CryptoKey;
  senderPublicKey: HealthE2eeDevicePublicKey;
}): Promise<CryptoKey> {
  const wrappingKey = await deriveWrappingKey(args.recipientPrivateKey, args.senderPublicKey);
  return crypto.subtle.unwrapKey("raw", fromBase64(args.envelope.ciphertext), wrappingKey, {
    name: "AES-GCM", iv: fromBase64(args.envelope.nonce),
    additionalData: envelopeAad(args.envelope.deviceId, args.envelope.senderDeviceId, args.envelope.keyVersion),
  }, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}
