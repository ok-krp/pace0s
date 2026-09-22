import { supabase } from "@/integrations/supabase/client";
import {
  encryptHealthPayload,
  HEALTH_E2EE_CURRENT_KEY_VERSION,
} from "@/lib/health.crypto";

type LegacyHealthSample = {
  id: string;
  ts: string;
  type: string;
  value: number;
  source: string;
  source_id: string | null;
  external_id: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

type EncryptedHealthRecord = {
  ciphertext: string;
  nonce: string;
  algorithm: "AES-256-GCM";
  key_version: number;
};

const CHUNK_SIZE = 100;

export async function migrateLegacyHealthSamplesToE2ee(): Promise<{
  migrated: number;
  deleted: number;
}> {
  const { data: userResult, error: userError } = await supabase.auth.getUser();
  if (userError || !userResult.user) throw new Error("Authenticated user required");

  const { data: legacyRows, error: readError } = await supabase
    .from("health_samples")
    .select("id,ts,type,value,source,source_id,external_id,metadata,created_at")
    .eq("user_id", userResult.user.id)
    .order("created_at", { ascending: true });

  if (readError) throw new Error("Unable to read legacy health data");

  const rows = (legacyRows ?? []) as LegacyHealthSample[];
  let migrated = 0;

  for (let offset = 0; offset < rows.length; offset += CHUNK_SIZE) {
    const chunk = rows.slice(offset, offset + CHUNK_SIZE);
    const encrypted: EncryptedHealthRecord[] = [];

    for (const row of chunk) {
      const result = await encryptHealthPayload(
        {
          id: row.id,
          ts: row.ts,
          type: row.type,
          value: row.value,
          source: row.source,
          source_id: row.source_id,
          external_id: row.external_id,
          metadata: row.metadata,
          created_at: row.created_at,
        },
        HEALTH_E2EE_CURRENT_KEY_VERSION,
      );

      encrypted.push(result);
    }

    const { error: insertError } = await (supabase as any)
      .from("health_samples_e2ee")
      .insert(encrypted.map((record) => ({
        user_id: userResult.user.id,
        ...record,
      })));

    if (insertError) {
      throw new Error("Legacy health migration aborted before deletion");
    }

    migrated += chunk.length;
  }

  if (migrated !== rows.length) {
    throw new Error("Legacy health migration verification failed");
  }

  if (rows.length > 0) {
    const { error: deleteError } = await supabase
      .from("health_samples")
      .delete()
      .eq("user_id", userResult.user.id);

    if (deleteError) {
      throw new Error("Encrypted copy created; legacy plaintext deletion failed");
    }
  }

  return { migrated, deleted: rows.length };
}

const BIOMETRIC_PROFILE_FIELDS = [
  "age",
  "sex",
  "height_cm",
  "weight_kg",
  "weight_goal_kg",
  "body_fat_goal_pct",
  "muscle_mass_goal_pct",
  "daily_calorie_goal",
  "daily_protein_goal",
  "daily_water_ml_goal",
  "training_goal",
  "activity_level",
  "training_sessions_goal",
] as const;

export async function migrateProfileBiometricsToE2ee(): Promise<boolean> {
  const { data: userResult, error: userError } = await supabase.auth.getUser();
  if (userError || !userResult.user) throw new Error("Authenticated user required");

  const { data: profile, error: readError } = await supabase
    .from("profiles")
    .select(BIOMETRIC_PROFILE_FIELDS.join(","))
    .eq("user_id", userResult.user.id)
    .maybeSingle();

  if (readError) throw new Error("Unable to read legacy profile biometrics");
  if (!profile) return false;

  const hasBiometrics = BIOMETRIC_PROFILE_FIELDS.some((field) => profile[field] !== null);
  if (!hasBiometrics) return false;

  const encrypted = await encryptHealthPayload({
    age: profile.age,
    sex: profile.sex,
    height_cm: profile.height_cm,
    weight_kg: profile.weight_kg,
    weight_goal_kg: profile.weight_goal_kg,
    body_fat_goal_pct: profile.body_fat_goal_pct,
    muscle_mass_goal_pct: profile.muscle_mass_goal_pct,
    daily_calorie_goal: profile.daily_calorie_goal,
    daily_protein_goal: profile.daily_protein_goal,
    daily_water_ml_goal: profile.daily_water_ml_goal,
    training_goal: profile.training_goal,
    activity_level: profile.activity_level,
    training_sessions_goal: profile.training_sessions_goal,
  }, HEALTH_E2EE_CURRENT_KEY_VERSION);

  const { error: upsertError } = await (supabase as any)
    .from("user_biometrics_e2ee")
    .upsert({
      user_id: userResult.user.id,
      ...encrypted,
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id" });

  if (upsertError) throw new Error("Unable to store encrypted profile biometrics");

  const cleared = Object.fromEntries(BIOMETRIC_PROFILE_FIELDS.map((field) => [field, null]));
  const { error: clearError } = await supabase
    .from("profiles")
    .update(cleared)
    .eq("user_id", userResult.user.id);

  if (clearError) {
    throw new Error("Encrypted biometrics stored; legacy profile fields were not cleared");
  }

  return true;
}
