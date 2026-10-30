type DatabaseError = {
  code?: string | null;
};

export function mcpDatabaseFailure(operation: string, error: DatabaseError) {
  // Supabase/PostgREST messages may contain internal table, policy, or SQL
  // details. Log only a stable operation label and the machine-readable code.
  console.error("[pace-mcp] database operation failed", {
    operation,
    code: error.code ?? "unknown",
  });
  return {
    content: [{ type: "text" as const, text: "Database operation failed. Please retry." }],
    isError: true as const,
  };
}
