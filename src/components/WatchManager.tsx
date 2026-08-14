import { useCallback, useEffect, useRef, useState } from "react";
import { BatteryFull, Bluetooth, CheckCircle2, HeartPulse, Link2, RefreshCw, Ruler, Thermometer, Watch, Wind, XCircle, Zap, Footprints, Flame, Moon, Dumbbell } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { insertHealthSamples } from "@/lib/health.functions";
import { useHealthToday } from "@/hooks/use-health";
import { getBluetooth, parseBattery, parseCyclingPower, parseHeartRate, parsePulseOximeter, parseTemperature, type BluetoothDeviceLike, type BluetoothGattCharacteristicLike, type BluetoothGattServerLike } from "@/lib/ble";

const parseCadence = (v: DataView): number | null => v.byteLength >= 3 ? v.getUint8(2) : null;
const WATCH_SERVICES = [
  { uuid: 0x180d, name: "Fréquence cardiaque", char: 0x2a37, parse: parseHeartRate, type: "heart_rate" as const },
  { uuid: 0x1822, name: "SpO₂", char: 0x2a5f, parse: parsePulseOximeter, type: "oxygen_saturation" as const },
  { uuid: 0x1809, name: "Température", char: 0x2a6e, parse: parseTemperature, type: "temperature_c" as const },
  { uuid: 0x180f, name: "Batterie", char: 0x2a19, parse: parseBattery, type: null },
  { uuid: 0x1814, name: "Cadence course", char: 0x2a53, parse: parseCadence, type: "cadence_rpm" as const },
  { uuid: 0x1818, name: "Puissance", char: 0x2a63, parse: parseCyclingPower, type: "power_w" as const },
];
type Metric = { type: string; value: number; ts: string; label: string; unit: string };
type Conn = { device: BluetoothDeviceLike; server: BluetoothGattServerLike; chars: Array<{ char: BluetoothGattCharacteristicLike; service: typeof WATCH_SERVICES[number] }> };
const labels: Record<string, { label: string; unit: string; icon: typeof HeartPulse }> = {
  heart_rate: { label: "Fréquence cardiaque", unit: "BPM", icon: HeartPulse }, oxygen_saturation: { label: "SpO₂", unit: "%", icon: Wind }, temperature_c: { label: "Température", unit: "°C", icon: Thermometer }, cadence_rpm: { label: "Cadence", unit: "tr/min", icon: Ruler }, power_w: { label: "Puissance", unit: "W", icon: Zap }, battery: { label: "Batterie", unit: "%", icon: BatteryFull },
};

