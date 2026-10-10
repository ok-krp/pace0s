import { BlockList, isIP } from "node:net";
import { lookup } from "node:dns/promises";

/** Guardes SSRF pour les URL d'API IA personnalisées (BYOK). */
const blockedV4 = new BlockList();
const blockedV6 = new BlockList();
const V4: Array<[string, number]> = [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16],
  ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.168.0.0", 16],
  ["192.88.99.0", 24], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
];
const V6: Array<[string, number]> = [
  ["::", 128], ["::1", 128], ["64:ff9b::", 96], ["100::", 64],
  ["2001::", 23], ["2001:db8::", 32], ["2002::", 16], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8],
];
for (const [address, prefix] of V4) blockedV4.addSubnet(address, prefix, "ipv4");
for (const [address, prefix] of V6) blockedV6.addSubnet(address, prefix, "ipv6");

const BLOCKED_SUFFIXES = [".localhost", ".local", ".internal", ".lan", ".home", ".corp", ".intranet", ".localdomain"];
const ALLOWED_PORTS = new Set(["", "443", "8443"]);

/** Converts an IPv4-mapped IPv6 literal to dotted IPv4 without relying on DNS. */
function mappedIpv4(ip: string): string | null {
  const value = ip.toLowerCase().replace(/^\[|\]$/g, "");
  if (isIP(value) !== 6) return null;

  let normalized = value;
  if (normalized.includes(".")) {
    const split = normalized.lastIndexOf(":");
    const octets = normalized.slice(split + 1).split(".").map(Number);
    if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return null;
    const high = ((octets[0] << 8) | octets[1]).toString(16);
    const low = ((octets[2] << 8) | octets[3]).toString(16);
    normalized = `${normalized.slice(0, split + 1)}${high}:${low}`;
  }

  const halves = normalized.split("::");
  if (halves.length > 2) return null;
  const parse = (part: string) => part ? part.split(":").map((group) => Number.parseInt(group, 16)) : [];
  const left = parse(halves[0]);
  const right = halves.length === 2 ? parse(halves[1]) : [];
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) return null;
  const groups = [...left, ...Array(missing).fill(0), ...right];
  if (groups.length !== 8 || groups.some((group) => !Number.isInteger(group) || group < 0 || group > 0xffff)) return null;
  if (groups.slice(0, 5).some((group) => group !== 0) || groups[5] !== 0xffff) return null;

  const high = groups[6];
  const low = groups[7];
  return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
}

export function isBlockedIp(ip: string): boolean {
  const version = isIP(ip);
  if (!version) return true;
  if (version === 4) return blockedV4.check(ip, "ipv4");
  const mapped = mappedIpv4(ip);
  if (mapped) return blockedV4.check(mapped, "ipv4");
  return blockedV6.check(ip, "ipv6");
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
