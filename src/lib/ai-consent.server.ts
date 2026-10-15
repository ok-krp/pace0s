import { LEGAL_VERSIONS } from "./legal";

/**
 * Resolve AI processing consent fail-closed. An explicit granular decision
 * (including revocation) always wins over legacy EULA consent. Legacy fallback
 * is used only when no granular decision exists and the current legal versions
 * were accepted.
 */
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
  if (typeof opts?.ai_processing === "boolean") return opts.ai_processing;
  return opts?.ai === true;
}
