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
const devicePublicKeySchema = z.object({ kty: z.literal("EC"), crv: z.literal("P-256"), x: z.string().min(1), y: z.string().min(1) });
const registerDeviceSchema = z.object({ device_name: z.string().trim().min(1).max(128), public_key: devicePublicKeySchema });
const envelopeSchema = z.object({
  device_id: z.string().uuid(),
  sender_device_id: z.string().uuid(),
  envelope: z.string().min(1).max(2_000_000),
  nonce: z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/).min(16).max(64),
  algorithm: z.literal("ECDH-P256/AES-256-GCM"),
  key_version: z.number().int().positive().max(100),
});

export const insertEncryptedHealthSamples = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => encryptedInsertSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { data: healthConsent } = await context.supabase.from("consent_records").select("granted").eq("consent_type", "health_data").order("created_at", { ascending: false }).limit(1).maybeSingle();
    const { data: cloudConsent } = await context.supabase.from("consent_records").select("granted").eq("consent_type", "health_cloud_sync").order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (healthConsent?.granted !== true || cloudConsent?.granted !== true) throw new Error("Le consentement santé et la synchronisation cloud doivent être activés.");

    const rows = data.records.map((record) => ({ ...record, user_id: context.userId }));
    const result = await (context.supabase as any).from("health_samples_e2ee").insert(rows);
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
    const result = await (context.supabase as any).from("health_samples_e2ee").select("id,ciphertext,nonce,algorithm,key_version,created_at").eq("user_id", context.userId).order("created_at", { ascending: false }).limit(data.limit);
    if (result.error) {
      console.error("encrypted health read failed", result.error);
      throw new Error("Impossible de charger les données de santé chiffrées.");
    }
    return { records: result.data ?? [] };
  });

export const registerHealthE2eeDevice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => registerDeviceSchema.parse(d))
  .handler(async ({ data, context }) => {
    const result = await (context.supabase as any).from("health_e2ee_devices").insert({
      user_id: context.userId, device_name: data.device_name, public_key: data.public_key, algorithm: "ECDH-P256",
    }).select("id,user_id,device_name,public_key,algorithm,created_at,revoked_at").single();
    if (result.error) {
      console.error("health E2EE device registration failed", result.error);
      throw new Error("Impossible d'enregistrer l'appareil E2EE.");
    }
    return result.data;
  });

export const listHealthE2eeDevices = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const result = await (context.supabase as any).from("health_e2ee_devices").select("id,user_id,device_name,public_key,algorithm,created_at,revoked_at").eq("user_id", context.userId).is("revoked_at", null).order("created_at", { ascending: false });
    if (result.error) {
      console.error("health E2EE device listing failed", result.error);
      throw new Error("Impossible de charger les appareils E2EE.");
    }
    return { devices: result.data ?? [] };
  });

export const createHealthE2eeEnvelope = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => envelopeSchema.parse(d))
  .handler(async ({ data, context }) => {
    const db = context.supabase as any;
    const { data: devices, error: devicesError } = await db.from("health_e2ee_devices").select("id").eq("user_id", context.userId).in("id", [data.device_id, data.sender_device_id]).is("revoked_at", null);
    if (devicesError || devices?.length !== 2) throw new Error("Les deux appareils E2EE doivent appartenir au même compte et être actifs.");

    const result = await db.from("health_e2ee_key_envelopes").insert({
      user_id: context.userId, device_id: data.device_id, sender_device_id: data.sender_device_id,
      envelope: data.envelope, nonce: data.nonce, algorithm: data.algorithm, key_version: data.key_version,
    }).select("id,user_id,device_id,sender_device_id,envelope,nonce,algorithm,key_version,created_at").single();
    if (result.error) {
      console.error("health E2EE envelope creation failed", result.error);
      throw new Error("Impossible d'enregistrer l'enveloppe E2EE.");
    }
    return result.data;
  });

export const listHealthE2eeEnvelopes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ device_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const result = await (context.supabase as any).from("health_e2ee_key_envelopes").select("id,user_id,device_id,sender_device_id,envelope,nonce,algorithm,key_version,created_at").eq("user_id", context.userId).eq("device_id", data.device_id).order("created_at", { ascending: false });
    if (result.error) {
      console.error("health E2EE envelope listing failed", result.error);
      throw new Error("Impossible de charger les enveloppes E2EE.");
    }
    return { envelopes: result.data ?? [] };
  });

export const insertHealthSamples = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => insertSchema.parse(d))
  .handler(async () => {
    throw new Error("Plaintext health ingestion is disabled. Use client-side E2EE.");
  });
