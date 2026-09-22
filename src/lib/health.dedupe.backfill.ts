import { supabase } from "@/integrations/supabase/client";
import {
  decryptHealthPayload,
  getHealthDedupeRootKey,
} from "@/lib/health.crypto";
import { generateHealthDedupeHash } from "@/lib/health.dedupe";

type BackfillPayload = {
  id: string;
  ciphertext: string;
  nonce: string;
  key_version: number;
  dedupe_hash: string | null;
};

type DecryptedHealthSample = {
  ts?: string;
  timestamp?: string;
  type?: string;
  source?: string | null;
  external_id?: string | null;
  source_id?: string | null;
  id?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export async function backfillHealthE2eeDedupeHashes(): Promise<{
  updated: number;
  skipped: number;
}> {
  const { data: userResult, error: userError } = await supabase.auth.getUser();
  if (userError || !userResult.user) {
    throw new Error("Authenticated user required");
  }

  const { data: rows, error } = await supabase
    .from("health_samples_e2ee")
    .select("id,ciphertext,nonce,key_version,dedupe_hash")
    .eq("user_id", userResult.user.id)
    .is("dedupe_hash", null)
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error("Unable to read E2EE health records for dedupe backfill");
  }

  const records = (rows ?? []) as BackfillPayload[];
  const updates: Array<{ id: string; dedupe_hash: string }> = [];
  let skipped = 0;

  for (const record of records) {
    try {
      const payload = await decryptHealthPayload(
        record.ciphertext,
        record.nonce,
        record.key_version,
      );

      if (!isRecord(payload)) {
        skipped += 1;
        continue;
      }

      const type = typeof payload.type === "string" ? payload.type : "";
      const source = typeof payload.source === "string" ? payload.source : "";
      const date =
        typeof payload.ts === "string"
          ? payload.ts
          : typeof payload.timestamp === "string"
            ? payload.timestamp
            : "";

      const stableExternalId =
        typeof payload.external_id === "string" && payload.external_id.length > 0
          ? payload.external_id
          : typeof payload.source_id === "string" && payload.source_id.length > 0
            ? payload.source_id
            : typeof payload.id === "string" && payload.id.length > 0
              ? payload.id
              : "";

      if (!type || !source || !date || !stableExternalId) {
        skipped += 1;
        continue;
      }

      const dedupeHash = await generateHealthDedupeHash(
        {
          type,
          date,
          source,
          external_id: stableExternalId,
        },
        await getHealthDedupeRootKey(),
      );

      updates.push({ id: record.id, dedupe_hash: dedupeHash });
    } catch {
      skipped += 1;
    }
  }

  let updated = 0;

  for (let offset = 0; offset < updates.length; offset += 500) {
    const chunk = updates.slice(offset, offset + 500);
    const { data, error: rpcError } = await supabase.rpc(
      "backfill_health_e2ee_dedupe_hashes",
      { p_updates: chunk },
    );

    if (rpcError) {
      throw new Error("Health E2EE dedupe backfill failed");
    }

    updated += Number(data ?? 0);
  }

  return { updated, skipped };
}
