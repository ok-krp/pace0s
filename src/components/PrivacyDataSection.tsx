import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Download, Trash2, ShieldAlert, Settings2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { exportMyData, deleteMyAccount } from "@/lib/privacy.functions";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { openConsentSheet } from "@/components/LegalConsentGate";

export function PrivacyDataSection() {
  const runExport = useServerFn(exportMyData);
  const runDelete = useServerFn(deleteMyAccount);
  const { user } = useAuth();
  const [busy, setBusy] = useState<null | "export" | "delete">(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");

  const handleExport = async () => {
    setBusy("export");
    try {
      const payload = await runExport();
      const pretty = {
        generated_at: payload.generated_at,
        user: { id: payload.user_id, email: payload.email },
        schema_version: payload.schema_version,
        data: JSON.parse(payload.json),
      };
      const blob = new Blob([JSON.stringify(pretty, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `pace-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Vos données ont été exportées");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Export impossible");
    } finally {
      setBusy(null);
    }
  };


  const handleDelete = async () => {
    if (confirmText !== "SUPPRIMER") return;
    setBusy("delete");
    try {
      await runDelete();
      // Purge locale
      Object.keys(localStorage).filter((k) => k.startsWith("lt.")).forEach((k) => localStorage.removeItem(k));
      await supabase.auth.signOut();
      toast.success("Compte supprimé. À bientôt.");
      setTimeout(() => { window.location.href = "/login"; }, 400);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Suppression impossible");
      setBusy(null);
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground leading-relaxed px-1">
        Compte : <span className="font-medium text-foreground/80">{user?.email ?? "—"}</span>. Ces actions respectent
        vos droits RGPD Art. 17 & 20, CCPA §1798.105/110 et LGPD Art. 18.
      </p>

      <button
        type="button"
        onClick={() => openConsentSheet()}
        className="w-full flex items-center gap-3 rounded-2xl glass-card p-4 hover:border-primary/40 transition-colors text-left"
      >
        <div className="size-10 rounded-xl bg-muted grid place-items-center"><Settings2 className="size-4" /></div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium">Gérer mes consentements</div>
          <div className="text-xs text-muted-foreground">Analytique, notifications, IA, synchronisation cloud</div>
        </div>
        <span className="text-xs text-muted-foreground">Ouvrir →</span>
      </button>

      <div className="flex items-center gap-4 rounded-2xl glass-card p-4">
        <div className="size-10 rounded-xl bg-muted grid place-items-center"><Download className="size-4" /></div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium">Exporter mes données</div>
          <div className="text-xs text-muted-foreground">JSON complet : sport, finance, santé, nutrition, préférences.</div>
        </div>
        <Button variant="secondary" size="sm" onClick={handleExport} disabled={busy !== null} className="rounded-xl">
          {busy === "export" ? "Génération…" : "Exporter"}
        </Button>
      </div>

      <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4">
        <div className="flex items-center gap-3">
          <div className="size-10 rounded-xl bg-destructive/15 text-destructive grid place-items-center">
            <ShieldAlert className="size-4" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-destructive">Zone dangereuse</div>
            <div className="text-xs text-muted-foreground">Supprime définitivement votre compte et toutes vos données.</div>
          </div>
          <Button variant="destructive" size="sm" onClick={() => { setConfirmText(""); setConfirmOpen(true); }} className="rounded-xl">
            <Trash2 className="size-3.5" /> Supprimer
          </Button>
        </div>
      </div>

      <Dialog open={confirmOpen} onOpenChange={(o) => { if (!busy) setConfirmOpen(o); }}>
        <DialogContent className="rounded-3xl">
          <DialogHeader>
            <div className="mb-2 size-12 rounded-2xl bg-destructive/15 text-destructive grid place-items-center">
              <ShieldAlert className="size-5" />
            </div>
            <DialogTitle>Supprimer définitivement votre compte ?</DialogTitle>
            <DialogDescription>
              Cette action est irréversible. Toutes vos données (sport, finance, santé, nutrition, préférences, consentements)
              seront effacées de nos serveurs. Vous serez déconnecté immédiatement.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <label className="text-xs text-muted-foreground">
              Pour confirmer, tapez <span className="font-mono font-semibold text-foreground">SUPPRIMER</span> ci-dessous.
            </label>
            <Input
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="SUPPRIMER"
              autoComplete="off"
              className="rounded-xl font-mono"
              disabled={busy === "delete"}
            />
          </div>
          <DialogFooter className="gap-2">
            <Button variant="secondary" onClick={() => setConfirmOpen(false)} disabled={busy === "delete"} className="rounded-xl">
              Annuler
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={confirmText !== "SUPPRIMER" || busy === "delete"}
              className="rounded-xl"
            >
              {busy === "delete" ? "Suppression…" : "Supprimer mon compte"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
