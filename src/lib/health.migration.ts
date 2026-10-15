import { supabase } from "@/integrations/supabase/client";
import { encryptHealthPayload, HEALTH_E2EE_CURRENT_KEY_VERSION, getHealthDedupeRootKey } from "@/lib/health.crypto";
import { generateHealthDedupeHash } from "@/lib/health.dedupe";

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

const PAGE_SIZE = 500;
const CHUNK_SIZE = 100;

async function assertSameAuthenticatedUser(expectedUserId: string): Promise<void> {
  const { data, error } = await supabase.auth.getUser();
  if (error || data.user?.id !== expectedUserId) {
    throw new Error("Health migration stopped because the authenticated account changed");
  }
}

export async function migrateLegacyHealthSamplesToE2ee(): Promise<{ migrated: number; deleted: number }> {
  const { data: userResult, error: userError } = await supabase.auth.getUser();
  if (userError || !userResult.user) throw new Error("Authenticated user required");
  const userId = userResult.user.id;

  // Read every page before deleting anything. Deleting rows while using offset
  // pagination would shift later pages and could skip plaintext rows.
  const legacyRows: LegacyHealthSample[] = [];
  let offset = 0;
  while (true) {
    await assertSameAuthenticatedUser(userId);
    const { data: page, error: readError } = await supabase
      .from("health_samples")
      .select("id,ts,type,value,source,source_id,external_id,metadata,created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    if (readError) throw new Error("Unable to read legacy health data");
    await assertSameAuthenticatedUser(userId);

    const rows = (page ?? []) as LegacyHealthSample[];
    legacyRows.push(...rows);
    if (rows.length < PAGE_SIZE) break;
    offset += rows.length;
  }

  if (legacyRows.length === 0) return { migrated: 0, deleted: 0 };

  let migrated = 0;
  let deleted = 0;
  const dedupeRootKey = await getHealthDedupeRootKey();
  await assertSameAuthenticatedUser(userId);

  for (let offset = 0; offset < legacyRows.length; offset += CHUNK_SIZE) {
    await assertSameAuthenticatedUser(userId);
    const chunk = legacyRows.slice(offset, offset + CHUNK_SIZE);
    const records = [];

    for (const row of chunk) {
      const payload = {
        id: row.id,
        ts: row.ts,
        type: row.type,
        value: row.value,
        source: row.source,
        source_id: row.source_id,
        external_id: row.external_id,
        metadata: row.metadata,
        created_at: row.created_at,
      };
      const encrypted = await encryptHealthPayload(payload, HEALTH_E2EE_CURRENT_KEY_VERSION);
      const stableExternalId = row.external_id || row.source_id || row.id;
      const dedupeHash = await generateHealthDedupeHash({
        type: row.type,
        date: row.ts,
        source: row.source,
        external_id: stableExternalId,
      }, dedupeRootKey);
      records.push({
        legacy_id: row.id,
        ciphertext: encrypted.ciphertext,
        nonce: encrypted.nonce,
        key_version: encrypted.key_version,
        dedupe_hash: dedupeHash,
      });
    }

    await assertSameAuthenticatedUser(userId);
    const { data: mapped, error: migrationError } = await (supabase as any).rpc(
      "migrate_health_legacy_chunk_for_user",
      { p_expected_user_id: userId, p_records: records },
    );
    if (migrationError) throw new Error("Legacy health migration failed; plaintext was retained");
    migrated += Number(mapped ?? 0);

    // The server verifies account identity, consent, each source row, the
    // migration map, and the encrypted destination before deleting this chunk.
    await assertSameAuthenticatedUser(userId);
    const { data: deletedCount, error: deleteError } = await (supabase as any).rpc(
      "delete_migrated_health_legacy_chunk",
      { p_expected_user_id: userId, p_legacy_ids: chunk.map((row) => row.id) },
    );
    if (deleteError) throw new Error("Verified encrypted copy exists, but plaintext cleanup failed");
    deleted += Number(deletedCount ?? 0);
  }

  await assertSameAuthenticatedUser(userId);
  const { count: remainingCount, error: verifyError } = await supabase
    .from("health_samples")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);
  if (verifyError || (remainingCount ?? 0) > 0) {
    throw new Error("Health migration is incomplete; remaining plaintext was retained");
  }

  return { migrated, deleted };
}
