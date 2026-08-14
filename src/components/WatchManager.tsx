import { useCallback, useEffect, useRef, useState } from "react";
import { BatteryFull, Bluetooth, CheckCircle2, HeartPulse, Link2, RefreshCw, Ruler, Thermometer, Watch, Wind, XCircle, Zap } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { insertHealthSamples } from "@/lib/health.functions";
import { getBluetooth, parseBattery, parseCyclingPower, parseHeartRate, parsePulseOximeter, parseRunningCadence, parseTemperature, type BluetoothDeviceLike, type BluetoothGattCharacteristicLike, type BluetoothGattServerLike } from "@/lib/ble";

const WATCH_SERVICES = [
  { uuid: 0x180d, name: "Fréquence cardiaque", char: 0x2a37, parse: parseHeartRate, type: "heart_rate" as const },
  { uuid: 0x1822, name: "SpO₂", char: 0x2a5f, parse: parsePulseOximeter, type: "oxygen_saturation" as const },
  { uuid: 0x1809, name: "Température", char: 0x2a6e, parse: parseTemperature, type: "temperature_c" as const },
  { uuid: 0x180f, name: "Batterie", char: 0x2a19, parse: parseBattery, type: null },
  { uuid: 0x1814, name: "Cadence course", char: 0x2a53, parse: parseRunningCadence, type: "cadence_rpm" as const },
  { uuid: 0x1818, name: "Puissance", char: 0x2a63, parse: parseCyclingPower, type: "power_w" as const },
];
type Metric = { type: string; value: number; ts: string; label: string; unit: string };
type Conn = { device: BluetoothDeviceLike; server: BluetoothGattServerLike; chars: Array<{ char: BluetoothGattCharacteristicLike; service: typeof WATCH_SERVICES[number] }> };
const labels: Record<string, { label: string; unit: string; icon: typeof HeartPulse }> = {
  heart_rate: { label: "Fréquence cardiaque", unit: "BPM", icon: HeartPulse }, oxygen_saturation: { label: "SpO₂", unit: "%", icon: Wind },
  temperature_c: { label: "Température", unit: "°C", icon: Thermometer }, cadence_rpm: { label: "Cadence", unit: "tr/min", icon: Ruler },
  power_w: { label: "Puissance", unit: "W", icon: Zap }, battery: { label: "Batterie", unit: "%", icon: BatteryFull },
};

