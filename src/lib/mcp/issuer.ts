export function resolveSupabaseAuthIssuer(
  supabaseUrl?: string | null,
  projectRef?: string | null,
): string {
  const configuredUrl = supabaseUrl?.trim();
  if (configuredUrl) {
    const parsed = new URL(configuredUrl);
    if (
      parsed.protocol !== "https:" &&
      !(parsed.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname))
    ) {
      throw new Error("Supabase URL must use HTTPS outside local development.");
    }
    return `${parsed.origin}/auth/v1`;
  }

  const configuredProjectRef = projectRef?.trim();
  if (!configuredProjectRef) {
    return "https://project-ref-unset.supabase.co/auth/v1";
  }
  return `https://${configuredProjectRef}.supabase.co/auth/v1`;
}
