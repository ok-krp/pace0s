import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const USER_TABLES = [
  "profiles",
  "food_log",
  "food_scans",
  "health_samples",
  "legal_consent",
  "notification_log",
  "reminder_settings",
  "reminder_debug_log",
  "user_state",
] as const;

/**
 * Portabilité (RGPD Art. 20 / LGPD Art. 18 / CCPA §1798.110)
 * Renvoie un JSON structuré contenant toutes les données du user courant.
 * Passe par le client authentifié → RLS s'assure qu'aucune ligne étrangère ne fuit.
 */
export const exportMyData = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const tables: Record<string, unknown[]> = {};
    for (const t of USER_TABLES) {
      const { data, error } = await context.supabase.from(t).select("*").eq("user_id", context.userId);
      if (error) {
        console.error("privacy export failed", { table: t, error });
        throw new Error("Impossible d'exporter vos données.");
      }
      tables[t] = (data ?? []) as unknown[];
    }
    return {
      generated_at: new Date().toISOString(),
      user_id: context.userId,
      email: (context.claims?.email as string | undefined) ?? null,
      schema_version: 1,
      json: JSON.stringify(tables),
    };
  });

/**
 * Droit à l'oubli (RGPD Art. 17 / LGPD Art. 18 / CCPA §1798.105)
 * Supprime le compte auth de l'utilisateur. Les FK ON DELETE CASCADE nettoient
 * toutes les tables métier. Effectue un balayage de sécurité juste avant, au
 * cas où de futures tables oublieraient la contrainte.
 */
export const deleteMyAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const userId = context.userId;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    for (const t of USER_TABLES) {
      const { error } = await supabaseAdmin.from(t).delete().eq("user_id", userId);
      if (error) console.error("account cleanup failed", { table: t, error });
    }

    const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);
    if (error) {
      console.error("account deletion failed", error);
      throw new Error("Impossible de supprimer le compte.");
    }
    return { ok: true };
  });
