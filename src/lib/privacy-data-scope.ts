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
] as const;
