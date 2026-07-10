/**
 * Historique local des appareils BLE appairés + mapping capteur → widget.
 * Stocké dans localStorage (jamais transmis au serveur — respect vie privée).
 */

import type { MeasurementType } from "./ble";

const KEY = "lt.ble.devices";
const MAP_KEY = "lt.ble.mapping";

export type PairedDevice = {
  id: string;                 // navigator.bluetooth device.id (opaque, stable par origine)
  name: string;
  category: "watch" | "scale" | "meta" | "mixed";
  services: number[];         // UUIDs 16-bit autorisés découverts
  measurements: MeasurementType[];
  pairedAt: string;
  lastSyncAt: string | null;
  lastValues: Partial<Record<MeasurementType, { value: number; ts: string }>>;
  battery: number | null;
  autoReconnect: boolean;
};

export type SensorMapping = Partial<Record<MeasurementType, "dashboard" | "weight" | "stats" | "off">>;

const DEFAULT_MAPPING: SensorMapping = {
  heart_rate: "dashboard",
  weight: "weight",
  body_fat: "weight",
  steps: "dashboard",
  kcal_active: "dashboard",
  distance_m: "stats",
  battery: "off",
};

function safeRead<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch { return fallback; }
}
function safeWrite(key: string, value: unknown) {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(key, JSON.stringify(value)); } catch {}
}

export function listPairedDevices(): PairedDevice[] {
  return safeRead<PairedDevice[]>(KEY, []);
}
export function savePairedDevice(dev: PairedDevice) {
  const all = listPairedDevices();
  const i = all.findIndex((d) => d.id === dev.id);
  if (i >= 0) all[i] = { ...all[i], ...dev };
  else all.push(dev);
  safeWrite(KEY, all);
  window.dispatchEvent(new Event("lt.ble.devices.changed"));
}
export function removePairedDevice(id: string) {
  safeWrite(KEY, listPairedDevices().filter((d) => d.id !== id));
  window.dispatchEvent(new Event("lt.ble.devices.changed"));
}
export function updateDeviceMeasurement(id: string, type: MeasurementType, value: number, ts: string) {
  const all = listPairedDevices();
  const i = all.findIndex((d) => d.id === id);
  if (i < 0) return;
  const d = all[i];
  d.lastValues = { ...d.lastValues, [type]: { value, ts } };
  d.lastSyncAt = ts;
  if (type === "battery") d.battery = value;
  all[i] = d;
  safeWrite(KEY, all);
  window.dispatchEvent(new Event("lt.ble.devices.changed"));
}
export function getMapping(): SensorMapping {
  return { ...DEFAULT_MAPPING, ...safeRead<SensorMapping>(MAP_KEY, {}) };
}
export function setMapping(m: SensorMapping) {
  safeWrite(MAP_KEY, m);
  window.dispatchEvent(new Event("lt.ble.mapping.changed"));
}
