import { useEffect, useState } from "react";
import { Lock, LockOpen, Fingerprint, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  clearPin, getStoredHash, setPin,
  getLockOnEnter, setLockOnEnter,
  isBiometricAvailable, isBiometricEnabled, enrollBiometric, clearBiometric,
} from "@/lib/finance-lock";
import { toast } from "sonner";

export function FinanceLockSettings() {
  const [enabled, setEnabled] = useState(false);
  const [pin, setLocalPin] = useState("");
  const [pin2, setPin2] = useState("");
  const [lockEnter, setLockEnter] = useState(false);
  const [bioAvail, setBioAvail] = useState(false);
  const [bioOn, setBioOn] = useState(false);

  useEffect(() => {
    setEnabled(!!getStoredHash());
    setLockEnter(getLockOnEnter());
    setBioOn(isBiometricEnabled());
    isBiometricAvailable().then(setBioAvail);
  }, []);

  const enable = async () => {
    if (pin.length < 4) { toast.error("MDP : minimum 4 caractères"); return; }
    if (pin !== pin2) { toast.error("Les mots de passe ne correspondent pas"); return; }
    await setPin(pin);
    setEnabled(true); setLocalPin(""); setPin2("");
    toast.success("Protection activée (Finance + Investissements)");
  };

  const disable = () => {
    if (!confirm("Désactiver la protection ? (Finance ET Investissements seront accessibles sans mot de passe)")) return;
    clearPin();
    setEnabled(false); setBioOn(false);
    toast.success("Protection désactivée");
  };

  const toggleLockEnter = (v: boolean) => {
    setLockOnEnter(v); setLockEnter(v);
    toast.success(v ? "Mot de passe requis à chaque visite" : "Déverrouillage gardé pendant la session");
  };

  const enrollBio = async () => {
    try {
      await enrollBiometric();
      setBioOn(true);
      toast.success("Face ID / Empreinte activé");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Échec de l'enregistrement");
    }
  };
  const removeBio = () => {
    clearBiometric();
    setBioOn(false);
    toast.success("Biométrie désactivée");
  };

  return (
    <div className="rounded-2xl glass-card p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="size-9 rounded-xl bg-muted grid place-items-center">{enabled ? <Lock className="size-4" /> : <LockOpen className="size-4" />}</div>
          <div>
            <div className="font-medium">Protéger Finance & Investissements</div>
            <div className="text-xs text-muted-foreground">Un seul mot de passe pour les deux onglets</div>
          </div>
        </div>
        <Switch
          checked={enabled}
          onCheckedChange={(v) => { if (!v) disable(); }}
          disabled={!enabled}
        />
      </div>

      {!enabled && (
        <div className="space-y-2 pt-3 border-t border-border">
          <div className="text-xs text-muted-foreground">Choisis un mot de passe (4 caractères min).</div>
          <div className="flex gap-2 flex-wrap">
            <Input type="password" autoComplete="new-password" placeholder="Mot de passe" value={pin} onChange={(e) => setLocalPin(e.target.value)} className="flex-1 min-w-32" />
            <Input type="password" autoComplete="new-password" placeholder="Confirmer" value={pin2} onChange={(e) => setPin2(e.target.value)} className="flex-1 min-w-32" />
            <Button onClick={enable} className="rounded-xl">Activer</Button>
          </div>
        </div>
      )}

      {enabled && (
        <>
          <div className="flex items-center justify-between pt-3 border-t border-border">
            <div className="flex items-center gap-2">
              <div className="size-9 rounded-xl bg-muted grid place-items-center"><ShieldCheck className="size-4" /></div>
              <div>
                <div className="font-medium text-sm">Demander à chaque visite</div>
                <div className="text-xs text-muted-foreground">Re-saisie obligatoire même pendant la session</div>
              </div>
            </div>
            <Switch checked={lockEnter} onCheckedChange={toggleLockEnter} />
          </div>

          <div className="flex items-center justify-between pt-3 border-t border-border">
            <div className="flex items-center gap-2">
              <div className="size-9 rounded-xl bg-muted grid place-items-center"><Fingerprint className="size-4" /></div>
              <div>
                <div className="font-medium text-sm">Face ID / Empreinte</div>
                <div className="text-xs text-muted-foreground">
                  {bioAvail ? (bioOn ? "Activé" : "Déverrouiller avec la biométrie de l'appareil") : "Non disponible sur cet appareil/navigateur"}
                </div>
              </div>
            </div>
            {bioOn ? (
              <Button size="sm" variant="ghost" onClick={removeBio} className="rounded-xl">Retirer</Button>
            ) : (
              <Button size="sm" onClick={enrollBio} disabled={!bioAvail} className="rounded-xl">Activer</Button>
            )}
          </div>
        </>
      )}

      <div className="pt-3 border-t border-border text-[11px] text-muted-foreground leading-relaxed">
        ⚠️ Verrou de confort uniquement : les données restent stockées en clair dans ton navigateur. Quelqu'un avec un accès physique à cet appareil et aux outils développeur peut les lire sans le mot de passe. N'y stocke pas d'informations bancaires sensibles (numéros de carte, IBAN complets, etc.).
      </div>
    </div>
  );
}
