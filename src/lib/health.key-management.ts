import {
  createHealthMasterKey,
  createHealthRecoveryEnvelope,
  getCurrentHealthKeyVersion,
  getHealthDevicePublicKey,
  getRegisteredHealthDeviceId,
  setCurrentHealthKeyVersion,
  setRegisteredHealthDeviceId,
  unwrapHealthMasterKeyFromDevice,
  wrapHealthMasterKeyForDevice,
} from "@/lib/health.crypto";
import {
  createHealthE2eeEnvelope,
  listHealthE2eeDevices,
  listHealthE2eeEnvelopes,
  registerHealthE2eeDevice,
  rotateHealthE2eeKey,
  upsertHealthE2eeRecoveryEnvelope,
} from "@/lib/health.functions";

export async function registerCurrentHealthDevice(deviceName: string) {
  const existingId = await getRegisteredHealthDeviceId();
  if (existingId) return { id: existingId };
  const device = await registerHealthE2eeDevice({
    data: { device_name: deviceName, public_key: await getHealthDevicePublicKey() },
  });
  await setRegisteredHealthDeviceId(device.id);
  return device;
}

export async function createHealthRecoveryKey(): Promise<string> {
  const version = await getCurrentHealthKeyVersion();
  const recovery = await createHealthRecoveryEnvelope(version);
  await upsertHealthE2eeRecoveryEnvelope({ data: recovery });
  return recovery.mnemonic;
}

export async function pairNewHealthDevice(targetDeviceId: string, targetPublicKey: JsonWebKey): Promise<void> {
  const senderDeviceId = await getRegisteredHealthDeviceId();
  if (!senderDeviceId) throw new Error("Current device is not registered for E2EE pairing.");
  const version = await getCurrentHealthKeyVersion();
  const wrapped = await wrapHealthMasterKeyForDevice(targetPublicKey, version);
  await createHealthE2eeEnvelope({
    data: {
      device_id: targetDeviceId,
      sender_device_id: senderDeviceId,
      envelope: wrapped.envelope,
      nonce: null,
      algorithm: wrapped.algorithm,
      key_version: version,
    },
  });
}

export async function acceptHealthDevicePairing(deviceId: string): Promise<number> {
  const { envelopes } = await listHealthE2eeEnvelopes({ data: { device_id: deviceId } });
  if (envelopes.length === 0) throw new Error("No E2EE pairing envelope available for this device.");

  const { devices } = await listHealthE2eeDevices();
  const byId = new Map(devices.map((device) => [device.id, device]));
  let highestVersion = await getCurrentHealthKeyVersion();

  for (const envelope of envelopes) {
    if (envelope.algorithm !== "ECDH-P256/AES-256-KW" || envelope.nonce !== null) continue;
    const sender = byId.get(envelope.sender_device_id);
    if (!sender) continue;
    await unwrapHealthMasterKeyFromDevice(
      envelope.envelope,
      sender.public_key as JsonWebKey,
      envelope.key_version,
    );
    highestVersion = Math.max(highestVersion, envelope.key_version);
  }

  await setCurrentHealthKeyVersion(highestVersion);
  return highestVersion;
}

export async function rotateHealthKeyAndRevokeDevice(revokedDeviceId: string | null): Promise<number> {
  const currentVersion = await getCurrentHealthKeyVersion();
  const nextVersion = currentVersion + 1;
  await createHealthMasterKey(nextVersion);

  const { devices } = await listHealthE2eeDevices();
  const activeDevices = devices.filter((device) => device.id !== revokedDeviceId && device.revoked_at === null);
  if (activeDevices.length === 0) throw new Error("Au moins un appareil actif est requis pour conserver la clé E2EE.");

  const senderDeviceId = await getRegisteredHealthDeviceId();
  if (!senderDeviceId) throw new Error("Current device is not registered for E2EE pairing.");

  for (const device of activeDevices) {
    const wrapped = await wrapHealthMasterKeyForDevice(device.public_key as JsonWebKey, nextVersion);
    await createHealthE2eeEnvelope({
      data: {
        device_id: device.id,
        sender_device_id: senderDeviceId,
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
    data: { new_key_version: nextVersion, revoked_device_id: revokedDeviceId },
  });
  await setCurrentHealthKeyVersion(nextVersion);
  return nextVersion;
}

export async function getCurrentDevicePublicKey(): Promise<JsonWebKey> {
  return getHealthDevicePublicKey();
}
