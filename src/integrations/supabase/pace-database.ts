import type { Database } from "./types";

type ProfilesTable = Database["public"]["Tables"]["profiles"];
type UserStateTable = Database["public"]["Tables"]["user_state"];

/**
 * Temporary typed extension for schema additions that may not yet be present
 * in the checked-in generated Supabase types. The database schema remains the
 * source of truth; regenerate types from Supabase when the migration is live.
 */
export type PaceDatabase = Database & {
  public: {
    Tables: Database["public"]["Tables"] & {
      profiles: {
        Row: ProfilesTable["Row"] & {
          training_sessions_goal: number;
        };
        Insert: ProfilesTable["Insert"] & {
          training_sessions_goal?: number;
        };
        Update: ProfilesTable["Update"] & {
          training_sessions_goal?: number;
        };
        Relationships: ProfilesTable["Relationships"];
      };
      user_state: {
        Row: UserStateTable["Row"] & {
          updated_by: string | null;
        };
        Insert: UserStateTable["Insert"] & {
          updated_by?: string | null;
        };
        Update: UserStateTable["Update"] & {
          updated_by?: string | null;
        };
        Relationships: UserStateTable["Relationships"];
      };
    };
  };
};
