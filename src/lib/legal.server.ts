import { getRequest } from "@tanstack/react-start/server";
import type { LegalRegion } from "./legal";

const EU_COUNTRIES = new Set([
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE",
]);

export function getRequestCountry(): string | null {
  const request = getRequest();
  return request?.headers.get("cf-ipcountry")?.toUpperCase() ?? null;
}

export function legalRegionForCountry(country: string | null): LegalRegion {
  if (!country) return "OTHER";
  if (EU_COUNTRIES.has(country)) return "EU";
  if (country === "US") return "CA-US";
  if (country === "BR") return "BR";
  if (country === "GB") return "UK";
  if (country === "CH") return "CH";
  return "OTHER";
}