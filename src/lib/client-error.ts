const INTERNAL_ERROR_PATTERNS = [
  "postgres",
  "postgrest",
  "supabase",
  "sqlstate",
  "column ",
  "relation ",
  "constraint ",
  "violates ",
  "duplicate key",
  "foreign key",
  "permission denied",
  "jwt",
  "database",
];

export function getSafeClientErrorMessage(error: unknown, fallback = "Une erreur inattendue est survenue.") {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const normalized = message.toLowerCase();
  if (!message || INTERNAL_ERROR_PATTERNS.some((pattern) => normalized.includes(pattern))) return fallback;
  return message.length > 240 ? fallback : message;
}
