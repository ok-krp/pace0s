import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { getGeoLegalContext, getLegalConsentStatus, saveLegalConsent } from "@/lib/legal.functions";
import { DEFAULT_LEGAL_OPTS, regionLabel, writeLocalLegalConsent, type LegalConsentOptions, type LegalRegion } from "@/lib/legal";

const OPTIONS: Array<{ key: keyof LegalConsentOptions; label: string; desc: string }> = [
  { key: "analytics", label: "Mesure d’usage", desc: "Comprendre les écrans utilisés pour améliorer Pace." },
  { key: "notifications", label: "Notifications", desc: "Rappels hydratation, routine, sommeil et tests push." },
  { key: "sync_cloud", label: "Synchronisation Cloud", desc: "Sauvegarder et restaurer vos préférences et données locales." },
  { key: "ai", label: "Analyse IA", desc: "Analyser les photos de repas et générer des conseils nutritionnels." },
];

export function LegalConsentGate() {
  const loadStatus = useServerFn(getLegalConsentStatus);
  const loadGeo = useServerFn(getGeoLegalContext);
  const saveConsent = useServerFn(saveLegalConsent);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
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
        setOpen(status.required);
        if (status.required) {
          const geo = await loadGeo();
          if (!cancelled) {
            setRegion(geo.region);
            setCountry(geo.country);
          }
        }
      } catch (e) {
        if (!cancelled) toast.error(e instanceof Error ? e.message : "Impossible de charger le consentement");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [loadGeo, loadStatus]);

  const legalCopy = useMemo(() => {
    if (region === "CA-US") {
      return "Mode CCPA : droit de savoir, supprimer et refuser la vente ou le partage des données personnelles.";
    }
    if (region === "BR") {
      return "Mode LGPD : traitement limité aux finalités acceptées, droits d’accès, correction, suppression et portabilité.";
    }
    return "Mode RGPD strict : opt-in explicite, minimisation, durée de conservation limitée, droits d’accès, rectification, effacement, portabilité et opposition.";
  }, [region]);

  const toggle = (key: keyof LegalConsentOptions, value: boolean) => {
    setOpts((current) => ({ ...current, [key]: value }));
  };

  const accept = async () => {
    setSaving(true);
    try {
      const result = await saveConsent({ data: { opts } });
      writeLocalLegalConsent(result.opts);
      setOpen(false);
      toast.success("Préférences de confidentialité enregistrées");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Impossible d’enregistrer le consentement");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return null;

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) return; setOpen(true); }}>
      <DialogContent className="max-w-2xl rounded-3xl" hideClose>
        <DialogHeader>
          <div className="mb-2 size-12 rounded-2xl stat-grad grid place-items-center text-primary-foreground">
            <ShieldCheck className="size-5" />
          </div>
          <DialogTitle>Confidentialité Pace</DialogTitle>
          <DialogDescription>
            {regionLabel(region)}{country ? ` · ${country}` : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-2xl border border-border bg-muted/40 p-4 text-sm text-muted-foreground leading-relaxed">
            {legalCopy} Aucune donnée optionnelle n’est envoyée tant que la catégorie correspondante n’est pas acceptée. Contact DPO : privacy@pace.local.
          </div>

          <div className="space-y-3">
            {OPTIONS.map((item) => (
              <label key={item.key} className="flex items-start gap-3 rounded-2xl border border-border p-4 cursor-pointer">
                <Checkbox checked={opts[item.key] === true} onCheckedChange={(checked) => toggle(item.key, checked === true)} className="mt-1" />
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{item.label}</span>
                  <span className="block text-xs text-muted-foreground mt-1">{item.desc}</span>
                </span>
              </label>
            ))}
            {region === "CA-US" && (
              <label className="flex items-start gap-3 rounded-2xl border border-border p-4 cursor-pointer">
                <Checkbox checked={opts.do_not_sell === true} onCheckedChange={(checked) => toggle("do_not_sell", checked === true)} className="mt-1" />
                <span className="min-w-0">
                  <span className="block text-sm font-medium">Do Not Sell My Personal Information</span>
                  <span className="block text-xs text-muted-foreground mt-1">Empêche toute vente ou partage publicitaire des données personnelles.</span>
                </span>
              </label>
            )}
          </div>

          <div className="flex flex-col sm:flex-row gap-2 sm:justify-end">
            <Button variant="secondary" onClick={() => setOpts(DEFAULT_LEGAL_OPTS)} disabled={saving} className="rounded-xl">
              Tout refuser
            </Button>
            <Button onClick={accept} disabled={saving} className="rounded-xl">
              {saving ? "Enregistrement…" : "Enregistrer mes choix"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}