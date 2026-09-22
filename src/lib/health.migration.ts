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

const CHUNK_SIZE = 100;

export async function migrateLegacyHealthSamplesToE2ee(): Promise<{
  migrated: number;
  deleted: number;
}> {
  const { data: userResult, error: userError } = await supabase.auth.getUser();
  if (userError || !userResult.user) throw new Error("Authenticated user required");

  const { data: rows, error: readError } = await supabase
    .from("health_samples")
    .select("id,ts,type,value,source,source_id,external_id,metadata,created_at")
    .eq("user_id", userResult.user.id)
    .order("created_at", { ascending: true });

  if (readError) throw new Error("Unable to read legacy health data");

  const legacyRows = (rows ?? []) as LegacyHealthSample[];
  const keyVersion = await getCurrentHealthKeyVersion();\n  let migrated = 0;

  for (let offset = 0; offset < legacyRows.length; offset += CHUNK_SIZE) {
    const chunk = legacyRows.slice(offset, offset + CHUNK_SIZE);
    const records = [];

    for (const row of chunk) {
      const encrypted = await encryptHealthPayload({
        id: row.id,
        ts: row.ts,
        type: row.type,
        value: row.value,
        source: row.source,
        source_id: row.source_id,
        external_id: row.external_id,
        metadata: row.metadata,
        created_at: row.created_at,
      }, keyVersion);

      records.push({
        legacy_id: row.id,
        ciphertext: encrypted.ciphertext,
        nonce: encrypted.nonce,
        key_version: encrypted.key_version,
      });
    }

    const { data: inserted, error: migrationError } = await supabase.rpc(
      "migrate_health_legacy_chunk",
      { p_records: records },
    );

    if (migrationError) {
      throw new Error("Legacy health migration aborted before plaintext deletion");
    }

    migrated += Number(inserted ?? 0);
  }

  const { count: encryptedCount, error: verifyError } = await supabase
    .from("health_samples_e2ee")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userResult.user.id);

  if (verifyError || (encryptedCount ?? 0) < legacyRows.length) {
    throw new Error("Encrypted migration is incomplete; plaintext was not deleted");
  }

  const { error: deleteError } = await supabase
    .from("health_samples")
    .delete()
    .eq("user_id", userResult.user.id);

  if (deleteError) {
    throw new Error("Encrypted copy exists, but legacy plaintext deletion failed");
  }

  return { migrated, deleted: legacyRows.length };
}
