import {
  createHealthMasterKey,
  createHealthRecoveryEnvelope,
  getCurrentHealthKeyVersion,
  getHealthDevicePublicKey,
  setCurrentHealthKeyVersion,
  wrapHealthMasterKeyForDevice,
} from "@/lib/health.crypto";
import {
  createHealthE2eeEnvelope,
  listHealthE2eeDevices,
  rotateHealthE2eeKey,
  upsertHealthE2eeRecoveryEnvelope,
} from "@/lib/health.functions";

export async function createHealthRecoveryKey(): Promise<string> {
  const version = await getCurrentHealthKeyVersion();
  const recovery = await createHealthRecoveryEnvelope(version);
  await upsertHealthE2eeRecoveryEnvelope({ data: recovery });
  return recovery.mnemonic;
}

export async function rotateHealthKeyAndRevokeDevice(
  revokedDeviceId: string | null,
): Promise<number> {
  const currentVersion = await getCurrentHealthKeyVersion();
  const nextVersion = currentVersion + 1;

  await createHealthMasterKey(nextVersion);

  const { devices } = await listHealthE2eeDevices();
  const activeDevices = devices.filter(
    (device) => device.id !== revokedDeviceId && device.revoked_at === null,
  );

  if (activeDevices.length === 0) {
    throw new Error("Au moins un appareil actif est requis pour conserver la clé E2EE.");
  }

  for (const device of activeDevices) {
    const targetPublicKey = device.public_key as JsonWebKey;
    const wrapped = await wrapHealthMasterKeyForDevice(targetPublicKey, nextVersion);

    await createHealthE2eeEnvelope({
      data: {
        device_id: device.id,
        sender_device_id: device.id,
        envelope: wrapped.envelope,
        nonce: null,
        algorithm: wrapped.algorithm,
        key_version: nextVersion,
      },
    });
  }

  const recovery = await createHealthRecoveryEnvelope(nextVersion);
  await upsertHealthE2eeRecoveryEnvelope({ data: recovery });

  await rotateHealthE2eeKey({
    data: {
      new_key_version: nextVersion,
      revoked_device_id: revokedDeviceId,
    },
  });

  await setCurrentHealthKeyVersion(nextVersion);
  return nextVersion;
}

export async function getCurrentDevicePublicKey(): Promise<JsonWebKey> {
  return getHealthDevicePublicKey();
}
