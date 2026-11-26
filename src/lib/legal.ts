export type LegalRegion = "EU" | "CA-US" | "BR" | "UK" | "CH" | "OTHER";

export type LegalConsentOptions = {
  health_data: boolean;
  health_cloud_sync: boolean;
  financial_data: boolean;
  ai_processing: boolean;
  analytics: boolean;
  notifications: boolean;
  sync_cloud: boolean;
  ai: boolean;
  marketing: boolean;
  do_not_sell?: boolean;
};

export const LEGAL_VERSIONS = {
  eula: "2026-07-10",
  privacy: "2026-07-10",
} as const;

export const GRANULAR_CONSENT_TYPES = [
  "health_data",
  "health_cloud_sync",
  "financial_data",
  "ai_processing",
  "marketing",
] as const;

export type GranularConsentRecord = {
  consent_type: string;
  granted: boolean;
  created_at: string;
  decision_sequence?: number;
};

/**
 * Resolve consent history ordered newest-first. Only the first record for each
 * category is authoritative; older grants must never overwrite a revocation.
 */
export function resolveGranularConsentOptions(
  records: readonly GranularConsentRecord[],
): LegalConsentOptions {
  const opts = { ...DEFAULT_LEGAL_OPTS };
  const resolved = new Set<string>();
  const orderedRecords = [...records].sort((a, b) => {
    const byTimestamp = Date.parse(b.created_at) - Date.parse(a.created_at);
    if (byTimestamp !== 0) return byTimestamp;
    return (b.decision_sequence ?? 0) - (a.decision_sequence ?? 0);
  });

  for (const record of orderedRecords) {
    if (!GRANULAR_CONSENT_TYPES.includes(record.consent_type as (typeof GRANULAR_CONSENT_TYPES)[number])) continue;
    if (resolved.has(record.consent_type)) continue;
    resolved.add(record.consent_type);
    opts[record.consent_type as keyof LegalConsentOptions] = record.granted;
  }

  return opts;
}

export const DEFAULT_LEGAL_OPTS: LegalConsentOptions = {
  health_data: false,
  health_cloud_sync: false,
  financial_data: false,
  ai_processing: false,
  analytics: false,
  notifications: false,
  sync_cloud: false,
  ai: false,
  marketing: false,
};

const STORAGE_KEY = "pace.legal.consent";

export function readLocalLegalConsent(): { opts: LegalConsentOptions } | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as { opts: LegalConsentOptions }) : null;
  } catch {
    return null;
  }
}

export function writeLocalLegalConsent(opts: LegalConsentOptions) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ opts, eula: LEGAL_VERSIONS.eula, privacy: LEGAL_VERSIONS.privacy }),
  );
  window.dispatchEvent(new Event("pace.legal.changed"));
}

export function isLegalCategoryAllowed(category: keyof LegalConsentOptions): boolean {
  return readLocalLegalConsent()?.opts?.[category] === true;
}

export function regionLabel(region: LegalRegion): string {
  if (region === "CA-US") return "Californie / CCPA";
  if (region === "BR") return "Brésil / LGPD";
  if (region === "UK") return "Royaume-Uni / UK GDPR";
  if (region === "CH") return "Suisse / nLPD";
  if (region === "EU") return "Union européenne / RGPD";
  return "Protection stricte par défaut";
}