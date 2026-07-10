import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { ShieldCheck, Settings2, Check, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { getGeoLegalContext, getLegalConsentStatus, saveLegalConsent } from "@/lib/legal.functions";
import { DEFAULT_LEGAL_OPTS, regionLabel, writeLocalLegalConsent, type LegalConsentOptions, type LegalRegion } from "@/lib/legal";

const OPEN_EVENT = "lt.legal.open";

/** Ouvre la modale de consentement depuis n'importe où (ex: écran Paramètres). */
export function openConsentSheet() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(OPEN_EVENT));
}

type Category = { key: keyof LegalConsentOptions; label: string; desc: string; group: "functional" | "analytics" | "marketing" };

const OPTIONS: Category[] = [
  { key: "sync_cloud",    label: "Fonctionnel — Synchronisation",  desc: "Sauvegarde chiffrée des préférences entre appareils.",     group: "functional" },
  { key: "notifications", label: "Fonctionnel — Notifications",    desc: "Rappels hydratation, routine, sommeil.",                    group: "functional" },
  { key: "analytics",     label: "Analytique — Mesure d'usage",    desc: "Statistiques anonymes pour améliorer Pace.",                group: "analytics" },
  { key: "ai",            label: "Marketing — Analyse IA",         desc: "Analyse photos de repas et conseils nutrition personnalisés.", group: "marketing" },
];

const ALL_ACCEPTED: LegalConsentOptions = { analytics: true, notifications: true, sync_cloud: true, ai: true };

export function LegalConsentGate() {
  const loadStatus = useServerFn(getLegalConsentStatus);
  const loadGeo = useServerFn(getGeoLegalContext);
  const saveConsent = useServerFn(saveLegalConsent);

  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"intro" | "custom">("intro");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [required, setRequired] = useState(false); // true → sheet non fermable manuellement
  const [region, setRegion] = useState<LegalRegion>("OTHER");
  const [country, setCountry] = useState<string | null>(null);
  const [opts, setOpts] = useState<LegalConsentOptions>(DEFAULT_LEGAL_OPTS);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const status = await loadStatus();
        if (cancelled) return;
        setRegion(status.region);
        setCountry(status.ipCountry);
        setOpts(status.opts);
        writeLocalLegalConsent(status.opts);
        setRequired(status.required);
        setOpen(status.required);
        if (status.required) {
          const geo = await loadGeo();
          if (!cancelled) { setRegion(geo.region); setCountry(geo.country); }
        }
      } catch (e) {
        if (!cancelled) toast.error(e instanceof Error ? e.message : "Impossible de charger le consentement");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [loadGeo, loadStatus]);

  // Écoute des ouvertures externes (bouton "Gérer mes consentements" dans Paramètres)
  useEffect(() => {
    const onOpen = () => { setRequired(false); setMode("intro"); setOpen(true); };
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_EVENT, onOpen);
  }, []);

  const legalCopy = useMemo(() => {
    if (region === "CA-US") return "Mode CCPA : droit de savoir, supprimer et refuser la vente ou le partage.";
    if (region === "BR") return "Mode LGPD : traitement limité aux finalités acceptées, droits d'accès et suppression.";
    if (region === "CH") return "Mode nLPD (Suisse) : opt-in explicite, minimisation, droits d'accès et effacement.";
    if (region === "UK") return "Mode UK GDPR : opt-in explicite, minimisation, droits d'accès, effacement et portabilité.";
    if (region === "EU") return "Mode RGPD strict : opt-in explicite, minimisation, durée limitée, droits d'accès, rectification, effacement, portabilité et opposition.";
    return "Protection stricte par défaut. Aucune catégorie optionnelle n'est activée sans votre accord.";
  }, [region]);

  const persist = async (next: LegalConsentOptions) => {
    setSaving(true);
    try {
      const result = await saveConsent({ data: { opts: next } });
      writeLocalLegalConsent(result.opts);
      setOpts(result.opts);
      setOpen(false);
      toast.success("Préférences enregistrées");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Enregistrement impossible");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return null;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (required && !next) return; // bloque la fermeture au premier passage
        setOpen(next);
      }}
    >
      <DialogContent
        className="max-w-lg glass-card border-white/20 p-6 sm:p-7 [&>button]:hidden"
        hideClose={required}
      >
        <DialogHeader className="space-y-3">
          <div className="size-11 rounded-2xl bg-primary/12 text-primary grid place-items-center">
            <ShieldCheck className="size-5" />
          </div>
          <DialogTitle className="font-display text-xl tracking-tight">Confidentialité Pace</DialogTitle>
          <DialogDescription className="text-xs uppercase tracking-widest">
            {regionLabel(region)}{country ? ` · ${country}` : ""}
          </DialogDescription>
        </DialogHeader>

        <p className="text-sm text-muted-foreground leading-relaxed">{legalCopy}</p>

        {mode === "intro" ? (
          <div className="mt-2 space-y-2.5">
            <Button
              onClick={() => persist(ALL_ACCEPTED)}
              disabled={saving}
              className="w-full rounded-2xl h-11 justify-center gap-2"
            >
              <Check className="size-4" /> Tout accepter
            </Button>
            <Button
              variant="secondary"
              onClick={() => persist(DEFAULT_LEGAL_OPTS)}
              disabled={saving}
              className="w-full rounded-2xl h-11 justify-center gap-2"
            >
              <X className="size-4" /> Tout refuser
            </Button>
            <button
              type="button"
              onClick={() => setMode("custom")}
              disabled={saving}
              className="w-full inline-flex items-center justify-center gap-2 rounded-2xl h-11 text-sm font-medium text-foreground/80 hover:text-foreground hover:bg-foreground/5 transition-colors"
            >
              <Settings2 className="size-4" /> Personnaliser
            </button>
            <p className="text-[10px] text-muted-foreground/70 text-center pt-1">
              Modifiable à tout moment dans Paramètres → Confidentialité.
            </p>
          </div>
        ) : (
          <div className="mt-2 space-y-3">
            {OPTIONS.map((item) => (
              <label
                key={item.key}
                className="flex items-center gap-3 rounded-2xl border border-border/60 bg-card/40 p-3.5 cursor-pointer"
              >
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium">{item.label}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">{item.desc}</div>
                </div>
                <Switch
                  checked={opts[item.key] === true}
                  onCheckedChange={(v) => setOpts((s) => ({ ...s, [item.key]: v }))}
                />
              </label>
            ))}
            {region === "CA-US" && (
              <label className="flex items-center gap-3 rounded-2xl border border-border/60 bg-card/40 p-3.5 cursor-pointer">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium">Do Not Sell My Personal Information</div>
                  <div className="text-xs text-muted-foreground mt-0.5">CCPA — refus de toute vente ou partage.</div>
                </div>
                <Switch
                  checked={opts.do_not_sell === true}
                  onCheckedChange={(v) => setOpts((s) => ({ ...s, do_not_sell: v }))}
                />
              </label>
            )}
            <div className="flex gap-2 pt-1">
              <Button
                variant="ghost"
                onClick={() => setMode("intro")}
                disabled={saving}
                className="rounded-xl"
              >
                Retour
              </Button>
              <Button
                onClick={() => persist(opts)}
                disabled={saving}
                className="flex-1 rounded-xl"
              >
                {saving ? "Enregistrement…" : "Enregistrer mes choix"}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
