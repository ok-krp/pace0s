import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Watch, Bluetooth, Upload, RefreshCw, ChevronDown, Scale } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { insertHealthSamples } from "@/lib/health.functions";
import { useHealthToday } from "@/hooks/use-health";
import { useLocalState, todayKey } from "@/lib/storage";
import { toast } from "sonner";
import { explainBluetoothError, getBluetooth } from "@/lib/ble";

const HEART_RATE_SERVICE = 0x180d;
const HEART_RATE_MEASUREMENT = 0x2a37;
const WEIGHT_SCALE_SERVICE = 0x181d;
const WEIGHT_MEASUREMENT = 0x2a9d;
const BODY_COMPOSITION_SERVICE = 0x181b;
const BODY_COMPOSITION_MEASUREMENT = 0x2a9c;

type Sample = { ts: string; type: "steps" | "kcal_active" | "heart_rate" | "distance_m" | "sleep_min"; value: number; source: string };
type WeightReading = { weightKg: number; bodyFatPct?: number; muscleKg?: number };

async function connectHeartRate(onValue: (bpm: number) => void): Promise<() => void> {
  const bt = getBluetooth();
  if (!bt) throw new Error("Web Bluetooth non supporté sur ce navigateur (essaie Chrome/Edge Android ou desktop).");
  const device = await bt.requestDevice({
    filters: [{ services: [HEART_RATE_SERVICE] }],
    optionalServices: [HEART_RATE_SERVICE],
  });
  const server = await device.gatt!.connect();
  const service = await server.getPrimaryService(HEART_RATE_SERVICE);
  const char = await service.getCharacteristic(HEART_RATE_MEASUREMENT);
  await char.startNotifications();
  const handler = (e: Event) => {
    const v = (e.target as unknown as { value: DataView }).value;
    const flags = v.getUint8(0);
    const bpm = flags & 0x1 ? v.getUint16(1, true) : v.getUint8(1);
    if (bpm > 0 && bpm < 250) onValue(bpm);
  };
  char.addEventListener("characteristicvaluechanged", handler);
  return () => { try { char.stopNotifications(); server.disconnect(); } catch {} };
}

/** Standard BLE Weight Scale (0x181D) + optional Body Composition (0x181B). Works with any GATT-compliant scale. */
async function connectScale(onReading: (r: WeightReading) => void): Promise<{ stop: () => void; name: string }> {
  const bt = getBluetooth();
  if (!bt) throw new Error("Web Bluetooth non supporté sur ce navigateur.");
  const device = await bt.requestDevice({
    filters: [{ services: [WEIGHT_SCALE_SERVICE] }, { services: [BODY_COMPOSITION_SERVICE] }],
    optionalServices: [WEIGHT_SCALE_SERVICE, BODY_COMPOSITION_SERVICE],
  });
  const server = await device.gatt!.connect();
  const cleanup: Array<() => void> = [];
  let last: WeightReading = { weightKg: 0 };

  const tryService = async (uuid: number, charUuid: number, parse: (v: DataView) => Partial<WeightReading> | null) => {
    try {
      const svc = await server.getPrimaryService(uuid);
      const ch = await svc.getCharacteristic(charUuid);
      await ch.startNotifications();
      const h = (e: Event) => {
        const v = (e.target as unknown as { value: DataView }).value;
        const part = parse(v);
        if (!part) return;
        last = { ...last, ...part };
        if (last.weightKg > 0) onReading(last);
      };
      ch.addEventListener("characteristicvaluechanged", h);
      cleanup.push(() => { try { ch.stopNotifications(); } catch {} });
    } catch { /* service not present */ }
  };

  // Weight Measurement (0x2A9D): flags, weight (uint16, resolution 0.005 kg or 0.01 lb)
  await tryService(WEIGHT_SCALE_SERVICE, WEIGHT_MEASUREMENT, (v) => {
    if (v.byteLength < 3) return null;
    const flags = v.getUint8(0);
    const imperial = (flags & 0x01) === 0x01;
    const raw = v.getUint16(1, true);
    const weightKg = imperial ? raw * 0.01 * 0.45359237 : raw * 0.005;
    return weightKg > 2 && weightKg < 400 ? { weightKg: Math.round(weightKg * 100) / 100 } : null;
  });

  // Body Composition Measurement (0x2A9C): flags, body fat %, ...optional fields
  await tryService(BODY_COMPOSITION_SERVICE, BODY_COMPOSITION_MEASUREMENT, (v) => {
    if (v.byteLength < 4) return null;
    const bodyFatRaw = v.getUint16(2, true);
    const bodyFatPct = bodyFatRaw * 0.1;
    return bodyFatPct > 2 && bodyFatPct < 70 ? { bodyFatPct: Math.round(bodyFatPct * 10) / 10 } : null;
  });

  return {
    stop: () => { cleanup.forEach((c) => c()); try { server.disconnect(); } catch {} },
    name: device.name ?? "Balance BLE",
  };
}



