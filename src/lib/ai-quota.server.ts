type QuotaRow = {
  allowed: boolean;
  used: number;
  monthly_limit: number;
  plan: string | null;
  month_start: string;
};

/** Atomically consume one platform-cloud AI action. Fail closed on DB errors. */
export async function consumeCloudAiAction(client: any): Promise<QuotaRow> {
  const { data, error } = await client.rpc("consume_ai_cloud_action");
  if (error) {
    console.error("[ai-quota] quota RPC failed", error.message);
    throw new Error("AI_QUOTA_UNAVAILABLE");
  }

  const row = (Array.isArray(data) ? data[0] : data) as QuotaRow | null;
  if (
    !row ||
    typeof row.allowed !== "boolean" ||
    !Number.isInteger(row.used) ||
    !Number.isInteger(row.monthly_limit)
  ) {
    throw new Error("AI_QUOTA_INVALID_RESPONSE");
  }
  return row;
}
