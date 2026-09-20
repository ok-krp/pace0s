import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { DEFAULT_LEGAL_OPTS, LEGAL_VERSIONS, type LegalConsentOptions } from "./legal";

const consentSchema = z.object({
  opts: z.object({
    health_data: z.boolean(),
    health_cloud_sync: z.boolean(),
    financial_data: z.boolean(),
    ai_processing: z.boolean(),
    analytics: z.boolean(),
    notifications: z.boolean(),
    sync_cloud: z.boolean(),
    ai: z.boolean(),
    marketing: z.boolean(),
    do_not_sell: z.boolean().optional(),
  }),
});

const GRANULAR_TYPES = [
  "health_data",
  "health_cloud_sync",
  "financial_data",
  "ai_processing",
  "marketing",
] as const;

export const getGeoLegalContext = createServerFn({ method: "GET" }).handler(async () => {
  const { getRequestCountry, legalRegionForCountry } = await import("./legal.server");
  const country = getRequestCountry();
  return { country, region: legalRegionForCountry(country) };
});

export const getLegalConsentStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { getRequestCountry, legalRegionForCountry } = await import("./legal.server");
    const country = getRequestCountry();
    const region = legalRegionForCountry(country);

    const [{ data: legal, error: legalError }, { data: records, error: recordsError }] = await Promise.all([
      context.supabase
        .from("legal_consent")
        .select("region,eula_version,privacy_version,opts,consented_at,ip_country")
        .eq("eula_version", LEGAL_VERSIONS.eula)
        .eq("privacy_version", LEGAL_VERSIONS.privacy)
        .maybeSingle(),
      context.supabase
        .from("consent_records")
        .select("consent_type,granted,created_at")
        .order("created_at", { ascending: false }),
    ]);

    if (legalError || recordsError) {
      console.error("legal consent lookup failed", { legalError, recordsError });
      throw new Error("Impossible de charger les préférences de confidentialité.");
    }

    const opts = { ...DEFAULT_LEGAL_OPTS };
    for (const record of records ?? []) {
      if (!GRANULAR_TYPES.includes(record.consent_type as (typeof GRANULAR_TYPES)[number])) continue;
      const key = record.consent_type as keyof LegalConsentOptions;
      if (opts[key] === false) opts[key] = record.granted;
    }

    const legacy = (legal?.opts as Partial<LegalConsentOptions> | null) ?? {};
    for (const key of ["analytics", "notifications", "sync_cloud", "ai", "marketing"] as const) {
      if (typeof legacy[key] === "boolean") opts[key] = legacy[key];
    }

    return {
      required: !legal,
      region: legal?.region ?? region,
      ipCountry: legal?.ip_country ?? country,
      opts,
      consentedAt: legal?.consented_at ?? null,
    };
  });

export const saveLegalConsent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => consentSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { getRequestCountry, legalRegionForCountry } = await import("./legal.server");
    const country = getRequestCountry();
    const region = legalRegionForCountry(country);
    const now = new Date().toISOString();

    const { error: legalError } = await context.supabase.from("legal_consent").upsert(
      {
        user_id: context.userId,
        region,
        eula_version: LEGAL_VERSIONS.eula,
        privacy_version: LEGAL_VERSIONS.privacy,
        ip_country: country,
        consented_at: now,
        opts: data.opts,
      },
      { onConflict: "user_id,eula_version,privacy_version" },
    );

    if (legalError) {
      console.error("legal consent save failed", legalError);
      throw new Error("Impossible d'enregistrer les préférences de confidentialité.");
    }

    const records = GRANULAR_TYPES.map((consentType) => ({
      user_id: context.userId,
      consent_type: consentType,
      granted: data.opts[consentType],
      legal_version: LEGAL_VERSIONS.eula,
      policy_version: LEGAL_VERSIONS.privacy,
      created_at: now,
    }));

    const { error: recordsError } = await context.supabase.from("consent_records").insert(records);
    if (recordsError) {
      console.error("granular consent save failed", recordsError);
      throw new Error("Impossible d'enregistrer les consentements détaillés.");
    }

    return { ok: true, region, ipCountry: country, opts: data.opts };
  });
