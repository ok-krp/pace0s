import assert from "node:assert/strict";

import {
  createHealthKeyEnvelope,
  exportHealthDevicePublicKey,
  generateHealthDeviceKeyPair,
  unwrapHealthKeyEnvelope,
} from "../src/lib/health.e2ee.protocol.ts";

const masterKey = await crypto.subtle.generateKey(
  { name: "AES-GCM", length: 256 },
  true,
  ["encrypt", "decrypt"],
);

const sender = await generateHealthDeviceKeyPair();
const recipient = await generateHealthDeviceKeyPair();
const recipientPublicKey = await exportHealthDevicePublicKey(recipient.publicKey);

const envelope = await createHealthKeyEnvelope({
  healthKey: masterKey,
  senderPrivateKey: sender.privateKey,
  recipientPublicKey,
  deviceId: "00000000-0000-4000-8000-000000000002",
  senderDeviceId: "00000000-0000-4000-8000-000000000001",
});

assert.equal(envelope.algorithm, "ECDH-P256/AES-256-GCM");
assert.equal(envelope.keyVersion, 1);
assert.ok(envelope.ciphertext.length > 0);
assert.ok(envelope.nonce.length > 0);

const senderPublicKey = await exportHealthDevicePublicKey(sender.publicKey);
const unwrapped = await unwrapHealthKeyEnvelope({
  envelope,
  recipientPrivateKey: recipient.privateKey,
  senderPublicKey,
});

const plaintext = new TextEncoder().encode(JSON.stringify({ type: "heart_rate", value: 61 }));
const nonce = crypto.getRandomValues(new Uint8Array(12));
const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, masterKey, plaintext);
const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, unwrapped, ciphertext);

assert.deepEqual(
  Array.from(new Uint8Array(decrypted)),
  Array.from(plaintext),
);

await assert.rejects(
  unwrapHealthKeyEnvelope({
    envelope: { ...envelope, deviceId: "00000000-0000-4000-8000-000000000099" },
    recipientPrivateKey: recipient.privateKey,
    senderPublicKey,
  }),
);

console.log("health E2EE protocol: OK");
