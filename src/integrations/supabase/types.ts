export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      ai_action_log: {
        Row: {
          action_type: string
          agent_type: string
          conversation_id: string | null
          created_at: string
          error_message: string | null
          executed_at: string | null
          id: string
          label: string
          payload: Json
          status: string
          user_id: string
        }
        Insert: {
          action_type: string
          agent_type: string
          conversation_id?: string | null
          created_at?: string
          error_message?: string | null
          executed_at?: string | null
          id?: string
          label: string
          payload?: Json
          status?: string
          user_id: string
        }
        Update: {
          action_type?: string
          agent_type?: string
          conversation_id?: string | null
          created_at?: string
          error_message?: string | null
          executed_at?: string | null
          id?: string
          label?: string
          payload?: Json
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_action_log_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "ai_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_conversations: {
        Row: {
          agent_type: string
          created_at: string
          id: string
          is_archived: boolean
          is_ephemeral: boolean
          is_starred: boolean
          memory_summary: string | null
          summarized_count: number
          summary: string | null
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          agent_type: string
          created_at?: string
          id?: string
          is_archived?: boolean
          is_ephemeral?: boolean
          is_starred?: boolean
          memory_summary?: string | null
          summarized_count?: number
          summary?: string | null
          title?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          agent_type?: string
          created_at?: string
          id?: string
          is_archived?: boolean
          is_ephemeral?: boolean
          is_starred?: boolean
          memory_summary?: string | null
          summarized_count?: number
          summary?: string | null
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      ai_messages: {
        Row: {
          conversation_id: string
          created_at: string
          id: string
          model_message_id: string | null
          parts: Json
          plain_text: string
          role: string
          user_id: string
        }
        Insert: {
          conversation_id: string
          created_at?: string
          id?: string
          model_message_id?: string | null
          parts?: Json
          plain_text?: string
          role: string
          user_id: string
        }
        Update: {
          conversation_id?: string
          created_at?: string
          id?: string
          model_message_id?: string | null
          parts?: Json
          plain_text?: string
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "ai_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_preferences: {
        Row: {
          build_ai_base_url: string | null
          build_ai_model: string
          build_ai_provider: string
          build_ai_source: string
          coach_ai_base_url: string | null
          coach_ai_model: string
          coach_ai_provider: string
          coach_ai_source: string
          confirm_actions: boolean
          created_at: string
          memory_level: string
          permissions: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          build_ai_base_url?: string | null
          build_ai_model?: string
          build_ai_provider?: string
          build_ai_source?: string
          coach_ai_base_url?: string | null
          coach_ai_model?: string
          coach_ai_provider?: string
          coach_ai_source?: string
          confirm_actions?: boolean
          created_at?: string
          memory_level?: string
          permissions?: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          build_ai_base_url?: string | null
          build_ai_model?: string
          build_ai_provider?: string
          build_ai_source?: string
          coach_ai_base_url?: string | null
          coach_ai_model?: string
          coach_ai_provider?: string
          coach_ai_source?: string
          confirm_actions?: boolean
          created_at?: string
          memory_level?: string
          permissions?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      ai_provider_secrets: {
        Row: {
          created_at: string
          encrypted_api_key: string
          key_last4: string
          provider: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          encrypted_api_key: string
          key_last4?: string
          provider: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          encrypted_api_key?: string
          key_last4?: string
          provider?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      ai_tool_idempotency: {
        Row: {
          conversation_id: string
          created_at: string
          food_log_id: string | null
          idempotency_key: string
          tool_name: string
          user_id: string
        }
        Insert: {
          conversation_id: string
          created_at?: string
          food_log_id?: string | null
          idempotency_key: string
          tool_name: string
          user_id: string
        }
        Update: {
          conversation_id?: string
          created_at?: string
          food_log_id?: string | null
          idempotency_key?: string
          tool_name?: string
          user_id?: string
        }
        Relationships: []
      }
      audit_log: {
        Row: {
          action: string
          created_at: string
          id: number
          ip_hash: string | null
          metadata: Json
          resource: string | null
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          id?: never
          ip_hash?: string | null
          metadata?: Json
          resource?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          id?: never
          ip_hash?: string | null
          metadata?: Json
          resource?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      billing_customers: {
        Row: {
          created_at: string
          email: string | null
          stripe_customer_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          stripe_customer_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          email?: string | null
          stripe_customer_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      billing_events: {
        Row: {
          event_type: string
          last_error: string | null
          payload: Json
          processed_at: string
          status: string
          stripe_event_id: string
        }
        Insert: {
          event_type: string
          last_error?: string | null
          payload?: Json
          processed_at?: string
          status?: string
          stripe_event_id: string
        }
        Update: {
          event_type?: string
          last_error?: string | null
          payload?: Json
          processed_at?: string
          status?: string
          stripe_event_id?: string
        }
        Relationships: []
      }
      billing_subscriptions: {
        Row: {
          cancel_at_period_end: boolean
          created_at: string
          current_period_end: string | null
          plan: string
          status: string
          stripe_customer_id: string
          stripe_subscription_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          cancel_at_period_end?: boolean
          created_at?: string
          current_period_end?: string | null
          plan: string
          status: string
          stripe_customer_id: string
          stripe_subscription_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          cancel_at_period_end?: boolean
          created_at?: string
          current_period_end?: string | null
          plan?: string
          status?: string
          stripe_customer_id?: string
          stripe_subscription_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      billing_trials: {
        Row: {
          created_at: string
          device_hash: string
          trial_ends_at: string
          trial_started_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          device_hash: string
          trial_ends_at: string
          trial_started_at: string
          user_id: string
        }
        Update: {
          created_at?: string
          device_hash?: string
          trial_ends_at?: string
          trial_started_at?: string
          user_id?: string
        }
        Relationships: []
      }
      consent_records: {
        Row: {
          consent_type: string
          created_at: string
          granted: boolean
          id: string
          ip_hash: string | null
          legal_version: string
          policy_version: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          consent_type: string
          created_at?: string
          granted: boolean
          id?: string
          ip_hash?: string | null
          legal_version: string
          policy_version: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          consent_type?: string
          created_at?: string
          granted?: boolean
          id?: string
          ip_hash?: string | null
          legal_version?: string
          policy_version?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: []
      }
      data_deletion_requests: {
        Row: {
          completed_at: string | null
          created_at: string
          error_code: string | null
          id: string
          requested_at: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          error_code?: string | null
          id?: string
          requested_at?: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          error_code?: string | null
          id?: string
          requested_at?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      development_tasks: {
        Row: {
          conversation_id: string | null
          created_at: string
          description: string
          id: string
          kind: string
          priority: string
          status: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          conversation_id?: string | null
          created_at?: string
          description?: string
          id?: string
          kind: string
          priority?: string
          status?: string
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          conversation_id?: string | null
          created_at?: string
          description?: string
          id?: string
          kind?: string
          priority?: string
          status?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "development_tasks_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "ai_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      food_log: {
        Row: {
          carbs_g: number
          created_at: string
          fat_g: number
          fiber_g: number | null
          health_score: string | null
          id: string
          kcal: number
          log_date: string
          meal: string
          meta: Json | null
          name: string
          protein_g: number
          sodium_mg: number | null
          source: string | null
          sugar_g: number | null
          user_id: string
        }
        Insert: {
          carbs_g?: number
          created_at?: string
          fat_g?: number
          fiber_g?: number | null
          health_score?: string | null
          id?: string
          kcal?: number
          log_date?: string
          meal?: string
          meta?: Json | null
          name: string
          protein_g?: number
          sodium_mg?: number | null
          source?: string | null
          sugar_g?: number | null
          user_id: string
        }
        Update: {
          carbs_g?: number
          created_at?: string
          fat_g?: number
          fiber_g?: number | null
          health_score?: string | null
          id?: string
          kcal?: number
          log_date?: string
          meal?: string
          meta?: Json | null
          name?: string
          protein_g?: number
          sodium_mg?: number | null
          source?: string | null
          sugar_g?: number | null
          user_id?: string
        }
        Relationships: []
      }
      food_scans: {
        Row: {
          barcode: string | null
          brand: string | null
          carbs_g: number | null
          created_at: string
          fat_g: number | null
          favorite: boolean | null
          fiber_g: number | null
          health_score: string | null
          id: string
          image_url: string | null
          ingredients: string | null
          kcal: number | null
          kind: string
          nova_group: number | null
          nutri_score: string | null
          product_name: string | null
          protein_g: number | null
          raw: Json | null
          salt_g: number | null
          sodium_mg: number | null
          sugar_g: number | null
          user_id: string
          warnings: string[] | null
        }
        Insert: {
          barcode?: string | null
          brand?: string | null
          carbs_g?: number | null
          created_at?: string
          fat_g?: number | null
          favorite?: boolean | null
          fiber_g?: number | null
          health_score?: string | null
          id?: string
          image_url?: string | null
          ingredients?: string | null
          kcal?: number | null
          kind: string
          nova_group?: number | null
          nutri_score?: string | null
          product_name?: string | null
          protein_g?: number | null
          raw?: Json | null
          salt_g?: number | null
          sodium_mg?: number | null
          sugar_g?: number | null
          user_id: string
          warnings?: string[] | null
        }
        Update: {
          barcode?: string | null
          brand?: string | null
          carbs_g?: number | null
          created_at?: string
          fat_g?: number | null
          favorite?: boolean | null
          fiber_g?: number | null
          health_score?: string | null
          id?: string
          image_url?: string | null
          ingredients?: string | null
          kcal?: number | null
          kind?: string
          nova_group?: number | null
          nutri_score?: string | null
          product_name?: string | null
          protein_g?: number | null
          raw?: Json | null
          salt_g?: number | null
          sodium_mg?: number | null
          sugar_g?: number | null
          user_id?: string
          warnings?: string[] | null
        }
        Relationships: []
      }
      health_samples: {
        Row: {
          created_at: string
          external_id: string | null
          id: string
          metadata: Json
          source: string
          source_id: string | null
          ts: string
          type: string
          user_id: string
          value: number
        }
        Insert: {
          created_at?: string
          external_id?: string | null
          id?: string
          metadata?: Json
          source?: string
          source_id?: string | null
          ts?: string
          type: string
          user_id: string
          value: number
        }
        Update: {
          created_at?: string
          external_id?: string | null
          id?: string
          metadata?: Json
          source?: string
          source_id?: string | null
          ts?: string
          type?: string
          user_id?: string
          value?: number
        }
        Relationships: []
      }
      health_samples_e2ee: {
        Row: {
          algorithm: string
          ciphertext: string
          created_at: string
          id: string
          key_version: number
          nonce: string
          user_id: string
        }
        Insert: {
          algorithm?: string
          ciphertext: string
          created_at?: string
          id?: string
          key_version?: number
          nonce: string
          user_id: string
        }
        Update: {
          algorithm?: string
          ciphertext?: string
          created_at?: string
          id?: string
          key_version?: number
          nonce?: string
          user_id?: string
        }
        Relationships: []
      }
      legal_consent: {
        Row: {
          consented_at: string
          created_at: string
          eula_version: string
          id: string
          ip_country: string | null
          opts: Json
          privacy_version: string
          region: string
          updated_at: string
          user_id: string
        }
        Insert: {
          consented_at?: string
          created_at?: string
          eula_version: string
          id?: string
          ip_country?: string | null
          opts?: Json
          privacy_version: string
          region: string
          updated_at?: string
          user_id: string
        }
        Update: {
          consented_at?: string
          created_at?: string
          eula_version?: string
          id?: string
          ip_country?: string | null
          opts?: Json
          privacy_version?: string
          region?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      notification_log: {
        Row: {
          id: string
          payload: Json | null
          sent_at: string
          type: string
          user_id: string
        }
        Insert: {
          id?: string
          payload?: Json | null
          sent_at?: string
          type: string
          user_id: string
        }
        Update: {
          id?: string
          payload?: Json | null
          sent_at?: string
          type?: string
          user_id?: string
        }
        Relationships: []
      }
      nutrition_canonical_dishes: {
        Row: {
          aliases: string[]
          canonical_name: string
          carbs_g: number
          confidence: number
          cuisine: string | null
          fat_g: number
          fiber_g: number
          id: string
          kcal: number
          protein_g: number
          serving_grams: number | null
          sodium_mg: number
          source_id: string
          source_record_id: string | null
          sugar_g: number
          verified_at: string
          version: string
        }
        Insert: {
          aliases?: string[]
          canonical_name: string
          carbs_g?: number
          confidence?: number
          cuisine?: string | null
          fat_g?: number
          fiber_g?: number
          id?: string
          kcal: number
          protein_g?: number
          serving_grams?: number | null
          sodium_mg?: number
          source_id: string
          source_record_id?: string | null
          sugar_g?: number
          verified_at?: string
          version: string
        }
        Update: {
          aliases?: string[]
          canonical_name?: string
          carbs_g?: number
          confidence?: number
          cuisine?: string | null
          fat_g?: number
          fiber_g?: number
          id?: string
          kcal?: number
          protein_g?: number
          serving_grams?: number | null
          sodium_mg?: number
          source_id?: string
          source_record_id?: string | null
          sugar_g?: number
          verified_at?: string
          version?: string
        }
        Relationships: [
          {
            foreignKeyName: "nutrition_canonical_dishes_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "nutrition_data_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      nutrition_data_sources: {
        Row: {
          allowed_for_production: boolean
          authority: string
          created_at: string
          dataset_version: string
          id: string
          license_note: string | null
          name: string
          priority: number
          source_url: string
        }
        Insert: {
          allowed_for_production?: boolean
          authority: string
          created_at?: string
          dataset_version: string
          id: string
          license_note?: string | null
          name: string
          priority?: number
          source_url: string
        }
        Update: {
          allowed_for_production?: boolean
          authority?: string
          created_at?: string
          dataset_version?: string
          id?: string
          license_note?: string | null
          name?: string
          priority?: number
          source_url?: string
        }
        Relationships: []
      }
      nutrition_dish_references: {
        Row: {
          aliases: string[]
          canonical_name: string
          carbs_g: number
          confidence: number
          created_at: string
          fat_g: number
          fiber_g: number
          id: string
          kcal: number
          portion_g: number
          protein_g: number
          sodium_mg: number
          source: string
          source_key: string | null
          source_record_id: string | null
          source_verified: boolean
          sugar_g: number
          verified_at: string
          version: string
        }
        Insert: {
          aliases?: string[]
          canonical_name: string
          carbs_g?: number
          confidence?: number
          created_at?: string
          fat_g?: number
          fiber_g?: number
          id?: string
          kcal: number
          portion_g: number
          protein_g?: number
          sodium_mg?: number
          source: string
          source_key?: string | null
          source_record_id?: string | null
          source_verified?: boolean
          sugar_g?: number
          verified_at?: string
          version?: string
        }
        Update: {
          aliases?: string[]
          canonical_name?: string
          carbs_g?: number
          confidence?: number
          created_at?: string
          fat_g?: number
          fiber_g?: number
          id?: string
          kcal?: number
          portion_g?: number
          protein_g?: number
          sodium_mg?: number
          source?: string
          source_key?: string | null
          source_record_id?: string | null
          source_verified?: boolean
          sugar_g?: number
          verified_at?: string
          version?: string
        }
        Relationships: []
      }
      nutrition_reference_dishes: {
        Row: {
          aliases: string[]
          canonical_name: string
          carbs_g: number
          confidence: number
          created_at: string
          fat_g: number
          fiber_g: number
          id: string
          kcal: number
          portion_g: number
          protein_g: number
          sodium_mg: number
          source: string
          sugar_g: number
          updated_at: string
          version: string
        }
        Insert: {
          aliases?: string[]
          canonical_name: string
          carbs_g?: number
          confidence?: number
          created_at?: string
          fat_g?: number
          fiber_g?: number
          id?: string
          kcal: number
          portion_g: number
          protein_g?: number
          sodium_mg?: number
          source: string
          sugar_g?: number
          updated_at?: string
          version?: string
        }
        Update: {
          aliases?: string[]
          canonical_name?: string
          carbs_g?: number
          confidence?: number
          created_at?: string
          fat_g?: number
          fiber_g?: number
          id?: string
          kcal?: number
          portion_g?: number
          protein_g?: number
          sodium_mg?: number
          source?: string
          sugar_g?: number
          updated_at?: string
          version?: string
        }
        Relationships: []
      }
      nutrition_reference_foods: {
        Row: {
          aliases: string[]
          brand: string | null
          carbs_g_per_100g: number
          category: string | null
          confidence: number
          fat_g_per_100g: number
          fiber_g_per_100g: number
          id: string
          kcal_per_100g: number
          name: string
          protein_g_per_100g: number
          sodium_mg_per_100g: number
          source: string
          source_id: string | null
          source_record_id: string | null
          sugar_g_per_100g: number
          verified_at: string | null
          version: string
        }
        Insert: {
          aliases?: string[]
          brand?: string | null
          carbs_g_per_100g?: number
          category?: string | null
          confidence?: number
          fat_g_per_100g?: number
          fiber_g_per_100g?: number
          id?: string
          kcal_per_100g: number
          name: string
          protein_g_per_100g?: number
          sodium_mg_per_100g?: number
          source?: string
          source_id?: string | null
          source_record_id?: string | null
          sugar_g_per_100g?: number
          verified_at?: string | null
          version?: string
        }
        Update: {
          aliases?: string[]
          brand?: string | null
          carbs_g_per_100g?: number
          category?: string | null
          confidence?: number
          fat_g_per_100g?: number
          fiber_g_per_100g?: number
          id?: string
          kcal_per_100g?: number
          name?: string
          protein_g_per_100g?: number
          sodium_mg_per_100g?: number
          source?: string
          source_id?: string | null
          source_record_id?: string | null
          sugar_g_per_100g?: number
          verified_at?: string | null
          version?: string
        }
        Relationships: [
          {
            foreignKeyName: "nutrition_reference_foods_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "nutrition_data_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      nutrition_reference_sources: {
        Row: {
          allowed_for_production: boolean
          dataset_name: string
          dataset_version: string
          id: string
          last_verified_at: string
          license: string | null
          official_url: string
          publisher: string
          source_key: string
        }
        Insert: {
          allowed_for_production?: boolean
          dataset_name: string
          dataset_version: string
          id?: string
          last_verified_at?: string
          license?: string | null
          official_url: string
          publisher: string
          source_key: string
        }
        Update: {
          allowed_for_production?: boolean
          dataset_name?: string
          dataset_version?: string
          id?: string
          last_verified_at?: string
          license?: string | null
          official_url?: string
          publisher?: string
          source_key?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          activity_level: string | null
          age: number | null
          avatar_url: string | null
          body_fat_goal_pct: number | null
          daily_calorie_goal: number | null
          daily_protein_goal: number | null
          daily_water_ml_goal: number | null
          display_name: string | null
          email: string | null
          full_name: string | null
          height_cm: number | null
          id: string
          muscle_mass_goal_pct: number | null
          sex: string | null
          training_goal: string | null
          training_sessions_goal: number | null
          updated_at: string
          updated_by: string | null
          user_id: string
          weight_goal_kg: number | null
          weight_kg: number | null
        }
        Insert: {
          activity_level?: string | null
          age?: number | null
          avatar_url?: string | null
          body_fat_goal_pct?: number | null
          daily_calorie_goal?: number | null
          daily_protein_goal?: number | null
          daily_water_ml_goal?: number | null
          display_name?: string | null
          email?: string | null
          full_name?: string | null
          height_cm?: number | null
          id: string
          muscle_mass_goal_pct?: number | null
          sex?: string | null
          training_goal?: string | null
          training_sessions_goal?: number | null
          updated_at?: string
          updated_by?: string | null
          user_id: string
          weight_goal_kg?: number | null
          weight_kg?: number | null
        }
        Update: {
          activity_level?: string | null
          age?: number | null
          avatar_url?: string | null
          body_fat_goal_pct?: number | null
          daily_calorie_goal?: number | null
          daily_protein_goal?: number | null
          daily_water_ml_goal?: number | null
          display_name?: string | null
          email?: string | null
          full_name?: string | null
          height_cm?: number | null
          id?: string
          muscle_mass_goal_pct?: number | null
          sex?: string | null
          training_goal?: string | null
          training_sessions_goal?: number | null
          updated_at?: string
          updated_by?: string | null
          user_id?: string
          weight_goal_kg?: number | null
          weight_kg?: number | null
        }
        Relationships: []
      }
      push_subscriptions: {
        Row: {
          created_at: string
          id: string
          onesignal_subscription_id: string
          platform: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          onesignal_subscription_id: string
          platform?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          onesignal_subscription_id?: string
          platform?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      reminder_debug_log: {
        Row: {
          created_at: string
          id: string
          payload: Json
          reason: string | null
          status: string
          target_segment: string | null
          trigger: string
          type: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          payload?: Json
          reason?: string | null
          status: string
          target_segment?: string | null
          trigger?: string
          type: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          payload?: Json
          reason?: string | null
          status?: string
          target_segment?: string | null
          trigger?: string
          type?: string
          user_id?: string
        }
        Relationships: []
      }
      reminder_settings: {
        Row: {
          created_at: string
          enabled: boolean
          id: string
          threshold: number | null
          time_local: string | null
          timezone: string
          type: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          id?: string
          threshold?: number | null
          time_local?: string | null
          timezone?: string
          type: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          enabled?: boolean
          id?: string
          threshold?: number | null
          time_local?: string | null
          timezone?: string
          type?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      sport_exercises: {
        Row: {
          created_at: string
          default_reps: number | null
          default_sets: number | null
          default_weight: number | null
          equipment: string | null
          id: string
          muscle: string
          name: string
          notes: string | null
          rest_sec: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          default_reps?: number | null
          default_sets?: number | null
          default_weight?: number | null
          equipment?: string | null
          id?: string
          muscle: string
          name: string
          notes?: string | null
          rest_sec?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          default_reps?: number | null
          default_sets?: number | null
          default_weight?: number | null
          equipment?: string | null
          id?: string
          muscle?: string
          name?: string
          notes?: string | null
          rest_sec?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      sport_program_items: {
        Row: {
          created_at: string
          exercise_id: string
          id: string
          position: number
          program_id: string
          reps: number
          rest_sec: number | null
          sets: number
          updated_at: string
          weight: number | null
        }
        Insert: {
          created_at?: string
          exercise_id: string
          id?: string
          position?: number
          program_id: string
          reps?: number
          rest_sec?: number | null
          sets?: number
          updated_at?: string
          weight?: number | null
        }
        Update: {
          created_at?: string
          exercise_id?: string
          id?: string
          position?: number
          program_id?: string
          reps?: number
          rest_sec?: number | null
          sets?: number
          updated_at?: string
          weight?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "sport_program_items_exercise_id_fkey"
            columns: ["exercise_id"]
            isOneToOne: false
            referencedRelation: "sport_exercises"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sport_program_items_program_id_fkey"
            columns: ["program_id"]
            isOneToOne: false
            referencedRelation: "sport_programs"
            referencedColumns: ["id"]
          },
        ]
      }
      sport_programs: {
        Row: {
          created_at: string
          days: number[]
          emoji: string
          id: string
          is_archived: boolean
          name: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          days?: number[]
          emoji?: string
          id?: string
          is_archived?: boolean
          name: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          days?: number[]
          emoji?: string
          id?: string
          is_archived?: boolean
          name?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      sport_progression_targets: {
        Row: {
          based_on_session_id: string | null
          exercise_id: string
          generated_at: string
          id: string
          rationale: string | null
          strategy: string
          target_reps: number
          target_sets: number
          target_weight: number
          updated_at: string
          user_id: string
        }
        Insert: {
          based_on_session_id?: string | null
          exercise_id: string
          generated_at?: string
          id?: string
          rationale?: string | null
          strategy?: string
          target_reps: number
          target_sets: number
          target_weight?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          based_on_session_id?: string | null
          exercise_id?: string
          generated_at?: string
          id?: string
          rationale?: string | null
          strategy?: string
          target_reps?: number
          target_sets?: number
          target_weight?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sport_progression_targets_based_on_session_id_fkey"
            columns: ["based_on_session_id"]
            isOneToOne: false
            referencedRelation: "sport_workout_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sport_progression_targets_exercise_id_fkey"
            columns: ["exercise_id"]
            isOneToOne: false
            referencedRelation: "sport_exercises"
            referencedColumns: ["id"]
          },
        ]
      }
      sport_workout_exercises: {
        Row: {
          created_at: string
          exercise_id: string
          id: string
          note: string | null
          position: number
          session_id: string
        }
        Insert: {
          created_at?: string
          exercise_id: string
          id?: string
          note?: string | null
          position?: number
          session_id: string
        }
        Update: {
          created_at?: string
          exercise_id?: string
          id?: string
          note?: string | null
          position?: number
          session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sport_workout_exercises_exercise_id_fkey"
            columns: ["exercise_id"]
            isOneToOne: false
            referencedRelation: "sport_exercises"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sport_workout_exercises_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sport_workout_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      sport_workout_sessions: {
        Row: {
          created_at: string
          duration_min: number | null
          ended_at: string | null
          id: string
          is_temporary: boolean
          name: string
          notes: string | null
          program_id: string | null
          started_at: string
          updated_at: string
          user_id: string
          workout_date: string
        }
        Insert: {
          created_at?: string
          duration_min?: number | null
          ended_at?: string | null
          id?: string
          is_temporary?: boolean
          name: string
          notes?: string | null
          program_id?: string | null
          started_at?: string
          updated_at?: string
          user_id: string
          workout_date?: string
        }
        Update: {
          created_at?: string
          duration_min?: number | null
          ended_at?: string | null
          id?: string
          is_temporary?: boolean
          name?: string
          notes?: string | null
          program_id?: string | null
          started_at?: string
          updated_at?: string
          user_id?: string
          workout_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "sport_workout_sessions_program_id_fkey"
            columns: ["program_id"]
            isOneToOne: false
            referencedRelation: "sport_programs"
            referencedColumns: ["id"]
          },
        ]
      }
      sport_workout_sets: {
        Row: {
          created_at: string
          done: boolean
          id: string
          reps: number
          set_number: number
          updated_at: string
          weight: number
          workout_exercise_id: string
        }
        Insert: {
          created_at?: string
          done?: boolean
          id?: string
          reps: number
          set_number: number
          updated_at?: string
          weight?: number
          workout_exercise_id: string
        }
        Update: {
          created_at?: string
          done?: boolean
          id?: string
          reps?: number
          set_number?: number
          updated_at?: string
          weight?: number
          workout_exercise_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sport_workout_sets_workout_exercise_id_fkey"
            columns: ["workout_exercise_id"]
            isOneToOne: false
            referencedRelation: "sport_workout_exercises"
            referencedColumns: ["id"]
          },
        ]
      }
      user_state: {
        Row: {
          created_at: string
          id: string
          key: string
          updated_at: string
          updated_by: string | null
          user_id: string
          value: Json | null
        }
        Insert: {
          created_at?: string
          id?: string
          key: string
          updated_at?: string
          updated_by?: string | null
          user_id: string
          value?: Json | null
        }
        Update: {
          created_at?: string
          id?: string
          key?: string
          updated_at?: string
          updated_by?: string | null
          user_id?: string
          value?: Json | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      canonicalize_nutrition_meal: { Args: { p_meal: string }; Returns: string }
      insert_coach_ai_food_idempotent: {
        Args: {
          p_carbs_g: number
          p_conversation_id: string
          p_fat_g: number
          p_fiber_g: number
          p_grams: number
          p_kcal: number
          p_meal: string
          p_name: string
          p_protein_g: number
          p_sodium_mg: number
          p_sugar_g: number
          p_tool_call_id: string
          p_user_id: string
        }
        Returns: {
          id: string
          inserted: boolean
          log_date: string
        }[]
      }
      insert_coach_ai_food_idempotent_v2: {
        Args: {
          p_carbs_g: number
          p_conversation_id: string
          p_fat_g: number
          p_fiber_g: number
          p_grams: number
          p_kcal: number
          p_meal: string
          p_meta?: Json
          p_name: string
          p_protein_g: number
          p_sodium_mg: number
          p_sugar_g: number
          p_tool_call_id: string
          p_user_id: string
        }
        Returns: {
          id: string
          inserted: boolean
          log_date: string
        }[]
      }
      nutrition_macro_kcal_consistent: {
        Args: {
          p_carbs: number
          p_fat: number
          p_kcal: number
          p_protein: number
        }
        Returns: boolean
      }
      sport_delete_exercise: { Args: { p_id: string }; Returns: boolean }
      sport_delete_program: { Args: { p_id: string }; Returns: boolean }
      sport_delete_workout: { Args: { p_id: string }; Returns: boolean }
      sport_finish_workout: {
        Args: {
          p_duration_min?: number
          p_ended_at?: string
          p_id: string
          p_notes?: string
        }
        Returns: boolean
      }
      sport_update_exercise: {
        Args: {
          p_default_reps?: number
          p_default_sets?: number
          p_default_weight?: number
          p_equipment?: string
          p_id: string
          p_muscle?: string
          p_name?: string
          p_notes?: string
          p_rest_sec?: number
        }
        Returns: boolean
      }
      sport_update_program: {
        Args: {
          p_days?: number[]
          p_emoji?: string
          p_id: string
          p_name?: string
        }
        Returns: boolean
      }
      upsert_profile_if_newer: {
        Args: {
          p_profile: Json
          p_updated_at: string
          p_updated_by: string
          p_user_id: string
        }
        Returns: boolean
      }
      upsert_user_state_if_newer: {
        Args: {
          p_key: string
          p_updated_at: string
          p_updated_by: string
          p_user_id: string
          p_value: Json
        }
        Returns: boolean
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
