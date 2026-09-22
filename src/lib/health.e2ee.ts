import {
  createHealthMasterKey,
  getHealthDevicePublicKey,
  unwrapHealthMasterKeyFromDevice,
  wrapHealthMasterKeyForDevice,
  HEALTH_E2EE_CURRENT_KEY_VERSION,
} from "@/lib/health.crypto";
import {
  createHealthE2eeEnvelope,
  listHealthE2eeEnvelopes,
  registerHealthE2eeDevice,
} from "@/lib/health.functions";

export async function registerCurrentHealthDevice(deviceName: string) {
  const publicKey = await getHealthDevicePublicKey();
  return registerHealthE2eeDevice({
    data: {
      device_name: deviceName,
      public_key: publicKey as {
        kty: "EC";
        crv: "P-256";
        x: string;
        y: string;
      },
    },
  });
}

export async function pairHealthDevice(
  senderDeviceId: string,
  targetDeviceId: string,
  targetPublicKey: JsonWebKey,
  keyVersion = HEALTH_E2EE_CURRENT_KEY_VERSION,
) {
  await createHealthMasterKey(keyVersion);

  const wrapped = await wrapHealthMasterKeyForDevice(targetPublicKey, keyVersion);

  return createHealthE2eeEnvelope({
    data: {
      device_id: targetDeviceId,
      sender_device_id: senderDeviceId,
      envelope: wrapped.envelope,
      nonce: null,
      algorithm: wrapped.algorithm,
      key_version: wrapped.key_version,
    },
  });
}

export async function restoreHealthKeyFromEnvelope(
  deviceId: string,
  senderPublicKey: JsonWebKey,
  keyVersion = HEALTH_E2EE_CURRENT_KEY_VERSION,
) {
  const { envelopes } = await listHealthE2eeEnvelopes({
    data: { device_id: deviceId },
  });

  const envelope = envelopes.find(
    (candidate) =>
      candidate.key_version === keyVersion &&
      candidate.algorithm === "ECDH-P256/AES-256-KW",
  );

  if (!envelope) {
    throw new Error("No compatible E2EE key envelope is available for this device");
  }

  return unwrapHealthMasterKeyFromDevice(
    envelope.envelope,
    senderPublicKey,
    envelope.key_version,
  );
}
