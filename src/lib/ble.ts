/**
 * Bluetooth Low Energy — whitelist stricte des services standards autorisés.
 * Aucun service custom/proprietary : on refuse toute UUID hors liste (garde-fou sécurité).
 * Aucune écriture GATT n'est effectuée : lecture/notifications seulement (scopes minimaux).
 */

export type MeasurementType = "heart_rate" | "weight" | "body_fat" | "battery" | "steps" | "kcal_active" | "distance_m";

export type BleServiceSpec = {
  uuid: number; // 16-bit assigned UUID (Bluetooth SIG)
  name: string;
  measurements: MeasurementType[];
  characteristics: number[]; // notify/read characteristics we consume
  category: "watch" | "scale" | "meta";
};

/** Liste blanche fermée — toute UUID hors de cette liste est refusée par pairDevice(). */
export const ALLOWED_SERVICES: readonly BleServiceSpec[] = [
  { uuid: 0x180d, name: "Heart Rate",       measurements: ["heart_rate"],           characteristics: [0x2a37], category: "watch" },
  { uuid: 0x181d, name: "Weight Scale",     measurements: ["weight"],               characteristics: [0x2a9d], category: "scale" },
  { uuid: 0x181b, name: "Body Composition", measurements: ["body_fat"],             characteristics: [0x2a9c], category: "scale" },
  { uuid: 0x180f, name: "Battery",          measurements: ["battery"],              characteristics: [0x2a19], category: "meta" },
  { uuid: 0x1816, name: "Cycling Cadence",  measurements: ["distance_m"],           characteristics: [0x2a5b], category: "watch" },
  { uuid: 0x1814, name: "Running Cadence",  measurements: ["steps", "distance_m"],  characteristics: [0x2a53], category: "watch" },
] as const;

export function isAllowedService(uuid: number): boolean {
  return ALLOWED_SERVICES.some((s) => s.uuid === uuid);
}

export function findService(uuid: number): BleServiceSpec | undefined {
  return ALLOWED_SERVICES.find((s) => s.uuid === uuid);
}

// ─── Parsers Bluetooth SIG (spec GATT publique) ────────────────────────────

export function parseHeartRate(v: DataView): number | null {
  if (v.byteLength < 2) return null;
  const flags = v.getUint8(0);
  const bpm = flags & 0x1 ? v.getUint16(1, true) : v.getUint8(1);
  return bpm > 0 && bpm < 250 ? bpm : null;
}

export function parseWeight(v: DataView): number | null {
  if (v.byteLength < 3) return null;
  const flags = v.getUint8(0);
  const imperial = (flags & 0x01) === 0x01;
  const raw = v.getUint16(1, true);
  const kg = imperial ? raw * 0.01 * 0.45359237 : raw * 0.005;
  return kg > 2 && kg < 400 ? Math.round(kg * 100) / 100 : null;
}

export function parseBodyFat(v: DataView): number | null {
  if (v.byteLength < 4) return null;
  const pct = v.getUint16(2, true) * 0.1;
  return pct > 2 && pct < 70 ? Math.round(pct * 10) / 10 : null;
}

export function parseBattery(v: DataView): number | null {
  if (v.byteLength < 1) return null;
  const pct = v.getUint8(0);
  return pct >= 0 && pct <= 100 ? pct : null;
}

export function parseRunningCadence(v: DataView): { steps?: number; distanceM?: number } | null {
  if (v.byteLength < 4) return null;
  const flags = v.getUint8(0);
  const cadence = v.getUint8(2); // steps per minute
  const out: { steps?: number; distanceM?: number } = { steps: cadence };
  if (flags & 0x01 && v.byteLength >= 8) {
    out.distanceM = v.getUint32(4, true) / 10; // dm → m
  }
  return out;
}

// ─── Types partagés ─────────────────────────────────────────────────────────

export type BleMeasurement = {
  ts: string;              // ISO
  type: MeasurementType;
  value: number;
  deviceId: string;
  deviceName: string;
  source: string;          // "ble:<deviceName>"
};

// ─── Types Web Bluetooth (minimaux, évite dépendance @types/web-bluetooth) ──

export interface BluetoothDeviceLike {
  id?: string;
  name?: string;
  gatt?: {
    connected?: boolean;
    connect: () => Promise<BluetoothGattServerLike>;
    disconnect?: () => void;
  };
  addEventListener?: (event: string, cb: () => void) => void;
}
export interface BluetoothGattServerLike {
  connected?: boolean;
  disconnect: () => void;
  getPrimaryService: (uuid: number) => Promise<BluetoothGattServiceLike>;
  getPrimaryServices?: () => Promise<BluetoothGattServiceLike[]>;
}
export interface BluetoothGattServiceLike {
  uuid: string;
  getCharacteristic: (uuid: number) => Promise<BluetoothGattCharacteristicLike>;
  getCharacteristics?: () => Promise<BluetoothGattCharacteristicLike[]>;
}
export interface BluetoothGattCharacteristicLike {
  uuid: string;
  properties?: { notify?: boolean; read?: boolean; write?: boolean };
  readValue?: () => Promise<DataView>;
  startNotifications: () => Promise<BluetoothGattCharacteristicLike>;
  stopNotifications: () => Promise<BluetoothGattCharacteristicLike>;
  addEventListener: (event: string, cb: (e: Event) => void) => void;
  removeEventListener?: (event: string, cb: (e: Event) => void) => void;
}

export function getBluetooth(): { requestDevice: (opts: unknown) => Promise<BluetoothDeviceLike> } | null {
  if (typeof navigator === "undefined") return null;
  const nav = navigator as unknown as { bluetooth?: { requestDevice: (opts: unknown) => Promise<BluetoothDeviceLike> } };
  return nav.bluetooth ?? null;
}