export function WatchManager() {
  const insert = useServerFn(insertHealthSamples);
  const { data: health, refresh: refreshHealth } = useHealthToday();
  const [device, setDevice] = useState<{ name: string; id: string } | null>(null); const [connected, setConnected] = useState(false); const [pairing, setPairing] = useState(false);
  const [metrics, setMetrics] = useState<Record<string, Metric>>({}); const [lastSync, setLastSync] = useState<string | null>(null); const connRef = useRef<Conn | null>(null); const timerRef = useRef<number | null>(null);
  const saveMetric = useCallback(async (type: string, value: number, source: string, ts: string) => {
    const meta = labels[type] ?? { label: type, unit: "", icon: HeartPulse }; const metric = { type, value, ts, label: meta.label, unit: meta.unit };
    setMetrics((prev) => { const next = { ...prev, [type]: metric }; try { localStorage.setItem("pace.watch.last_metrics", JSON.stringify(next)); } catch {} return next; });
    if (type === "battery") return;
    try { await insert({ data: { samples: [{ ts, type: type as "heart_rate" | "oxygen_saturation" | "temperature_c" | "cadence_rpm" | "power_w", value, source }] } }); setLastSync(ts); window.dispatchEvent(new Event("pace.health.changed")); } catch {}
  }, [insert]);
  const readAll = useCallback(async () => { const conn = connRef.current; if (!conn || !conn.server.connected) return; for (const item of conn.chars) { try { if (!item.char.readValue) continue; const v = await item.char.readValue(); const parsed = item.service.parse(v); if (typeof parsed === "number") await saveMetric(item.service.type ?? "battery", parsed, `ble:${conn.device.name ?? "watch"}`, new Date().toISOString()); } catch {} } }, [saveMetric]);
  const disconnect = useCallback(() => { if (timerRef.current != null) window.clearInterval(timerRef.current); timerRef.current = null; try { connRef.current?.server.disconnect(); } catch {} connRef.current = null; setConnected(false); }, []);
  const connect = useCallback(async () => {
    const bt = getBluetooth(); if (!bt) { toast.error("Web Bluetooth n'est pas disponible dans ce navigateur."); return; } setPairing(true);
    try {
      const device = await bt.requestDevice({ filters: WATCH_SERVICES.map((s) => ({ services: [s.uuid] })), optionalServices: WATCH_SERVICES.map((s) => s.uuid) }); if (!device.gatt) throw new Error("GATT indisponible");
      const server = await device.gatt.connect(); const conn: Conn = { device, server, chars: [] }; const deviceId = device.id ?? device.name ?? "watch";
      for (const service of WATCH_SERVICES) { try { const svc = await server.getPrimaryService(service.uuid); const char = await svc.getCharacteristic(service.char); conn.chars.push({ char, service }); if (char.properties?.notify) { const handler = (e: Event) => { const v = (e.target as unknown as { value?: DataView }).value; if (!v) return; const parsed = service.parse(v); if (typeof parsed === "number") void saveMetric(service.type ?? "battery", parsed, `ble:${device.name ?? "watch"}`, new Date().toISOString()); }; char.addEventListener("characteristicvaluechanged", handler); await char.startNotifications(); } } catch {} }
      if (!conn.chars.length) { try { server.disconnect(); } catch {} throw new Error("Aucun service standard de montre détecté."); }
      connRef.current = conn; setDevice({ id: deviceId, name: device.name ?? "Montre BLE" }); setConnected(true); toast.success(`${device.name ?? "Montre"} connectée`); await readAll(); timerRef.current = window.setInterval(() => void readAll(), 5000);
      device.addEventListener?.("gattserverdisconnected", () => { setConnected(false); if (timerRef.current != null) window.clearInterval(timerRef.current); timerRef.current = null; });
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)); } finally { setPairing(false); }
  }, [readAll, saveMetric]);
  useEffect(() => { try { const saved = JSON.parse(localStorage.getItem("pace.watch.last_metrics") ?? "{}"); if (saved && typeof saved === "object") setMetrics(saved); } catch {} return () => disconnect(); }, [disconnect]);
  return <div className="space-y-5">
    <Card className="glass-card"><CardHeader className="flex flex-row items-center gap-3"><div className="size-11 rounded-2xl bg-primary/10 grid place-items-center"><Watch className="size-5 text-primary" /></div><div className="flex-1"><CardTitle>Montre</CardTitle><p className="text-xs text-muted-foreground mt-1">BLE temps réel + données quotidiennes Xiaomi via Health Connect</p></div>{connected ? <span className="text-xs flex items-center gap-1 text-emerald-600"><CheckCircle2 className="size-3.5"/> Connectée</span> : <span className="text-xs flex items-center gap-1 text-muted-foreground"><XCircle className="size-3.5"/> Déconnectée</span>}</CardHeader><CardContent className="space-y-4"><div className="flex items-center gap-2 flex-wrap"><Button onClick={connect} disabled={pairing || connected} className="gap-2"><Bluetooth className="size-4"/>{pairing ? "Recherche…" : "Connecter une montre"}</Button>{connected && <Button variant="outline" onClick={disconnect} className="gap-2"><XCircle className="size-4"/> Déconnecter</Button>}{device && <span className="text-sm text-muted-foreground flex items-center gap-1"><Link2 className="size-3.5"/>{device.name}</span>}</div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">{Object.values(metrics).map((m) => { const Icon = labels[m.type]?.icon ?? HeartPulse; return <div key={m.type} className="rounded-2xl border p-4"><div className="flex items-center gap-2 text-xs text-muted-foreground"><Icon className="size-3.5"/>{m.label}</div><div className="text-2xl font-semibold mt-2">{m.value}<span className="text-xs font-normal ml-1 text-muted-foreground">{m.unit}</span></div><div className="text-[10px] text-muted-foreground mt-1">{new Date(m.ts).toLocaleTimeString("fr-FR")}</div></div>; })}</div>
    </CardContent></Card>

    <Card className="glass-card"><CardHeader className="flex flex-row items-center justify-between"><div><CardTitle>Données quotidiennes</CardTitle><p className="text-xs text-muted-foreground mt-1">Source synchronisée : {health.lastSource ?? "aucune"}</p></div><Button size="sm" variant="outline" onClick={() => void refreshHealth()} className="gap-2"><RefreshCw className="size-3.5"/> Actualiser</Button></CardHeader><CardContent><div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <div className="rounded-2xl border p-4"><Footprints className="size-4 opacity-60"/><div className="text-2xl font-semibold mt-2">{health.steps.toLocaleString("fr-FR")}</div><div className="text-xs text-muted-foreground">Pas</div></div>
      <div className="rounded-2xl border p-4"><Flame className="size-4 opacity-60"/><div className="text-2xl font-semibold mt-2">{health.kcalActive}</div><div className="text-xs text-muted-foreground">kcal actives</div></div>
      <div className="rounded-2xl border p-4"><Ruler className="size-4 opacity-60"/><div className="text-2xl font-semibold mt-2">{(health.distanceM / 1000).toFixed(2)} km</div><div className="text-xs text-muted-foreground">Distance</div></div>
      <div className="rounded-2xl border p-4"><Moon className="size-4 opacity-60"/><div className="text-2xl font-semibold mt-2">{Math.floor(health.sleepMin / 60)}h{String(health.sleepMin % 60).padStart(2, "0")}</div><div className="text-xs text-muted-foreground">Sommeil</div></div>
      <div className="rounded-2xl border p-4"><HeartPulse className="size-4 opacity-60"/><div className="text-2xl font-semibold mt-2">{health.restingHeartRate ?? "—"}</div><div className="text-xs text-muted-foreground">FC repos</div></div>
      <div className="rounded-2xl border p-4"><Dumbbell className="size-4 opacity-60"/><div className="text-2xl font-semibold mt-2">{health.exerciseMin} min</div><div className="text-xs text-muted-foreground">Entraînements</div></div>
      <div className="rounded-2xl border p-4"><Flame className="size-4 opacity-60"/><div className="text-2xl font-semibold mt-2">{health.kcalTotal || "—"}</div><div className="text-xs text-muted-foreground">kcal totales</div></div>
      <div className="rounded-2xl border p-4"><HeartPulse className="size-4 opacity-60"/><div className="text-2xl font-semibold mt-2">{health.heartRate ?? "—"}</div><div className="text-xs text-muted-foreground">Dernier BPM</div></div>
    </div><div className="mt-4 text-[11px] text-muted-foreground">Dernière donnée : {health.lastTs ? new Date(health.lastTs).toLocaleString("fr-FR") : "aucune"}. Les valeurs sont issues des sources réellement synchronisées et ne sont pas estimées par Pace.</div></CardContent></Card>
  </div>;
}
