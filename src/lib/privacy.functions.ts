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
 * Passe par le client authentifié → RLS s'assure qu'aucune ligne étrangère ne peut fuir.
 */
export const exportMyData = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const tables: Record<string, unknown[]> = {};
    for (const t of USER_TABLES) {
      const { data, error } = await context.supabase.from(t).select("*").eq("user_id", context.userId);
      if (error) throw new Error(`${t}: ${error.message}`);
      tables[t] = (data ?? []) as unknown[];
    }
    // Return a JSON string so nested Supabase row shapes don't fight the RPC serializer.
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

    // Safety net — best-effort scrub before dropping the auth row (cascade covers it too).
    for (const t of USER_TABLES) {
      await supabaseAdmin.from(t).delete().eq("user_id", userId);
    }

    const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