interface BluetoothDeviceLike { gatt?: { connect: () => Promise<BluetoothRemoteGATTServer> }; name?: string }
interface BluetoothRemoteGATTServer { disconnect: () => void; getPrimaryService: (s: number) => Promise<BluetoothRemoteGATTService> }
interface BluetoothRemoteGATTService { getCharacteristic: (c: number) => Promise<BluetoothRemoteGATTCharacteristic> }
interface BluetoothRemoteGATTCharacteristic {
  startNotifications: () => Promise<void>;
  stopNotifications: () => Promise<void>;
  addEventListener: (t: string, l: (e: Event) => void) => void;
}

/** Parses a small subset of Apple Health export.xml + generic CSV (date,type,value). */
async function parseHealthFile(file: File): Promise<Sample[]> {
  const text = await file.text();
  const source = file.name;
  const samples: Sample[] = [];
  if (text.trim().startsWith("<")) {
    // Apple Health export.xml — extract <Record type="HKQuantityTypeIdentifierStepCount" startDate=".." value="..">
    const rx = /<Record\s+type="([^"]+)"[^>]*startDate="([^"]+)"[^>]*value="([^"]+)"/g;
    let m;
    while ((m = rx.exec(text)) !== null) {
      const [, t, ts, value] = m;
      const v = parseFloat(value);
      if (!isFinite(v)) continue;
      let type: Sample["type"] | null = null;
      if (t.includes("StepCount")) type = "steps";
      else if (t.includes("ActiveEnergyBurned")) type = "kcal_active";
      else if (t.includes("HeartRate")) type = "heart_rate";
      else if (t.includes("DistanceWalkingRunning")) type = "distance_m";
      else if (t.includes("SleepAnalysis")) type = "sleep_min";
      if (!type) continue;
      samples.push({ ts: new Date(ts).toISOString(), type, value: v, source: "apple_health" });
      if (samples.length >= 5000) break;
    }
  } else {
    const lines = text.split(/\r?\n/).filter(Boolean);
    for (const line of lines.slice(0, 5000)) {
      const [d, t, v] = line.split(/[;,\t]/);
      if (!d || !t || !v) continue;
      const value = parseFloat(v);
      const type = t.trim().toLowerCase();
      const known = ["steps", "kcal_active", "heart_rate", "distance_m", "sleep_min"] as const;
      if (!known.includes(type as (typeof known)[number]) || !isFinite(value)) continue;
      samples.push({ ts: new Date(d).toISOString(), type: type as Sample["type"], value, source });
    }
  }
  return samples;
}

type WeightEntry = { w?: number; muscle?: number; fat?: number };

