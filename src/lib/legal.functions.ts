import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { GRANULAR_CONSENT_TYPES, LEGAL_VERSIONS, resolveGranularConsentOptions, type LegalConsentOptions } from "./legal";

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
        .eq("user_id", context.userId)
        .eq("eula_version", LEGAL_VERSIONS.eula)
        .eq("privacy_version", LEGAL_VERSIONS.privacy)
        .maybeSingle(),
      context.supabase
        .from("consent_records")
        .select("id,consent_type,granted,created_at,decision_sequence")
        .eq("user_id", context.userId)
        .order("created_at", { ascending: false })
        .order("decision_sequence" as any, { ascending: false }),
    ]);

    if (legalError || recordsError) {
      console.error("legal consent lookup failed", { legalError, recordsError });
      throw new Error("Impossible de charger les préférences de confidentialité.");
    }

    // Records are ordered newest-first. Resolve each category exactly once so
    // an older grant cannot overwrite a newer revocation.
    const opts = resolveGranularConsentOptions((records ?? []) as Array<{
      consent_type: string;
      granted: boolean;
      created_at: string;
      decision_sequence: number;
    }>) as LegalConsentOptions;

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
    const { data: saved, error: saveError } = await (context.supabase as any).rpc(
      "save_legal_consent_atomic",
      {
        p_user_id: context.userId,
        p_region: region,
        p_eula_version: LEGAL_VERSIONS.eula,
        p_privacy_version: LEGAL_VERSIONS.privacy,
        p_ip_country: country,
        p_opts: data.opts,
      },
    );

    if (saveError || saved !== true) {
      console.error("atomic legal consent save failed", saveError?.message ?? "invalid RPC result");
      throw new Error("Impossible d'enregistrer les préférences de confidentialité.");
    }

    return { ok: true, region, ipCountry: country, opts: data.opts };
  });
