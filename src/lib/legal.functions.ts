import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { DEFAULT_LEGAL_OPTS, LEGAL_VERSIONS, type LegalConsentOptions } from "./legal";
import { getRequestCountry, legalRegionForCountry } from "./legal.server";

const consentSchema = z.object({
  opts: z.object({
    analytics: z.boolean(),
    notifications: z.boolean(),
    sync_cloud: z.boolean(),
    ai: z.boolean(),
    do_not_sell: z.boolean().optional(),
  }),
});

export const getGeoLegalContext = createServerFn({ method: "GET" }).handler(async () => {
  const country = getRequestCountry();
  return { country, region: legalRegionForCountry(country) };
});

export const getLegalConsentStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("legal_consent")
      .select("region,eula_version,privacy_version,opts,consented_at,ip_country")
      .eq("eula_version", LEGAL_VERSIONS.eula)
      .eq("privacy_version", LEGAL_VERSIONS.privacy)
      .maybeSingle();
    if (error) throw new Error(error.message);
    const geo = { country: getRequestCountry(), region: legalRegionForCountry(getRequestCountry()) };
    return {
      required: !data,
      region: (data?.region ?? geo.region) as ReturnType<typeof legalRegionForCountry>,
      ipCountry: data?.ip_country ?? geo.country,
      opts: (data?.opts as LegalConsentOptions | null) ?? DEFAULT_LEGAL_OPTS,
      consentedAt: data?.consented_at ?? null,
    };
  });

export const saveLegalConsent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => consentSchema.parse(data))
  .handler(async ({ data, context }) => {
    const country = getRequestCountry();
    const region = legalRegionForCountry(country);
    const { error } = await context.supabase.from("legal_consent").upsert(
      {
        user_id: context.userId,
        region,
        eula_version: LEGAL_VERSIONS.eula,
        privacy_version: LEGAL_VERSIONS.privacy,
        ip_country: country,
        consented_at: new Date().toISOString(),
        opts: data.opts,
      },
      { onConflict: "user_id,eula_version,privacy_version" },
    );
    if (error) throw new Error(error.message);
    return { ok: true, region, ipCountry: country, opts: data.opts };
  });