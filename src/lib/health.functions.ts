import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { TablesInsert } from "@/integrations/supabase/types";

const SampleType = z.enum(["steps", "kcal_active", "kcal_total", "heart_rate", "resting_heart_rate", "distance_m", "sleep_min", "exercise_duration_min", "weight_kg", "oxygen_saturation", "temperature_c", "cadence_rpm", "power_w"]);
const insertSchema = z.object({ samples: z.array(z.object({ ts: z.string(), type: SampleType, value: z.number().finite(), source: z.string().max(128).default("manual"), source_id: z.string().max(128).optional(), external_id: z.string().max(256).optional(), metadata: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).optional() })).min(1).max(5000) });
const encryptedInsertSchema = z.object({
  records: z.array(z.object({
    ciphertext: z.string().min(1).max(2_000_000),
    nonce: z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/).min(16).max(64),
    algorithm: z.literal("AES-256-GCM"),
    key_version: z.number().int().positive().max(100),
  })).min(1).max(5000),
});

export const insertEncryptedHealthSamples = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => encryptedInsertSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { data: healthConsent } = await context.supabase
      .from("consent_records")
      .select("granted")
      .eq("consent_type", "health_data")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const { data: cloudConsent } = await context.supabase
      .from("consent_records")
      .select("granted")
      .eq("consent_type", "health_cloud_sync")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (healthConsent?.granted !== true || cloudConsent?.granted !== true) {
      throw new Error("Le consentement santé et la synchronisation cloud doivent être activés.");
    }

    const rows: TablesInsert<"health_samples_e2ee">[] = data.records.map((record) => ({
      ...record,
      user_id: context.userId,
    }));
    const result = await context.supabase.from("health_samples_e2ee").insert(rows);
    if (result.error) {
      console.error("encrypted health insert failed", result.error);
      throw new Error("Impossible d'enregistrer les données de santé chiffrées.");
    }
    return { inserted: rows.length };
  });

export const listEncryptedHealthSamples = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ limit: z.number().int().min(1).max(10000).default(10000) }).parse(d ?? {}))
  .handler(async ({ data, context }) => {
    const result = await context.supabase
      .from("health_samples_e2ee")
      .select("id,ciphertext,nonce,algorithm,key_version,created_at")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(data.limit);
    if (result.error) {
      console.error("encrypted health read failed", result.error);
      throw new Error("Impossible de charger les données de santé chiffrées.");
    }
    return { records: result.data ?? [] };
  });

export const insertHealthSamples = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => insertSchema.parse(d))
  .handler(async () => {
    throw new Error("Plaintext health ingestion is disabled. Use client-side E2EE.");
  });
