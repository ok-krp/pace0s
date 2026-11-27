import { useCallback, useEffect, useState } from "react";
import { Copy, Link2, ShieldCheck, UserRound, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { isLegalCategoryAllowed } from "@/lib/legal";
import { isFollowingSharedAppearance } from "@/hooks/use-shared-appearance";
import { toast } from "sonner";

type AppearanceShare = {
  direction: "incoming" | "outgoing";
  other_user_id: string;
  created_at: string;
};

type AppearanceRpcResponse = {
  data: unknown;
  error: { message: string } | null;
};

type AppearanceRpcClient = {
  rpc(name: string, args?: Record<string, unknown>): Promise<AppearanceRpcResponse>;
};

const rpc = supabase as unknown as AppearanceRpcClient;

export function AppearanceSharingSettings() {
  const [shares, setShares] = useState<AppearanceShare[]>([]);
  const [inviteToken, setInviteToken] = useState("");
  const [acceptToken, setAcceptToken] = useState("");
  const [loading, setLoading] = useState(false);
  const [syncConsent, setSyncConsent] = useState(() => isLegalCategoryAllowed("sync_cloud"));
  const [following, setFollowing] = useState(false);

  const refresh = useCallback(async () => {
    const result = await rpc.rpc("list_appearance_shares");
    if (result.error) throw new Error(result.error.message);
    setShares(Array.isArray(result.data) ? result.data as AppearanceShare[] : []);
    setFollowing(isFollowingSharedAppearance());
  }, []);

  useEffect(() => {
    const onConsentChange = () => {
      const allowed = isLegalCategoryAllowed("sync_cloud");
      setSyncConsent(allowed);
      if (!allowed) {
        setInviteToken("");
        setAcceptToken("");
      }
      void refresh().catch((error) => console.warn("[appearance-sharing] consent refresh failed", error));
    };
    const onSharedAppearanceChange = (event: Event) => {
      const active = (event as CustomEvent<{ active?: boolean }>).detail?.active === true;
      setFollowing(active);
    };
    const onRefresh = () => { void refresh().catch((error) => console.warn("[appearance-sharing] list failed", error)); };
    window.addEventListener("pace.legal.changed", onConsentChange);
    window.addEventListener("pace.shared-appearance.change", onSharedAppearanceChange);
    window.addEventListener("pace.shared-appearance.refresh", onRefresh);
    void refresh().catch((error) => console.warn("[appearance-sharing] list failed", error));
    return () => {
      window.removeEventListener("pace.legal.changed", onConsentChange);
      window.removeEventListener("pace.shared-appearance.change", onSharedAppearanceChange);
      window.removeEventListener("pace.shared-appearance.refresh", onRefresh);
    };
  }, [refresh]);

  const createInvite = async () => {
    if (!syncConsent || loading) return;
    setLoading(true);
    try {
      const result = await rpc.rpc("create_appearance_share_invite");
      if (result.error) throw new Error(result.error.message);
      if (typeof result.data !== "string" || !/^[0-9a-f]{64}$/.test(result.data)) {
        throw new Error("Le serveur n'a pas renvoyé un code d'invitation valide.");
      }
      setInviteToken(result.data);
      try {
        await navigator.clipboard.writeText(result.data);
        toast.success("Code d'invitation copié. Il expire dans 24 heures.");
      } catch {
        toast.success("Code créé. Copie-le depuis le champ affiché ; il expire dans 24 heures.");
      }
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Impossible de créer l'invitation.");
    } finally {
      setLoading(false);
    }
  };

  const copyInvite = async () => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard API unavailable");
      await navigator.clipboard.writeText(inviteToken);
      toast.success("Code copié.");
    } catch {
      toast.error("Copie indisponible sur ce navigateur. Sélectionne le code dans le champ.");
    }
  };

  const acceptInvite = async () => {
    const token = acceptToken.trim().toLowerCase();
    if (!syncConsent || loading) return;
    if (!/^[0-9a-f]{64}$/.test(token)) {
      toast.error("Colle le code d'invitation complet de 64 caractères hexadécimaux.");
      return;
    }
    setLoading(true);
    try {
      const result = await rpc.rpc("accept_appearance_share_invite", { p_token: token });
      if (result.error) throw new Error(result.error.message);
      setAcceptToken("");
      window.dispatchEvent(new Event("pace.shared-appearance.refresh"));
      await refresh();
      toast.success("Apparence du compte acceptée. Elle sera appliquée sur cet appareil sans remplacer tes réglages personnels.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Impossible d'accepter l'invitation.");
    } finally {
      setLoading(false);
    }
  };

  const revokeShare = async (otherUserId: string) => {
    if (loading) return;
    setLoading(true);
    try {
      const result = await rpc.rpc("revoke_appearance_share", { p_other_user_id: otherUserId });
      if (result.error) throw new Error(result.error.message);
      window.dispatchEvent(new Event("pace.shared-appearance.refresh"));
      await refresh();
      toast.success("Partage révoqué.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Impossible de révoquer ce partage.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="space-y-4 border-t border-border pt-4" aria-labelledby="appearance-sharing-title">
      <div className="flex items-start gap-3">
        <div className="glass-icon grid size-10 shrink-0 place-items-center"><ShieldCheck className="size-4" /></div>
        <div className="min-w-0 flex-1">
          <h3 id="appearance-sharing-title" className="font-medium">Partager l'apparence entre comptes</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Partage uniquement le thème, le mode sombre et le fond d'écran actuel. Aucune donnée santé, nutrition ou personnelle n'est partagée.
          </p>
        </div>
      </div>

      {following && (
        <div className="rounded-xl border border-border bg-muted/30 p-3 text-sm">
          Cet appareil suit actuellement l'apparence d'un autre compte. Tes préférences locales restent enregistrées et seront restaurées à la fin du partage.
        </div>
      )}

      {!syncConsent && (
        <p className="rounded-xl border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
          Active d'abord « Synchronisation entre appareils » dans Confidentialité pour créer ou accepter un partage.
        </p>
      )}

      <div className="space-y-2">
        <div className="text-sm font-medium">Partager mon apparence</div>
        <p className="text-xs text-muted-foreground">Crée un code à usage unique et transmets-le à l'autre personne. Le code expire au bout de 24 heures.</p>
        <Button type="button" size="sm" variant="secondary" onClick={() => void createInvite()} disabled={!syncConsent || loading} className="rounded-xl">
          <Link2 className="mr-2 size-4" />Créer un code d'invitation
        </Button>
        {inviteToken && (
          <div className="flex gap-2">
            <Input aria-label="Code d'invitation à partager" readOnly value={inviteToken} className="font-mono text-xs" onFocus={(event) => event.currentTarget.select()} />
            <Button type="button" size="icon" variant="outline" aria-label="Copier le code" onClick={() => void copyInvite()}>
              <Copy className="size-4" />
            </Button>
          </div>
        )}
      </div>

      <div className="space-y-2 border-t border-border pt-3">
        <div className="text-sm font-medium">Suivre l'apparence d'un autre compte</div>
        <div className="flex gap-2">
          <Input
            aria-label="Code d'invitation reçu"
            value={acceptToken}
            onChange={(event) => setAcceptToken(event.target.value.replace(/[^0-9a-f]/gi, "").slice(0, 64))}
            placeholder="Coller le code de 64 caractères"
            autoComplete="off"
            spellCheck={false}
            className="font-mono text-xs"
            disabled={!syncConsent || loading}
          />
          <Button type="button" size="sm" onClick={() => void acceptInvite()} disabled={!syncConsent || loading || acceptToken.trim().length !== 64} className="rounded-xl">
            Accepter
          </Button>
        </div>
      </div>

      <div className="space-y-2 border-t border-border pt-3">
        <div className="text-sm font-medium">Partages actifs</div>
        {shares.length === 0 ? (
          <p className="text-xs text-muted-foreground">Aucun partage actif.</p>
        ) : (
          <ul className="space-y-2">
            {shares.map((share) => (
              <li key={share.direction + ":" + share.other_user_id} className="flex items-center gap-2 rounded-xl border border-border p-3">
                <UserRound className="size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{share.direction === "incoming" ? "Apparence suivie" : "Partagée avec"}</div>
                  <div className="truncate font-mono text-[11px] text-muted-foreground">{share.other_user_id}</div>
                </div>
                <Button type="button" size="icon" variant="ghost" aria-label={share.direction === "incoming" ? "Ne plus suivre ce compte" : "Révoquer le partage"} title={share.direction === "incoming" ? "Ne plus suivre" : "Révoquer"} disabled={loading} onClick={() => void revokeShare(share.other_user_id)}>
                  <X className="size-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
