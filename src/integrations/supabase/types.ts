export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  __InternalSupabase: { PostgrestVersion: "14.5" }
  public: {
    Tables: {
      ai_action_log: {
        Row: { action_type: string; agent_type: string; conversation_id: string | null; created_at: string; error_message: string | null; executed_at: string | null; id: string; label: string; payload: Json; status: string; user_id: string }
        Insert: { action_type: string; agent_type: string; conversation_id?: string | null; created_at?: string; error_message?: string | null; executed_at?: string | null; id?: string; label: string; payload?: Json; status?: string; user_id: string }
        Update: { action_type?: string; agent_type?: string; conversation_id?: string | null; created_at?: string; error_message?: string | null; executed_at?: string | null; id?: string; label?: string; payload?: Json; status?: string; user_id?: string }
        Relationships: [{ foreignKeyName: "ai_action_log_conversation_id_fkey"; columns: ["conversation_id"]; isOneToOne: false; referencedRelation: "ai_conversations"; referencedColumns: ["id"] }]
      }
      ai_conversations: {
        Row: { agent_type: string; created_at: string; id: string; is_archived: boolean; is_ephemeral: boolean; is_starred: boolean; memory_summary: string | null; summarized_count: number; summary: string | null; title: string; updated_at: string; user_id: string }
        Insert: { agent_type: string; created_at?: string; id?: string; is_archived?: boolean; is_ephemeral?: boolean; is_starred?: boolean; memory_summary?: string | null; summarized_count?: number; summary?: string | null; title?: string; updated_at?: string; user_id: string }
        Update: { agent_type?: string; created_at?: string; id?: string; is_archived?: boolean; is_ephemeral?: boolean; is_starred?: boolean; memory_summary?: string | null; summarized_count?: number; summary?: string | null; title?: string; updated_at?: string; user_id?: string }
        Relationships: []
      }
      ai_messages: {
        Row: { conversation_id: string; created_at: string; id: string; model_message_id: string | null; parts: Json; plain_text: string; role: string; user_id: string }
        Insert: { conversation_id: string; created_at?: string; id?: string; model_message_id?: string | null; parts?: Json; plain_text?: string; role: string; user_id: string }
        Update: { conversation_id?: string; created_at?: string; id?: string; model_message_id?: string | null; parts?: Json; plain_text?: string; role?: string; user_id?: string }
        Relationships: [{ foreignKeyName: "ai_messages_conversation_id_fkey"; columns: ["conversation_id"]; isOneToOne: false; referencedRelation: "ai_conversations"; referencedColumns: ["id"] }]
      }
      ai_preferences: {
        Row: { confirm_actions: boolean; created_at: string; memory_level: string; permissions: Json; updated_at: string; user_id: string; coach_ai_source: string; coach_ai_provider: string; coach_ai_model: string; coach_ai_base_url: string | null; build_ai_source: string; build_ai_provider: string; build_ai_model: string; build_ai_base_url: string | null }
        Insert: { confirm_actions?: boolean; created_at?: string; memory_level?: string; permissions?: Json; updated_at?: string; user_id: string; coach_ai_source?: string; coach_ai_provider?: string; coach_ai_model?: string; coach_ai_base_url?: string | null; build_ai_source?: string; build_ai_provider?: string; build_ai_model?: string; build_ai_base_url?: string | null }
        Update: { confirm_actions?: boolean; created_at?: string; memory_level?: string; permissions?: Json; updated_at?: string; user_id?: string; coach_ai_source?: string; coach_ai_provider?: string; coach_ai_model?: string; coach_ai_base_url?: string | null; build_ai_source?: string; build_ai_provider?: string; build_ai_model?: string; build_ai_base_url?: string | null }
        Relationships: []
      }
      ai_provider_secrets: {
        Row: { user_id: string; provider: string; encrypted_api_key: string; key_last4: string; created_at: string; updated_at: string }
        Insert: { user_id: string; provider: string; encrypted_api_key: string; key_last4?: string; created_at?: string; updated_at?: string }
        Update: { user_id?: string; provider?: string; encrypted_api_key?: string; key_last4?: string; created_at?: string; updated_at?: string }
        Relationships: []
      }
      development_tasks: {
        Row: { conversation_id: string | null; created_at: string; description: string; id: string; kind: string; priority: string; status: string; title: string; updated_at: string; user_id: string }
        Insert: { conversation_id?: string | null; created_at?: string; description?: string; id?: string; kind: string; priority?: string; status?: string; title: string; updated_at?: string; user_id: string }
        Update: { conversation_id?: string | null; created_at?: string; description?: string; id?: string; kind?: string; priority?: string; status?: string; title?: string; updated_at?: string; user_id?: string }
        Relationships: [{ foreignKeyName: "development_tasks_conversation_id_fkey"; columns: ["conversation_id"]; isOneToOne: false; referencedRelation: "ai_conversations"; referencedColumns: ["id"] }]
      }
      food_log: {
        Row: { carbs_g: number; created_at: string; fat_g: number; fiber_g: number | null; health_score: string | null; id: string; kcal: number; log_date: string; meal: string; meta: Json | null; name: string; protein_g: number; sodium_mg: number | null; source: string | null; sugar_g: number | null; user_id: string }
        Insert: { carbs_g?: number; created_at?: string; fat_g?: number; fiber_g?: number | null; health_score?: string | null; id?: string; kcal?: number; log_date?: string; meal?: string; meta?: Json | null; name: string; protein_g?: number; sodium_mg?: number | null; source?: string | null; sugar_g?: number | null; user_id: string }
        Update: { carbs_g?: number; created_at?: string; fat_g?: number; fiber_g?: number | null; health_score?: string | null; id?: string; kcal?: number; log_date?: string; meal?: string; meta?: Json | null; name?: string; protein_g?: number; sodium_mg?: number | null; source?: string | null; sugar_g?: number | null; user_id?: string }
        Relationships: []
      }
      food_scans: {
        Row: { barcode: string | null; brand: string | null; carbs_g: number | null; created_at: string; fat_g: number | null; favorite: boolean | null; fiber_g: number | null; health_score: string | null; id: string; image_url: string | null; ingredients: string | null; kcal: number | null; kind: string; nova_group: number | null; nutri_score: string | null; product_name: string | null; protein_g: number | null; raw: Json | null; salt_g: number | null; sodium_mg: number | null; sugar_g: number | null; user_id: string; warnings: string[] | null }
        Insert: { barcode?: string | null; brand?: string | null; carbs_g?: number | null; carbs_g?: number | null; created_at?: string; fat_g?: number | null; favorite?: boolean | null; fiber_g?: number | null; health_score?: string | null; id?: string; image_url?: string | null; ingredients?: string | null; kcal?: number | null; kind: string; nova_group?: number | null; nutri_score?: string | null; product_name?: string | null; protein_g?: number | null; raw?: Json | null; salt_g?: number | null; sodium_mg?: number | null; sugar_g?: number | null; user_id: string; warnings?: string[] | null }
        Update: { barcode?: string | null; brand?: string | null; carbs_g?: number | null; created_at?: string; fat_g?: number | null; favorite?: boolean | null; fiber_g?: number | null; health_score?: string | null; id?: string; image_url?: string | null; ingredients?: string | null; kcal?: number | null; kind?: string; nova_group?: number | null; nutri_score?: string | null; product_name?: string | null; protein_g?: number | null; raw?: Json | null; salt_g?: number | null; sodium_mg?: number | null; sugar_g?: number | null; user_id?: string; warnings?: string[] | null }
        Relationships: []
      }
      health_samples: {
        Row: { created_at: string; id: string; source: string; ts: string; type: string; user_id: string; value: number }
        Insert: { created_at?: string; id?: string; source?: string; ts?: string; type: string; user_id: string; value: number }
        Update: { created_at?: string; id?: string; source?: string; ts?: string; type?: string; user_id?: string; value?: number }
        Relationships: []
      }
      legal_consent: {
        Row: { consented_at: string; created_at: string; eula_version: string; id: string; ip_country: string | null; opts: Json; privacy_version: string; region: string; updated_at: string; user_id: string }
        Insert: { consented_at?: string; created_at?: string; eula_version: string; id?: string; ip_country?: string | null; opts?: Json; privacy_version: string; region: string; updated_at?: string; user_id: string }
        Update: { consented_at?: string; created_at?: string; eula_version?: string; id?: string; ip_country?: string | null; opts?: Json; privacy_version?: string; region?: string; updated_at?: string; user_id?: string }
        Relationships: []
      }
      notification_log: {
        Row: { id: string; payload: Json | null; sent_at: string; type: string; user_id: string }
        Insert: { id?: string; payload?: Json | null; sent_at?: string; type: string; user_id: string }
        Update: { id?: string; payload?: Json | null; sent_at?: string; type?: string; user_id?: string }
        Relationships: []
      }
      profiles: {
        Row: { activity_level: string | null; age: number | null; body_fat_goal_pct: number | null; created_at: string; daily_calorie_goal: number | null; daily_protein_goal: number | null; daily_water_ml_goal: number | null; display_name: string | null; email: string | null; height_cm: number | null; id: string; muscle_mass_goal_pct: number | null; sex: string | null; training_goal: string | null; updated_at: string; user_id: string; weight_goal_kg: number | null; weight_kg: number | null }
        Insert: { activity_level?: string | null; age?: number | null; body_fat_goal_pct?: number | null; created_at?: string; daily_calorie_goal?: number | null; daily_protein_goal?: number | null; daily_water_ml_goal?: number | null; display_name?: string | null; email?: string | null; height_cm?: string | null; id?: string; muscle_mass_goal_pct?: number | null; sex?: string | null; training_goal?: string | null; updated_at?: string; user_id: string; weight_goal_kg?: number | null; weight_kg?: number | null }
        Update: { activity_level?: string | null; age?: number | null; body_fat_goal_pct?: number | null; created_at?: string; daily_calorie_goal?: number | null; daily_protein_goal?: number | null; daily_water_ml_goal?: number | null; display_name?: string | null; email?: string | null; height_cm?: number | null; id?: string; muscle_mass_goal_pct?: number | null; sex?: string | null; training_goal?: string | null; updated_at?: string; user_id?: string; weight_goal_kg?: number | null; weight_kg?: number | null }
        Relationships: []
      }
      reminder_debug_log: {
        Row: { created_at: string; id: string; payload: Json; reason: string | null; status: string; target_segment: string | null; trigger: string; type: string; user_id: string }
        Insert: { created_at?: string; id?: string; payload?: Json; reason?: string | null; status: string; target_segment?: string | null; trigger?: string; type: string; user_id: string }
        Update: { created_at?: string; id?: string; payload?: Json; reason?: string | null; status?: string; target_segment?: string | null; trigger?: string; type?: string; user_id?: string }
        Relationships: []
      }
      reminder_settings: {
        Row: { created_at: string; enabled: boolean; id: string; threshold: number | null; time_local: string | null; timezone: string; type: string; updated_at: string; user_id: string }
        Insert: { created_at?: string; enabled?: boolean; id?: string; threshold?: number | null; time_local?: string | null; timezone?: string; type: string; updated_at?: string; user_id: string }
        Update: { created_at?: string; enabled?: boolean; id?: string; threshold?: number | null; time_local?: string | null; timezone?: string; type?: string; updated_at?: string; user_id?: string }
        Relationships: []
      }
      user_state: {
        Row: { created_at: string; id: string; key: string; updated_at: string; user_id: string; value: Json | null }
        Insert: { created_at?: string; id?: string; key: string; updated_at?: string; user_id: string; value?: Json | null }
        Update: { created_at?: string; id?: string; key?: string; updated_at?: string; user_id?: string; value?: Json | null }
        Relationships: []
      }
    }
    Views: { [_ in never]: never }
    Functions: { [_ in never]: never }
    Enums: { [_ in never]: never }
    CompositeTypes: { [_ in never]: never }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">
type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"]) | { schema: keyof DatabaseWithoutInternals }, TableName extends DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals } ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] & DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"]) : never = never> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals } ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] & DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends { Row: infer R } ? R : never : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"]) ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends { Row: infer R } ? R : never : never

export type TablesInsert<DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals }, TableName extends DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals } ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] : never = never> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals } ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends { Insert: infer I } ? I : never : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"] ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends { Insert: infer I } ? I : never : never

export type TablesUpdate<DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals }, TableName extends DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals } ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] : never = never> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals } ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends { Update: infer U } ? U : never : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"] ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends { Update: infer U } ? U : never : never

export type Enums<DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals }, EnumName extends DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals } ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Enums"] : never = never> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals } ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Enums"][EnumName] : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Enums"] ? DefaultSchema["Enums"][DefaultSchemaTableNameOrOptions] : never

export type CompositeTypes<PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"] | { schema: keyof DatabaseWithoutInternals }, CompositeTypeName extends PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals } ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"] : never = never> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals } ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName] : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"] ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions] : never

export const Constants = { public: { Enums: {} } } as const
