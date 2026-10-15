import { LEGAL_VERSIONS } from "./legal";

/** Explicit granular revocations override legacy consent; lookup failures fail closed. */
export async function hasAiProcessingConsent(client: any, userId: string): Promise<boolean> {
  const { data: granular, error: granularError } = await client
    .from("consent_records")
    .select("granted")
    .eq("user_id", userId)
    .eq("consent_type", "ai_processing")
    .order("created_at", { ascending: false })
    .order("decision_sequence", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (granularError) {
    console.error("AI granular consent lookup failed", granularError.message);
    throw new Error("AI_CONSENT_LOOKUP_FAILED");
  }
  if (granular) return granular.granted === true;

  const { data: legacy, error: legacyError } = await client
    .from("legal_consent")
    .select("opts")
    .eq("user_id", userId)
    .eq("eula_version", LEGAL_VERSIONS.eula)
    .eq("privacy_version", LEGAL_VERSIONS.privacy)
    .maybeSingle();

  if (legacyError) {
    console.error("AI legacy consent lookup failed", legacyError.message);
    throw new Error("AI_CONSENT_LOOKUP_FAILED");
  }
  const opts = legacy?.opts as { ai_processing?: unknown; ai?: unknown } | null;
  return opts?.ai_processing === true || opts?.ai === true;
}
