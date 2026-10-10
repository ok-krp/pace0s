import { BlockList, isIP } from "node:net";
import { lookup } from "node:dns/promises";

/** Guardes SSRF pour les URL d'API IA personnalisées (BYOK). */
const blocked = new BlockList();
const V4: Array<[string, number]> = [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16],
  ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.168.0.0", 16],
  ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
];
const V6: Array<[string, number]> = [
  ["::", 128], ["::1", 128], ["::ffff:0:0", 96], ["64:ff9b::", 96], ["100::", 64],
  ["fc00::", 7], ["fe80::", 10], ["ff00::", 8], ["2001:db8::", 32],
];
for (const [address, prefix] of V4) blocked.addSubnet(address, prefix, "ipv4");
for (const [address, prefix] of V6) blocked.addSubnet(address, prefix, "ipv6");

const BLOCKED_SUFFIXES = [".localhost", ".local", ".internal", ".lan", ".home", ".corp", ".intranet", ".localdomain"];
const ALLOWED_PORTS = new Set(["", "443", "8443"]);

export function isBlockedIp(ip: string): boolean {
  const version = isIP(ip);
  if (!version) return true;
  return blocked.check(ip, version === 4 ? "ipv4" : "ipv6");
}

export function assertSafeApiUrl(url: URL): void {
  if (url.protocol !== "https:") throw new Error("URL API invalide : HTTPS est obligatoire.");
  if (url.username || url.password) throw new Error("Les identifiants dans l’URL API sont interdits.");
  if (!ALLOWED_PORTS.has(url.port)) throw new Error("Port API personnalisé non autorisé.");
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (!host || host === "localhost" || BLOCKED_SUFFIXES.some((suffix) => host.endsWith(suffix)) || (!host.includes(".") && !isIP(host))) {
    throw new Error("URL API personnalisée non autorisée : hôte local ou interne.");
  }
  if (isIP(host) && isBlockedIp(host)) throw new Error("URL API personnalisée non autorisée : adresse réseau privée.");
}

/** Refuse les noms DNS qui résolvent vers des IP privées ou réservées. */
export async function assertPublicHost(hostname: string): Promise<void> {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (isIP(host)) {
    if (isBlockedIp(host)) throw new Error("Adresse réseau privée refusée.");
    return;
  }
  const records = await lookup(host, { all: true });
  if (!records.length || records.some((record) => isBlockedIp(record.address))) {
    throw new Error("L'hôte résout vers une adresse réseau privée : refusé.");
  }
}

/**
 * Fetch réservé aux hôtes publics. Les redirections automatiques sont désactivées
 * pour éviter qu'un serveur public ne redirige la requête vers une adresse interne.
 * La résolution DNS puis fetch restent deux opérations distinctes : ce contrôle
 * réduit le risque SSRF mais ne constitue pas un pinning DNS anti-rebinding parfait.
 */
export const publicOnlyFetch: typeof fetch = async (input, init) => {
  const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const url = new URL(raw);
  assertSafeApiUrl(url);
  await assertPublicHost(url.hostname);
  return fetch(input, { ...init, redirect: "manual", signal: init?.signal ?? AbortSignal.timeout(15_000) });
};
