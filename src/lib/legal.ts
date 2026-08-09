export type LegalRegion = "EU" | "CA-US" | "BR" | "UK" | "CH" | "OTHER";

export type LegalConsentOptions = {
  analytics: boolean;
  notifications: boolean;
  sync_cloud: boolean;
  ai: boolean;
  do_not_sell?: boolean;
};

export const LEGAL_VERSIONS = {
  eula: "2026-07-10",
  privacy: "2026-07-10",
} as const;

export const DEFAULT_LEGAL_OPTS: LegalConsentOptions = {
  analytics: false,
  notifications: false,
  sync_cloud: false,
  ai: false,
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