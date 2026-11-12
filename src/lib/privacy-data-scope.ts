/**
 * User-owned tables included in the authenticated data export.
 * Server-only secrets, audit internals, idempotency records and ephemeral
 * pairing sessions are intentionally excluded from the client-facing export.
 */
export const USER_EXPORT_TABLES = [
  "profiles",
  "food_log",
  "food_scans",
  "health_samples",
  "health_samples_e2ee",
  "health_e2ee_devices",
  "health_e2ee_key_envelopes",
  "health_e2ee_key_versions",
  "health_e2ee_recovery_envelopes",
  "user_biometrics_e2ee",
  "legal_consent",
  "consent_records",
  "data_deletion_requests",
  "notification_log",
  "reminder_settings",
  "reminder_debug_log",
  "push_subscriptions",
  "user_state",
  "ai_action_log",
  "ai_conversations",
  "ai_messages",
  "ai_preferences",
  "development_tasks",
  "billing_customers",
  "billing_subscriptions",
  "billing_trials",
  "sport_exercises",
  "sport_programs",
  "sport_progression_targets",
  "sport_workout_sessions",
  "workspace_members",
  "nutrition_calibration_feedback",
] as const;

/**
 * Tables that need explicit deletion before auth.users is deleted.
 * Several legacy user-owned tables have no FK to auth.users; relying only on
 * ON DELETE CASCADE would leave AI conversations, AI preferences and tasks.
 */
export const USER_DELETE_TABLES = [
  "ai_action_log",
  "ai_messages",
  "development_tasks",
  "ai_conversations",
  "ai_preferences",
  "ai_provider_secrets",
  "profiles",
  "food_log",
  "food_scans",
  "health_samples",
  "legal_consent",
  "notification_log",
  "reminder_settings",
  "reminder_debug_log",
  "user_state",
  "workspace_members",
  "nutrition_calibration_feedback",
] as const;

/**
 * Tables with composite or non-id primary keys. All other export tables use id.
 */
export const USER_EXPORT_ORDER_COLUMNS: Partial<
  Record<(typeof USER_EXPORT_TABLES)[number], readonly string[]>
> = {
  ai_preferences: ["user_id"],
  billing_customers: ["user_id"],
  billing_subscriptions: ["user_id"],
  billing_trials: ["user_id"],
  health_e2ee_key_versions: ["user_id"],
  health_e2ee_recovery_envelopes: ["user_id"],
  workspace_members: ["workspace_id", "user_id"],
};

/**
 * Child rows have no user_id column. They are exported only through IDs
 * already selected from the current user's own programs/sessions/exercises.
 */
export const USER_EXPORT_RELATIONS = {
  sport_program_items: { parent: "sport_programs", foreignKey: "program_id" },
  sport_workout_exercises: { parent: "sport_workout_sessions", foreignKey: "session_id" },
  sport_workout_sets: { parent: "sport_workout_exercises", foreignKey: "workout_exercise_id" },
} as const;

/**
 * Shared workspace rows may belong to or be used by other members. They must
 * be transferred or deliberately removed before deleting the creator/owner.
 * These relations are absent from the older pre-workspace schema.
 */
export const ACCOUNT_DELETE_SHARED_RESOURCE_GUARDS = [
  { table: "workspaces", column: "owner_user_id", label: "espaces de travail dont vous êtes propriétaire" },
  { table: "grocery_lists", column: "created_by", label: "listes de courses partagées que vous avez créées" },
  { table: "grocery_list_items", column: "created_by", label: "éléments de listes de courses partagées que vous avez créés" },
  { table: "pantry_items", column: "created_by", label: "éléments de garde-manger partagés que vous avez créés" },
] as const;

export const OPTIONAL_USER_SCHEMA_TABLES = new Set<string>([
  "workspace_members",
  "nutrition_calibration_feedback",
]);

export function isMissingOptionalSchemaRelation(code: string | undefined): boolean {
  return code === "PGRST205" || code === "42P01";
}
