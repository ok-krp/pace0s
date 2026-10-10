/** Retourne uniquement un chemin interne sûr, sinon le chemin de repli. */
export function safeInternalPath(next: unknown, fallback = "/"): string {
  if (typeof next !== "string") return fallback;
  const value = next.trim();
  if (!value || value.length > 2048 || !value.startsWith("/") || value.startsWith("//")) return fallback;
  // eslint-disable-next-line no-control-regex
  if (/[\\\u0000-\u001f\u007f]/.test(value)) return fallback;
  try {
    const parsed = new URL(value, "https://pace.invalid");
    const normalizedPath = decodeURIComponent(parsed.pathname).replace(/\\/g, "/").replace(/\/+/, "/").replace(/\/+$/, "").toLowerCase();
    if (parsed.origin !== "https://pace.invalid" || normalizedPath === "/login") return fallback;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }
}

export function safeExternalUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}
