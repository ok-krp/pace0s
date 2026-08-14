/**
 * Bluetooth Low Energy — services standards utiles aux montres et capteurs.
 * Aucune écriture GATT : lecture/notifications uniquement.
 */
export type MeasurementType = "heart_rate" | "weight" | "body_fat" | "battery" | "steps" | "kcal_active" | "distance_m";
export type BleServiceSpec = { uuid: number; name: string; measurements: MeasurementType[]; characteristics: number[]; category: "watch" | "scale" | "meta" };
export const ALLOWED_SERVICES: readonly BleServiceSpec[] = [
  { uuid: 0x180d, name: "Heart Rate", measurements: ["heart_rate"], characteristics: [0x2a37], category: "watch" },
  { uuid: 0x181d, name: "Weight Scale", measurements: ["weight"], characteristics: [0x2a9d], category: "scale" },
  { uuid: 0x181b, name: "Body Composition", measurements: ["body_fat"], characteristics: [0x2a9c], category: "scale" },
  { uuid: 0x180f, name: "Battery", measurements: ["battery"], characteristics: [0x2a19], category: "meta" },
  { uuid: 0x1816, name: "Cycling Cadence", measurements: ["distance_m"], characteristics: [0x2a5b], category: "watch" },
  { uuid: 0x1814, name: "Running Cadence", measurements: ["steps", "distance_m"], characteristics: [0x2a53], category: "watch" },
] as const;
export function isAllowedService(uuid: number): boolean { return ALLOWED_SERVICES.some((s) => s.uuid === uuid); }
export function findService(uuid: number): BleServiceSpec | undefined { return ALLOWED_SERVICES.find((s) => s.uuid === uuid); }
export function parseHeartRate(v: DataView): number | null { if (v.byteLength < 2) return null; const flags = v.getUint8(0); const bpm = flags & 1 ? (v.byteLength >= 3 ? v.getUint16(1, true) : 0) : v.getUint8(1); return bpm > 0 && bpm < 250 ? bpm : null; }
export function parseWeight(v: DataView): number | null { if (v.byteLength < 3) return null; const imperial = (v.getUint8(0) & 1) === 1; const raw = v.getUint16(1, true); const kg = imperial ? raw * 0.01 * 0.45359237 : raw * 0.005; return kg > 2 && kg < 400 ? Math.round(kg * 100) / 100 : null; }
export function parseBodyFat(v: DataView): number | null { if (v.byteLength < 4) return null; const pct = v.getUint16(2, true) * 0.1; return pct > 2 && pct < 70 ? Math.round(pct * 10) / 10 : null; }
export function parseBattery(v: DataView): number | null { if (v.byteLength < 1) return null; const pct = v.getUint8(0); return pct <= 100 ? pct : null; }
export function parseRunningCadence(v: DataView): { steps?: number; distanceM?: number } | null { if (v.byteLength < 3) return null; const flags = v.getUint8(0); const cadence = v.getUint8(2); const out: { steps?: number; distanceM?: number } = { steps: cadence }; if (flags & 1 && v.byteLength >= 8) out.distanceM = v.getUint32(4, true) / 10; return out; }

// Parsers supplémentaires utilisés par le module Montre. Ils restent séparés du contrat
// historique afin de ne pas casser les anciennes données Supabase.
export function parsePulseOximeter(v: DataView): number | null { if (v.byteLength < 3) return null; const raw = v.getUint16(1, true); let mantissa = raw & 0x0fff; if (mantissa & 0x0800) mantissa -= 0x1000; let exponent = (raw >> 12) & 0x0f; if (exponent & 0x08) exponent -= 0x10; const value = mantissa * Math.pow(10, exponent); return value >= 50 && value <= 100 ? Math.round(value * 10) / 10 : null; }
export function parseTemperature(v: DataView): number | null { if (v.byteLength < 3) return null; const value = v.getInt16(1, true) / 100; return value > -20 && value < 100 ? Math.round(value * 10) / 10 : null; }
export function parseCyclingPower(v: DataView): number | null { if (v.byteLength < 4) return null; const watts = v.getInt16(2, true); return watts >= -100 && watts < 5000 ? watts : null; }

export type BleMeasurement = { ts: string; type: MeasurementType; value: number; deviceId: string; deviceName: string; source: string };
export interface BluetoothDeviceLike { id?: string; name?: string; gatt?: { connected?: boolean; connect: () => Promise<BluetoothGattServerLike>; disconnect?: () => void }; addEventListener?: (event: string, cb: () => void) => void; }
export interface BluetoothGattServerLike { connected?: boolean; disconnect: () => void; getPrimaryService: (uuid: number) => Promise<BluetoothGattServiceLike>; getPrimaryServices?: () => Promise<BluetoothGattServiceLike[]>; }
export interface BluetoothGattServiceLike { uuid: string; getCharacteristic: (uuid: number) => Promise<BluetoothGattCharacteristicLike>; getCharacteristics?: () => Promise<BluetoothGattCharacteristicLike[]>; }
export interface BluetoothGattCharacteristicLike { uuid: string; properties?: { notify?: boolean; read?: boolean; write?: boolean }; readValue?: () => Promise<DataView>; startNotifications: () => Promise<BluetoothGattCharacteristicLike>; stopNotifications: () => Promise<BluetoothGattCharacteristicLike>; addEventListener: (event: string, cb: (e: Event) => void) => void; removeEventListener?: (event: string, cb: (e: Event) => void) => void; }
const BLUETOOTH_POLICY_MESSAGE = "Bluetooth est bloqué par la politique de permissions de cet aperçu. Ouvrez l'app publiée ou une fenêtre HTTPS directe pour appairer un appareil.";
function isBluetoothAllowedByPolicy(): boolean { if (typeof document === "undefined") return true; const doc = document as Document & { permissionsPolicy?: { allowsFeature: (feature: string) => boolean }; featurePolicy?: { allowsFeature: (feature: string) => boolean } }; try { return doc.permissionsPolicy?.allowsFeature("bluetooth") ?? doc.featurePolicy?.allowsFeature("bluetooth") ?? true; } catch { return true; } }
export function explainBluetoothError(error: unknown): string { const message = error instanceof Error ? error.message : String(error); if (/permissions policy|disallowed by permissions policy|bluetooth.*disallowed/i.test(message)) return BLUETOOTH_POLICY_MESSAGE; return message; }
function isInsideCrossOriginFrame(): boolean { if (typeof window === "undefined") return false; try { return window.self !== window.top; } catch { return true; } }
const BLUETOOTH_TIMEOUT_MS = 15_000;
function withBluetoothTimeout(promise: Promise<BluetoothDeviceLike>): Promise<BluetoothDeviceLike> { return Promise.race([promise, new Promise<BluetoothDeviceLike>((_, reject) => setTimeout(() => reject(new Error(BLUETOOTH_POLICY_MESSAGE)), BLUETOOTH_TIMEOUT_MS))]); }
export function getBluetooth(): { requestDevice: (opts: unknown) => Promise<BluetoothDeviceLike> } | null { if (typeof navigator === "undefined") return null; if (!isBluetoothAllowedByPolicy() || isInsideCrossOriginFrame()) return { requestDevice: async () => { throw new Error(BLUETOOTH_POLICY_MESSAGE); } }; const nav = navigator as unknown as { bluetooth?: { requestDevice: (opts: unknown) => Promise<BluetoothDeviceLike> } }; if (!nav.bluetooth) return null; return { requestDevice: (opts: unknown) => withBluetoothTimeout(nav.bluetooth!.requestDevice(opts)) }; }
