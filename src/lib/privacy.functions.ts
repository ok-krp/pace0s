import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

import { USER_DELETE_TABLES, USER_EXPORT_TABLES } from "./privacy-data-scope";

/**
 * Portabilité (RGPD Art. 20 / LGPD Art. 18 / CCPA §1798.110)
 * Renvoie un JSON structuré contenant toutes les données du user courant.
 * Passe par le client authentifié → RLS s'assure qu'aucune ligne étrangère ne peut fuir.
 */
export const exportMyData = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const tables: Record<string, unknown[]> = {};
    for (const t of USER_EXPORT_TABLES) {
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

    // Legacy AI tables do not all have a foreign key to auth.users. Delete
    // their user-owned rows explicitly, and stop before Auth deletion if any
    // table purge fails so the caller can safely retry.
    for (const t of USER_DELETE_TABLES) {
      const { error: deleteError } = await supabaseAdmin.from(t).delete().eq("user_id", userId);
      if (deleteError) throw new Error(`Unable to erase ${t}: ${deleteError.message}`);
    }

    const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
