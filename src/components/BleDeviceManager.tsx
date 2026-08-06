import { useCallback, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  Watch, Scale, Bluetooth, RefreshCw, ChevronDown, Trash2, Radio, ShieldCheck,
  Upload, CircleDot, BatteryFull, HeartPulse, Footprints, Flame, Ruler,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { insertHealthSamples } from "@/lib/health.functions";
import { useHealthToday } from "@/hooks/use-health";
import { useLocalState, todayKey } from "@/lib/storage";
import {
  ALLOWED_SERVICES, findService, getBluetooth, isAllowedService,
  explainBluetoothError,
  parseBattery, parseBodyFat, parseHeartRate, parseRunningCadence, parseWeight,
  type BleMeasurement, type BluetoothDeviceLike, type BluetoothGattCharacteristicLike,
  type BluetoothGattServerLike, type MeasurementType,
} from "@/lib/ble";
import {
  getMapping, listPairedDevices, removePairedDevice, savePairedDevice, setMapping,
  updateDeviceMeasurement, type PairedDevice, type SensorMapping,
} from "@/lib/paired-devices";
import { dedupeSamples, logImport, readImportLog, clearImportLog, type ImportEntry } from "@/lib/import-log";

// ─── Constantes UX ──────────────────────────────────────────────────────────

const HR_AUTOSAVE_INTERVAL_MS = 30_000; // limitation d'écriture DB
const MEASUREMENT_LABEL: Record<MeasurementType, string> = {
  heart_rate: "Fréquence cardiaque",
  weight: "Poids",
  body_fat: "Masse grasse",
  battery: "Batterie",
  steps: "Pas",
  kcal_active: "Calories actives",
  distance_m: "Distance",
};
const MEASUREMENT_ICON: Record<MeasurementType, React.ComponentType<{ className?: string }>> = {
  heart_rate: HeartPulse, weight: Scale, body_fat: CircleDot, battery: BatteryFull,
  steps: Footprints, kcal_active: Flame, distance_m: Ruler,
};
const TARGET_LABEL: Record<NonNullable<SensorMapping[MeasurementType]>, string> = {
  dashboard: "Tableau de bord", weight: "Widget poids", stats: "Statistiques", off: "Ignorer",
};

type ActiveConnection = {
  device: BluetoothDeviceLike;
  server: BluetoothGattServerLike;
  chars: BluetoothGattCharacteristicLike[];
  handlers: Array<{ ch: BluetoothGattCharacteristicLike; fn: (e: Event) => void }>;
};

// ─── Écran principal ────────────────────────────────────────────────────────

export function BleDeviceManager() {
  const insert = useServerFn(insertHealthSamples);
  const { data: healthToday, refresh: refreshHealth } = useHealthToday();
  const [, setWeights] = useLocalState<Record<string, { w?: number; muscle?: number; fat?: number }>>("lt.weight", {});

  const [devices, setDevices] = useState<PairedDevice[]>([]);
  const [mapping, setMap] = useState<SensorMapping>({});
  const [log, setLog] = useState<ImportEntry[]>([]);
  const [pairing, setPairing] = useState(false);
  const [importing, setImporting] = useState(false);
  const activeRef = useRef<Map<string, ActiveConnection>>(new Map());
  const lastHrSaveRef = useRef<number>(0);

  // ── Chargement initial + événements
  useEffect(() => {
    const sync = () => { setDevices(listPairedDevices()); setMap(getMapping()); setLog(readImportLog()); };
    sync();
    window.addEventListener("lt.ble.devices.changed", sync);
    window.addEventListener("lt.ble.mapping.changed", sync);
    window.addEventListener("lt.import.log.changed", sync);
    return () => {
      window.removeEventListener("lt.ble.devices.changed", sync);
      window.removeEventListener("lt.ble.mapping.changed", sync);
      window.removeEventListener("lt.import.log.changed", sync);
    };
  }, []);

  // ── Cleanup à la destruction : coupe toutes les connexions
  useEffect(() => {
    return () => {
      activeRef.current.forEach((conn) => {
        try {
          conn.handlers.forEach(({ ch, fn }) => ch.removeEventListener?.("characteristicvaluechanged", fn));
          conn.chars.forEach((c) => { try { c.stopNotifications(); } catch {} });
          conn.server.disconnect();
        } catch {}
      });
      activeRef.current.clear();
    };
  }, []);

  // ── Ingestion sécurisée d'une mesure (dedup + mapping + persistance)
  const ingestMeasurement = useCallback(async (m: BleMeasurement) => {
    const map = getMapping();
    const target = map[m.type] ?? "off";
    if (target === "off") return;

    updateDeviceMeasurement(m.deviceId, m.type, m.value, m.ts);

    if (m.type === "weight" || m.type === "body_fat") {
      // Poids → widget poids (localStorage, dedup par jour)
      const key = todayKey();
      setWeights((p) => {
        const cur = p[key] ?? {};
        const next = { ...cur };
        if (m.type === "weight") next.w = m.value;
        if (m.type === "body_fat") next.fat = m.value;
        return { ...p, [key]: next };
      });
      logImport({ source: m.source, inserted: 1, skipped: 0 });
      return;
    }

    if (m.type === "battery") return; // méta-info uniquement

    // Fréquence cardiaque : throttling pour éviter d'écrire 60x/min
    if (m.type === "heart_rate") {
      const now = Date.now();
      if (now - lastHrSaveRef.current < HR_AUTOSAVE_INTERVAL_MS) return;
      lastHrSaveRef.current = now;
    }

    const sample = { ts: m.ts, type: m.type as "heart_rate" | "steps" | "kcal_active" | "distance_m", value: m.value, source: m.source };
    const { fresh, skipped } = dedupeSamples([sample]);
    if (fresh.length === 0) { if (skipped) logImport({ source: m.source, inserted: 0, skipped }); return; }
    try {
      const r = await insert({ data: { samples: fresh } });
      logImport({ source: m.source, inserted: r.inserted, skipped });
      window.dispatchEvent(new Event("lt.health.changed"));
    } catch (e) {
      logImport({ source: m.source, inserted: 0, skipped, error: (e as Error).message });
    }
  }, [insert, setWeights]);

  // ── Ouverture d'un canal notify sur une caractéristique autorisée
  const attachCharacteristic = useCallback(async (
    conn: ActiveConnection,
    ch: BluetoothGattCharacteristicLike,
    parse: (v: DataView) => number | { steps?: number; distanceM?: number } | null,
    deviceId: string,
    deviceName: string,
    type: MeasurementType,
  ) => {
    if (!ch.properties?.notify && !ch.properties?.read) return;
    const handler = (e: Event) => {
      const v = (e.target as unknown as { value: DataView }).value;
      const parsed = parse(v);
      if (parsed == null) return;
      const source = `ble:${deviceName}`;
      const ts = new Date().toISOString();
      if (typeof parsed === "number") {
        void ingestMeasurement({ ts, type, value: parsed, deviceId, deviceName, source });
      } else {
        if (parsed.steps != null) void ingestMeasurement({ ts, type: "steps", value: parsed.steps, deviceId, deviceName, source });
        if (parsed.distanceM != null) void ingestMeasurement({ ts, type: "distance_m", value: parsed.distanceM, deviceId, deviceName, source });
      }
    };
    ch.addEventListener("characteristicvaluechanged", handler);
    conn.handlers.push({ ch, fn: handler });
    if (ch.properties?.notify) { try { await ch.startNotifications(); conn.chars.push(ch); } catch {} }
    if (ch.properties?.read && ch.readValue) {
      try { const v = await ch.readValue(); handler({ target: ch } as unknown as Event); void v; } catch {}
    }
  }, [ingestMeasurement]);

  // ── Connexion (nouveau device ou reconnexion) : découvre les services autorisés
  const connectDevice = useCallback(async (device: BluetoothDeviceLike, isReconnect: boolean): Promise<PairedDevice | null> => {
    if (!device.gatt) throw new Error("GATT non disponible sur cet appareil");
    const server = await device.gatt.connect();

    const foundServices: number[] = [];
    const foundMeasurements = new Set<MeasurementType>();
    const conn: ActiveConnection = { device, server, chars: [], handlers: [] };
    const deviceId = device.id ?? device.name ?? `ble-${Date.now()}`;
    const deviceName = device.name ?? "Appareil BLE";

    for (const spec of ALLOWED_SERVICES) {
      try {
        const svc = await server.getPrimaryService(spec.uuid);
        if (!svc) continue;
        foundServices.push(spec.uuid);
        for (const type of spec.measurements) foundMeasurements.add(type);
        for (const charUuid of spec.characteristics) {
          try {
            const ch = await svc.getCharacteristic(charUuid);
            const parser = pickParser(spec.uuid, charUuid);
            if (!parser) continue;
            await attachCharacteristic(conn, ch, parser.fn, deviceId, deviceName, parser.type);
          } catch { /* caractéristique absente : on ignore */ }
        }
      } catch { /* service absent : on ignore */ }
    }

    if (foundServices.length === 0) {
      try { server.disconnect(); } catch {}
      throw new Error("Aucun service Bluetooth standard reconnu sur cet appareil (services acceptés : Heart Rate, Weight Scale, Body Composition, Battery, Cycling/Running Cadence).");
    }

    // Perte de connexion → cleanup + tentative de reconnexion si activée
    device.addEventListener?.("gattserverdisconnected", () => {
      activeRef.current.delete(deviceId);
      window.dispatchEvent(new Event("lt.ble.devices.changed"));
      const paired = listPairedDevices().find((d) => d.id === deviceId);
      if (paired?.autoReconnect) toast.message(`${deviceName} déconnecté — reconnexion manuelle depuis Réglages.`);
    });

    activeRef.current.set(deviceId, conn);

    const category = deriveCategory(foundServices);
    const measurements = Array.from(foundMeasurements);
    const now = new Date().toISOString();
    const existing = listPairedDevices().find((d) => d.id === deviceId);
    const record: PairedDevice = {
      id: deviceId,
      name: deviceName,
      category,
      services: foundServices,
      measurements,
      pairedAt: existing?.pairedAt ?? now,
      lastSyncAt: now,
      lastValues: existing?.lastValues ?? {},
      battery: existing?.battery ?? null,
      autoReconnect: existing?.autoReconnect ?? true,
    };
    savePairedDevice(record);
    toast.success(`${isReconnect ? "Reconnecté à" : "Appairé avec"} ${deviceName}`);
    return record;
  }, [attachCharacteristic]);

  // ── Lancer le mode "couplage" (scan filtré par catégorie)
  const startPairing = useCallback(async (category: "watch" | "scale" | "any") => {
    const bt = getBluetooth();
    if (!bt) { toast.error("Web Bluetooth non supporté (Chrome/Edge desktop ou Android)."); return; }
    setPairing(true);
    try {
      const services = ALLOWED_SERVICES
        .filter((s) => category === "any" || s.category === category || s.category === "meta")
        .map((s) => s.uuid);
      // Filtres = whitelist stricte. Le navigateur n'expose QUE ces services (limitation de scope).
      const filters = ALLOWED_SERVICES
        .filter((s) => category === "any" || s.category === category)
        .map((s) => ({ services: [s.uuid] }));
      const device = await bt.requestDevice({ filters, optionalServices: services });
      await connectDevice(device, false);
    } catch (e) {
      const msg = explainBluetoothError(e);
      if (!/user cancelled/i.test(msg)) toast.error(msg);
    } finally { setPairing(false); }
  }, [connectDevice]);

  // ── Reconnexion depuis l'historique
  const reconnect = useCallback(async (dev: PairedDevice) => {
    const bt = getBluetooth();
    if (!bt) { toast.error("Web Bluetooth non supporté."); return; }
    try {
      // Web Bluetooth n'expose PAS getDevices() partout : on relance requestDevice sur le même nom.
      const device = await bt.requestDevice({
        filters: [{ name: dev.name }],
        optionalServices: dev.services.filter(isAllowedService),
      });
      await connectDevice(device, true);
    } catch (e) {
      const msg = explainBluetoothError(e);
      if (!/user cancelled/i.test(msg)) toast.error(msg);
    }
  }, [connectDevice]);

  // ── Suppression d'un appareil (coupe la connexion + purge historique)
  const forget = useCallback((id: string, name: string) => {
    if (!confirm(`Supprimer ${name} de vos appareils ?`)) return;
    const conn = activeRef.current.get(id);
    if (conn) {
      try {
        conn.handlers.forEach(({ ch, fn }) => ch.removeEventListener?.("characteristicvaluechanged", fn));
        conn.chars.forEach((c) => { try { c.stopNotifications(); } catch {} });
        conn.server.disconnect();
      } catch {}
      activeRef.current.delete(id);
    }
    removePairedDevice(id);
    toast.success(`${name} supprimé`);
  }, []);

  // ── Import fichier (Apple Health XML / CSV) avec dedup + journal
  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) { return; }
    setImporting(true);
    try {
      const samples = await parseHealthFile(f);
      if (samples.length === 0) { logImport({ source: f.name, inserted: 0, skipped: 0, error: "Aucune donnée reconnue" }); toast.error("Aucune donnée reconnue"); return; }
      const { fresh, skipped } = dedupeSamples(samples);
      let total = 0;
      for (let i = 0; i < fresh.length; i += 500) {
        const chunk = fresh.slice(i, i + 500);
        try {
          const r = await insert({ data: { samples: chunk } });
          total += r.inserted;
        } catch (err) {
          logImport({ source: f.name, inserted: total, skipped, error: (err as Error).message });
          throw err;
        }
      }
      logImport({ source: f.name, inserted: total, skipped });
      toast.success(`${total} nouveaux échantillons · ${skipped} doublons ignorés`);
      window.dispatchEvent(new Event("lt.health.changed"));
      await refreshHealth();
    } catch (err) { toast.error((err as Error).message); }
    finally { setImporting(false); e.target.value = ""; }
  };

  // ── UI
  return (
    <div className="glass-card p-4">
      <Collapsible defaultOpen>
        <CollapsibleTrigger className="w-full flex items-center gap-3">
          <div className="size-10 rounded-xl bg-muted grid place-items-center"><Bluetooth className="size-4" /></div>
          <div className="flex-1 min-w-0 text-left">
            <div className="font-medium">Appareils Bluetooth</div>
            <div className="text-xs text-muted-foreground truncate">
              {devices.length === 0 ? "Aucun appareil appairé" : `${devices.length} appareil${devices.length > 1 ? "s" : ""} · ${healthToday.steps.toLocaleString()} pas · ${healthToday.kcalActive} kcal`}
            </div>
          </div>
          <ChevronDown className="size-4 text-muted-foreground transition-transform data-[state=open]:rotate-180" />
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-4 space-y-4">
          <PairingActions pairing={pairing} onPair={startPairing} />
          <DeviceList devices={devices} onReconnect={reconnect} onForget={forget} />
          <MappingEditor mapping={mapping} onChange={(m) => { setMap(m); setMapping(m); }} />
          <ImportSection importing={importing} onFile={onFile} log={log} onClear={() => clearImportLog()} onRefresh={() => void refreshHealth()} />
          <SecurityBanner />
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

// ─── Sous-composants ────────────────────────────────────────────────────────

function PairingActions({ pairing, onPair }: { pairing: boolean; onPair: (c: "watch" | "scale" | "any") => void }) {
  return (
    <div className="rounded-xl border border-border p-3">
      <div className="text-xs font-medium mb-2 flex items-center gap-2"><Radio className="size-3.5" /> Mode couplage</div>
      <div className="flex gap-2 flex-wrap">
        <Button size="sm" onClick={() => onPair("watch")} disabled={pairing} className="rounded-xl">
          {pairing ? <RefreshCw className="size-3.5 mr-1 animate-spin" /> : <Watch className="size-3.5 mr-1" />} {pairing ? "Recherche…" : "Appairer une montre"}
        </Button>
        <Button size="sm" onClick={() => onPair("scale")} disabled={pairing} className="rounded-xl">
          {pairing ? <RefreshCw className="size-3.5 mr-1 animate-spin" /> : <Scale className="size-3.5 mr-1" />} {pairing ? "Recherche…" : "Appairer une balance"}
        </Button>
        <Button size="sm" variant="secondary" onClick={() => onPair("any")} disabled={pairing} className="rounded-xl">
          {pairing ? <RefreshCw className="size-3.5 mr-1 animate-spin" /> : <Bluetooth className="size-3.5 mr-1" />} {pairing ? "Recherche…" : "Détection auto"}
        </Button>
      </div>
      <div className="text-[11px] text-muted-foreground mt-2">
        Le navigateur ouvre son propre sélecteur d'appareils : seuls les services Bluetooth SIG standards sont demandés (Heart Rate, Weight Scale, Body Composition, Battery, Cadence). Aucune UUID propriétaire.
      </div>
    </div>
  );
}

function DeviceList({ devices, onReconnect, onForget }: { devices: PairedDevice[]; onReconnect: (d: PairedDevice) => void; onForget: (id: string, name: string) => void }) {
  if (devices.length === 0) {
    return <div className="rounded-xl border border-dashed border-border p-3 text-xs text-muted-foreground">Aucun appareil appairé pour le moment. Lancez un mode couplage ci-dessus.</div>;
  }
  return (
    <div className="rounded-xl border border-border divide-y divide-border">
      {devices.map((d) => {
        const Icon = d.category === "scale" ? Scale : Watch;
        return (
          <div key={d.id} className="p-3 flex items-start gap-3">
            <div className="size-9 rounded-lg bg-muted grid place-items-center shrink-0"><Icon className="size-4" /></div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <div className="font-medium truncate">{d.name}</div>
                {d.battery != null && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">{d.battery}%</span>}
              </div>
              <div className="text-[11px] text-muted-foreground mt-0.5">
                {d.measurements.map((m) => MEASUREMENT_LABEL[m]).join(" · ") || "aucune mesure"}
              </div>
              {d.lastSyncAt && <div className="text-[10px] text-muted-foreground mt-0.5">Dernière sync : {new Date(d.lastSyncAt).toLocaleString()}</div>}
              {Object.keys(d.lastValues).length > 0 && (
                <div className="mt-1.5 flex gap-1.5 flex-wrap">
                  {Object.entries(d.lastValues).map(([k, v]) => {
                    const type = k as MeasurementType;
                    const Icon2 = MEASUREMENT_ICON[type];
                    return (
                      <span key={k} className="text-[10px] px-1.5 py-0.5 rounded-md bg-muted flex items-center gap-1">
                        <Icon2 className="size-2.5" />{MEASUREMENT_LABEL[type]} : <strong>{v!.value}</strong>
                      </span>
                    );
                  })}
                </div>
              )}
            </div>
            <div className="flex flex-col gap-1 shrink-0">
              <Button size="sm" variant="ghost" onClick={() => onReconnect(d)} className="h-7 px-2 text-xs"><RefreshCw className="size-3 mr-1" />Reconnecter</Button>
              <Button size="sm" variant="ghost" onClick={() => onForget(d.id, d.name)} className="h-7 px-2 text-xs text-destructive"><Trash2 className="size-3 mr-1" />Retirer</Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function MappingEditor({ mapping, onChange }: { mapping: SensorMapping; onChange: (m: SensorMapping) => void }) {
  const types: MeasurementType[] = ["heart_rate", "weight", "body_fat", "steps", "kcal_active", "distance_m", "battery"];
  return (
    <div className="rounded-xl border border-border p-3">
      <div className="text-xs font-medium mb-2">Mappage des capteurs → widgets</div>
      <div className="space-y-1.5">
        {types.map((t) => {
          const Icon = MEASUREMENT_ICON[t];
          return (
            <div key={t} className="flex items-center gap-2 text-xs">
              <Icon className="size-3.5 text-muted-foreground" />
              <div className="flex-1 truncate">{MEASUREMENT_LABEL[t]}</div>
              <Select value={mapping[t] ?? "off"} onValueChange={(v) => onChange({ ...mapping, [t]: v as NonNullable<SensorMapping[MeasurementType]> })}>
                <SelectTrigger className="h-7 w-40 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(TARGET_LABEL) as Array<keyof typeof TARGET_LABEL>).map((k) => (
                    <SelectItem key={k} value={k}>{TARGET_LABEL[k]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          );
        })}
      </div>
      <div className="text-[11px] text-muted-foreground mt-2">Chaque mesure n'est traitée qu'une fois puis routée vers la destination choisie — pas de duplication.</div>
    </div>
  );
}

function ImportSection({ importing, onFile, log, onClear, onRefresh }: {
  importing: boolean; onFile: (e: React.ChangeEvent<HTMLInputElement>) => void; log: ImportEntry[]; onClear: () => void; onRefresh: () => void;
}) {
  return (
    <div className="rounded-xl border border-border p-3">
      <div className="text-xs font-medium mb-2 flex items-center gap-2"><Upload className="size-3.5" /> Import fichier + journal</div>
      <div className="flex items-center gap-2 flex-wrap">
        <label className="inline-block">
          <input type="file" accept=".xml,.csv,.txt" onChange={onFile} className="hidden" />
          <Button asChild size="sm" variant="secondary" className="rounded-xl" disabled={importing}>
            <span>{importing ? "Import en cours…" : "Apple Health / CSV"}</span>
          </Button>
        </label>
        <Button size="sm" variant="ghost" onClick={onRefresh}><RefreshCw className="size-3.5 mr-1" />Actualiser</Button>
        {log.length > 0 && <Button size="sm" variant="ghost" onClick={onClear} className="text-destructive">Vider le journal</Button>}
      </div>
      {log.length > 0 && (
        <div className="mt-3 max-h-48 overflow-y-auto rounded-lg border border-border divide-y divide-border text-[11px]">
          {log.slice(0, 20).map((e, i) => (
            <div key={i} className="p-2 flex items-start gap-2">
              <div className="text-muted-foreground shrink-0 w-24">{new Date(e.ts).toLocaleTimeString()}</div>
              <div className="flex-1 min-w-0">
                <div className="truncate"><strong>{e.source}</strong></div>
                <div className="text-muted-foreground">+{e.inserted} · {e.skipped} doublons {e.error && <span className="text-destructive">· {e.error}</span>}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SecurityBanner() {
  return (
    <div className="rounded-xl border border-dashed border-border p-3 text-[11px] text-muted-foreground leading-relaxed flex gap-2">
      <ShieldCheck className="size-4 shrink-0 text-primary" />
      <div>
        <strong className="text-foreground">Sécurité</strong> — connexion locale via Web Bluetooth (chiffrement Bluetooth LE 4.2+ AES-128 quand l'appareil le supporte). Whitelist stricte : seuls les services Bluetooth SIG standards sont demandés (Heart Rate 0x180D, Weight Scale 0x181D, Body Composition 0x181B, Battery 0x180F, Cadence 0x1814/0x1816). Aucune UUID propriétaire, aucune écriture GATT, aucune donnée transmise à des tiers. Les mesures sont dédupliquées avant enregistrement et stockées dans votre compte Pace (RLS par utilisateur, TLS 1.3, AES-256 at rest).
      </div>
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function pickParser(serviceUuid: number, charUuid: number): { type: MeasurementType; fn: (v: DataView) => number | { steps?: number; distanceM?: number } | null } | null {
  const svc = findService(serviceUuid);
  if (!svc) return null;
  if (charUuid === 0x2a37) return { type: "heart_rate", fn: parseHeartRate };
  if (charUuid === 0x2a9d) return { type: "weight", fn: parseWeight };
  if (charUuid === 0x2a9c) return { type: "body_fat", fn: parseBodyFat };
  if (charUuid === 0x2a19) return { type: "battery", fn: parseBattery };
  if (charUuid === 0x2a53) return { type: "steps", fn: parseRunningCadence };
  return null;
}

function deriveCategory(services: number[]): PairedDevice["category"] {
  const cats = new Set(services.map((u) => findService(u)?.category).filter(Boolean));
  cats.delete("meta");
  if (cats.size === 1) return Array.from(cats)[0] as PairedDevice["category"];
  if (cats.size > 1) return "mixed";
  return "meta";
}

type ParsedSample = { ts: string; type: "steps" | "kcal_active" | "heart_rate" | "distance_m" | "sleep_min"; value: number; source: string };

async function parseHealthFile(file: File): Promise<ParsedSample[]> {
  const text = await file.text();
  const source = `file:${file.name}`;
  const samples: ParsedSample[] = [];
  if (text.trim().startsWith("<")) {
    const rx = /<Record\s+type="([^"]+)"[^>]*startDate="([^"]+)"[^>]*value="([^"]+)"/g;
    let m;
    while ((m = rx.exec(text)) !== null) {
      const [, t, ts, value] = m;
      const v = parseFloat(value);
      if (!isFinite(v)) continue;
      let type: ParsedSample["type"] | null = null;
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
      samples.push({ ts: new Date(d).toISOString(), type: type as ParsedSample["type"], value, source });
    }
  }
  return samples;
}