export function HealthSettings() {
  const insert = useServerFn(insertHealthSamples);
  const { data, refresh } = useHealthToday();
  const [, setWeights] = useLocalState<Record<string, WeightEntry>>("pace.weight", {});
  const [bpm, setBpm] = useState<number | null>(null);
  const [connected, setConnected] = useState(false);
  const [importing, setImporting] = useState(false);
  const [disconnect, setDisconnect] = useState<null | (() => void)>(null);

  const [scale, setScale] = useState<{ name: string; stop: () => void } | null>(null);
  const [reading, setReading] = useState<WeightReading | null>(null);

  const connect = async () => {
    try {
      const stop = await connectHeartRate((v) => setBpm(v));
      setConnected(true);
      setDisconnect(() => stop);
      toast.success("Montre connectée (fréquence cardiaque)");
    } catch (e) {
      toast.error(explainBluetoothError(e));
    }
  };

  const connectScaleFn = async () => {
    try {
      const s = await connectScale((r) => setReading(r));
      setScale(s);
      toast.success(`Balance ${s.name} connectée`);
    } catch (e) {
      toast.error(explainBluetoothError(e));
    }
  };

  const saveWeight = () => {
    if (!reading?.weightKg) return;
    const key = todayKey();
    setWeights((p) => ({
      ...p,
      [key]: {
        ...p[key],
        w: reading.weightKg,
        fat: reading.bodyFatPct ?? p[key]?.fat,
        muscle: reading.muscleKg ?? p[key]?.muscle,
      },
    }));
    toast.success(`Poids ${reading.weightKg} kg enregistré`);
  };

  const saveBpm = async () => {
    if (!bpm) return;
    try {
      await insert({ data: { samples: [{ ts: new Date().toISOString(), type: "heart_rate", value: bpm, source: "ble" }] } });
      toast.success(`BPM ${bpm} enregistré`);
      window.dispatchEvent(new Event("pace.health.changed"));
    } catch (e) { toast.error((e as Error).message); }
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setImporting(true);
    try {
      const samples = await parseHealthFile(f);
      if (samples.length === 0) { toast.error("Aucune donnée reconnue"); return; }
      const chunks: Sample[][] = [];
      for (let i = 0; i < samples.length; i += 500) chunks.push(samples.slice(i, i + 500));
      let total = 0;
      for (const c of chunks) {
        const r = await insert({ data: { samples: c } });
        total += r.inserted;
      }
      toast.success(`${total} échantillons importés`);
      window.dispatchEvent(new Event("pace.health.changed"));
      await refresh();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setImporting(false);
      e.target.value = "";
    }
  };

  return (
    <div className="glass-card p-4">
      <Collapsible>
        <CollapsibleTrigger className="w-full flex items-center gap-3">
          <div className="size-10 rounded-xl bg-muted grid place-items-center"><Watch className="size-4" /></div>
          <div className="flex-1 min-w-0 text-left">
            <div className="font-medium">Montre & balance connectées</div>
            <div className="text-xs text-muted-foreground truncate">
              Aujourd'hui : {data.steps.toLocaleString()} pas · {data.kcalActive} kcal
            </div>
          </div>
          <ChevronDown className="size-4 text-muted-foreground transition-transform data-[state=open]:rotate-180" />
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-4 space-y-4">
          <div className="rounded-xl border border-border p-3">
            <div className="text-xs font-medium mb-2 flex items-center gap-2"><Bluetooth className="size-3.5" /> Montre BLE (fréquence cardiaque)</div>
            {connected ? (
              <div className="flex items-center gap-2 flex-wrap">
                <div className="text-2xl font-display font-semibold">{bpm ?? "…"} <span className="text-xs text-muted-foreground">bpm</span></div>
                <Button size="sm" onClick={saveBpm} disabled={!bpm}>Enregistrer</Button>
                <Button size="sm" variant="ghost" onClick={() => { disconnect?.(); setConnected(false); setBpm(null); }}>Déconnecter</Button>
              </div>
            ) : (
              <Button size="sm" onClick={connect} className="rounded-xl"><Bluetooth className="size-3.5 mr-1" />Connecter une montre BLE</Button>
            )}
            <div className="text-[11px] text-muted-foreground mt-2">Compatible avec toute montre exposant le service standard "Heart Rate" (Polar, Wahoo, Garmin en diffusion…). Web Bluetooth requis.</div>
          </div>

          <div className="rounded-xl border border-border p-3">
            <div className="text-xs font-medium mb-2 flex items-center gap-2"><Scale className="size-3.5" /> Balance BLE (poids + composition)</div>
            {scale ? (
              <div className="space-y-2">
                <div className="flex items-baseline gap-3 flex-wrap">
                  <div className="text-2xl font-display font-semibold">{reading?.weightKg ? `${reading.weightKg} kg` : "…"}</div>
                  {reading?.bodyFatPct != null && <div className="text-sm text-muted-foreground">{reading.bodyFatPct}% MG</div>}
                </div>
                <div className="flex gap-2 flex-wrap">
                  <Button size="sm" onClick={saveWeight} disabled={!reading?.weightKg}>Enregistrer la pesée</Button>
                  <Button size="sm" variant="ghost" onClick={() => { scale.stop(); setScale(null); setReading(null); }}>Déconnecter</Button>
                </div>
              </div>
            ) : (
              <Button size="sm" onClick={connectScaleFn} className="rounded-xl"><Bluetooth className="size-3.5 mr-1" />Connecter une balance BLE</Button>
            )}
            <div className="text-[11px] text-muted-foreground mt-2">Compatible avec toute balance implémentant les services Bluetooth standard "Weight Scale" (0x181D) et/ou "Body Composition" (0x181B) — Withings, Xiaomi (mode standard), MyKronoz, Renpho compatible GATT…</div>
          </div>

          <div className="rounded-xl border border-border p-3">
            <div className="text-xs font-medium mb-2 flex items-center gap-2"><Upload className="size-3.5" /> Import fichier (Apple Health export.xml ou CSV)</div>
            <label className="inline-block">
              <input type="file" accept=".xml,.csv,.txt" onChange={onFile} className="hidden" />
              <Button asChild size="sm" variant="secondary" className="rounded-xl" disabled={importing}>
                <span>{importing ? "Import en cours…" : "Choisir un fichier"}</span>
              </Button>
            </label>
            <div className="text-[11px] text-muted-foreground mt-2">
              CSV attendu : <code>date,type,value</code> — type ∈ steps, kcal_active, heart_rate, distance_m, sleep_min.
            </div>
          </div>

          <div className="rounded-xl border border-border p-3 text-xs text-muted-foreground flex items-center justify-between">
            <div>Dernière source : <span className="text-foreground">{data.lastSource ?? "aucune"}</span> · {data.count} échantillons aujourd'hui</div>
            <Button size="sm" variant="ghost" onClick={() => void refresh()}><RefreshCw className="size-3.5" /></Button>
          </div>

          <div className="rounded-xl border border-dashed border-border p-3 text-[11px] text-muted-foreground leading-relaxed">
            <strong className="text-foreground">Sécurité</strong> — les appareils Bluetooth sont appairés localement dans votre navigateur via l'API Web Bluetooth (autorisation explicite à chaque connexion, aucune donnée envoyée à des tiers). Les mesures ne sont enregistrées qu'après avoir cliqué sur "Enregistrer", et sont stockées dans votre compte Pace chiffré (RLS par utilisateur, TLS 1.3, AES-256 at rest).
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