export function WatchManager() {
  const insert = useServerFn(insertHealthSamples);
  const [device, setDevice] = useState<{ name: string; id: string } | null>(null);
  const [connected, setConnected] = useState(false); const [pairing, setPairing] = useState(false);
  const [metrics, setMetrics] = useState<Record<string, Metric>>({}); const [lastSync, setLastSync] = useState<string | null>(null);
  const connRef = useRef<Conn | null>(null); const timerRef = useRef<number | null>(null);

  const saveMetric = useCallback(async (type: string, value: number, source: string, ts: string) => {
    const meta = labels[type] ?? { label: type, unit: "", icon: HeartPulse };
    const metric = { type, value, ts, label: meta.label, unit: meta.unit };
    setMetrics((prev) => { const next = { ...prev, [type]: metric }; try { localStorage.setItem("pace.watch.last_metrics", JSON.stringify(next)); } catch {} return next; });
    if (type === "battery") return;
    try {
      await insert({ data: { samples: [{ ts, type: type as "heart_rate" | "oxygen_saturation" | "temperature_c" | "cadence_rpm" | "power_w", value, source }] } });
      setLastSync(ts);
    } catch { /* local value is kept; the app's offline sync can retry persisted state */ }
  }, [insert]);

  const readAll = useCallback(async () => {
    const conn = connRef.current; if (!conn || !conn.server.connected) return;
    for (const item of conn.chars) {
      try {
        if (!item.char.readValue) continue;
        const v = await item.char.readValue(); const parsed = item.service.parse(v); if (parsed == null) continue;
        if (typeof parsed === "number") await saveMetric(item.service.type ?? "battery", parsed, `ble:${conn.device.name ?? "watch"}`, new Date().toISOString());
        else if (parsed.cadenceRpm != null) await saveMetric("cadence_rpm", parsed.cadenceRpm, `ble:${conn.device.name ?? "watch"}`, new Date().toISOString());
      } catch { /* keep polling other characteristics */ }
    }
  }, [saveMetric]);

  const disconnect = useCallback(() => { if (timerRef.current != null) window.clearInterval(timerRef.current); timerRef.current = null; try { connRef.current?.server.disconnect(); } catch {} connRef.current = null; setConnected(false); }, []);

  const connect = useCallback(async () => {
    const bt = getBluetooth(); if (!bt) { toast.error("Web Bluetooth n'est pas disponible dans ce navigateur."); return; }
    setPairing(true);
    try {
      const device = await bt.requestDevice({ filters: WATCH_SERVICES.map((s) => ({ services: [s.uuid] })), optionalServices: WATCH_SERVICES.map((s) => s.uuid) });
      if (!device.gatt) throw new Error("GATT indisponible");
      const server = await device.gatt.connect(); const conn: Conn = { device, server, chars: [] }; const deviceId = device.id ?? device.name ?? "watch";
      for (const service of WATCH_SERVICES) {
        try {
          const svc = await server.getPrimaryService(service.uuid); const char = await svc.getCharacteristic(service.char); conn.chars.push({ char, service });
          if (char.properties?.notify) {
            const handler = (e: Event) => { const v = (e.target as unknown as { value?: DataView }).value; if (!v) return; const parsed = service.parse(v); if (typeof parsed === "number") void saveMetric(service.type ?? "battery", parsed, `ble:${device.name ?? "watch"}`, new Date().toISOString()); else if (parsed?.cadenceRpm != null) void saveMetric("cadence_rpm", parsed.cadenceRpm, `ble:${device.name ?? "watch"}`, new Date().toISOString()); };
            char.addEventListener("characteristicvaluechanged", handler); await char.startNotifications();
          }
        } catch { /* optional service not exposed */ }
      }
      if (!conn.chars.length) { try { server.disconnect(); } catch {} throw new Error("Aucun service standard de montre détecté."); }
      connRef.current = conn; setDevice({ id: deviceId, name: device.name ?? "Montre BLE" }); setConnected(true); toast.success(`${device.name ?? "Montre"} connectée`);
      await readAll(); timerRef.current = window.setInterval(() => void readAll(), 5000);
      device.addEventListener?.("gattserverdisconnected", () => { setConnected(false); if (timerRef.current != null) window.clearInterval(timerRef.current); timerRef.current = null; });
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)); } finally { setPairing(false); }
  }, [readAll, saveMetric]);

  useEffect(() => { try { const saved = JSON.parse(localStorage.getItem("pace.watch.last_metrics") ?? "{}"); if (saved && typeof saved === "object") setMetrics(saved); } catch {} return () => disconnect(); }, [disconnect]);

  return <div className="space-y-5"><Card className="glass-card"><CardHeader className="flex flex-row items-center gap-3"><div className="size-11 rounded-2xl bg-primary/10 grid place-items-center"><Watch className="size-5 text-primary" /></div><div className="flex-1"><CardTitle>Montre</CardTitle><p className="text-xs text-muted-foreground mt-1">Données BLE standard · notifications + lecture automatique toutes les 5 s</p></div>{connected ? <span className="text-xs flex items-center gap-1 text-emerald-600"><CheckCircle2 className="size-3.5"/> Connectée</span> : <span className="text-xs flex items-center gap-1 text-muted-foreground"><XCircle className="size-3.5"/> Déconnectée</span>}</CardHeader><CardContent className="space-y-4"><div className="flex items-center gap-2 flex-wrap"><Button onClick={connect} disabled={pairing || connected} className="gap-2"><Bluetooth className="size-4"/>{pairing ? "Recherche…" : "Connecter une montre"}</Button>{connected && <Button variant="outline" onClick={disconnect} className="gap-2"><XCircle className="size-4"/> Déconnecter</Button>}{device && <span className="text-sm text-muted-foreground flex items-center gap-1"><Link2 className="size-3.5"/>{device.name}</span>}</div><div className="grid grid-cols-2 md:grid-cols-3 gap-3">{Object.values(metrics).map((m) => { const Icon = labels[m.type]?.icon ?? HeartPulse; return <div key={m.type} className="rounded-2xl border p-4"><div className="flex items-center gap-2 text-xs text-muted-foreground"><Icon className="size-3.5"/>{m.label}</div><div className="text-2xl font-semibold mt-2">{m.value}<span className="text-xs font-normal ml-1 text-muted-foreground">{m.unit}</span></div><div className="text-[10px] text-muted-foreground mt-1">{new Date(m.ts).toLocaleTimeString("fr-FR")}</div></div>; })}</div>{lastSync && <div className="text-[11px] text-muted-foreground flex items-center gap-1"><RefreshCw className="size-3"/> Dernière synchronisation : {new Date(lastSync).toLocaleString("fr-FR")}</div>}<div className="rounded-xl border border-dashed p-3 text-[11px] text-muted-foreground leading-relaxed">Pace synchronise automatiquement les services Bluetooth SIG standards exposés par la montre, avec notifications quand disponibles et une lecture de secours toutes les 5 secondes. Les données propriétaires comme le sommeil détaillé, le stress, la HRV, le GPS ou les calories internes nécessitent l'API Health/Cloud du fabricant ; elles ne peuvent pas être récupérées de façon fiable par Web Bluetooth générique.</div></CardContent></Card></div>;
}
