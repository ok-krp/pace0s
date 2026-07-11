import { useEffect, useState } from "react";
import { Lock, Fingerprint } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  isProtected, isUnlocked, lockSession, tryUnlock,
  isBiometricEnabled, verifyBiometric,
} from "@/lib/finance-lock";
import { toast } from "sonner";

export function FinanceLock({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [bioEnabled, setBioEnabled] = useState(false);

  useEffect(() => {
    if (!isProtected()) { setUnlocked(true); }
    else if (isUnlocked()) { setUnlocked(true); }
    setBioEnabled(isBiometricEnabled());
    setReady(true);
  }, []);

  // Auto-trigger biométrie au montage si disponible
  useEffect(() => {
    if (!ready || unlocked || !bioEnabled) return;
    let cancelled = false;
    (async () => {
      const ok = await verifyBiometric();
      if (!cancelled && ok) setUnlocked(true);
    })();
    return () => { cancelled = true; };
  }, [ready, unlocked, bioEnabled]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const ok = await tryUnlock(pin);
      if (ok) { setUnlocked(true); setError(""); setPin(""); }
      else setError("Mot de passe incorrect");
    } catch {
      setError("Erreur de vérification");
    }
  };

  const useBio = async () => {
    const ok = await verifyBiometric();
    if (ok) { setUnlocked(true); setError(""); }
    else toast.error("Authentification biométrique échouée");
  };

  if (!ready) return null;
  if (unlocked) {
    return (
      <>
        {children}
        {isProtected() && (
          <button
            onClick={() => { lockSession(); location.reload(); }}
            className="fixed bottom-20 md:bottom-4 right-4 text-xs text-muted-foreground glass-card rounded-lg px-2 py-1 hover:text-foreground z-50"
          >
            <Lock className="size-3 inline mr-1" />Verrouiller
          </button>
        )}
      </>
    );
  }

  return (
    <div className="max-w-sm mx-auto py-16 px-4">
      <div className="rounded-2xl glass-card p-6 text-center">
        <div className="size-12 rounded-2xl bg-primary/10 text-primary grid place-items-center mx-auto mb-3">
          <Lock className="size-6" />
        </div>
        <div className="font-display text-xl font-semibold">Section protégée</div>
        <div className="text-xs text-muted-foreground mt-1">
          Saisis ton mot de passe pour accéder à Finance & Investissements.
        </div>
        <form onSubmit={submit} className="mt-4 space-y-2">
          <Input type="password" autoFocus value={pin} onChange={(e) => setPin(e.target.value)} placeholder="Mot de passe" className="text-center" />
          {error && <div className="text-xs text-destructive">{error}</div>}
          <Button type="submit" className="w-full rounded-xl">Déverrouiller</Button>
          {bioEnabled && (
            <Button type="button" variant="secondary" onClick={useBio} className="w-full rounded-xl">
              <Fingerprint className="size-4 mr-1.5" />Utiliser Face ID / Empreinte
            </Button>
          )}
        </form>
      </div>
    </div>
  );
}
