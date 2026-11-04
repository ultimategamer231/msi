export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: {
      app_environment: {
        Row: {
          id: boolean;
          kind: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          id?: boolean;
          kind?: string;
          updated_at?: string;
        };
        Update: {
          id?: boolean;
          kind?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      audit_log: {
        Row: {
          action: string;
          actor_id: string | null;
          actor_role: Database["public"]["Enums"]["app_role"] | null;
          after: Json | null;
          at: string;
          before: Json | null;
          chain_no: number;
          entity_id: string | null;
          entity_type: string;
          hash: string;
          id: string;
          ip: unknown;
          prev_hash: string;
          audit_row_digest: string | null;
        };
        ComputedFields: "audit_row_digest";
        Insert: {
          action: string;
          actor_id?: string | null;
          actor_role?: Database["public"]["Enums"]["app_role"] | null;
          after?: Json | null;
          at?: string;
          before?: Json | null;
          chain_no: number;
          entity_id?: string | null;
          entity_type: string;
          hash: string;
          id?: string;
          ip?: unknown;
          prev_hash: string;
        };
        Update: {
          action?: string;
          actor_id?: string | null;
          actor_role?: Database["public"]["Enums"]["app_role"] | null;
          after?: Json | null;
          at?: string;
          before?: Json | null;
          chain_no?: number;
          entity_id?: string | null;
          entity_type?: string;
          hash?: string;
          id?: string;
          ip?: unknown;
          prev_hash?: string;
        };
        Relationships: [
          {
            foreignKeyName: "audit_log_actor_id_fkey";
            columns: ["actor_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      branches: {
        Row: {
          active: boolean;
          address: string | null;
          code: string;
          created_at: string;
          created_by: string | null;
          id: string;
          name: string;
          phone: string | null;
          updated_at: string;
          updated_by: string | null;
        };
        ComputedFields: never;
        Insert: {
          active?: boolean;
          address?: string | null;
          code: string;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          name: string;
          phone?: string | null;
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          active?: boolean;
          address?: string | null;
          code?: string;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          name?: string;
          phone?: string | null;
          updated_at?: string;
          updated_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "branches_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "branches_updated_by_fkey";
            columns: ["updated_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      document_sequences: {
        Row: {
          branch_id: string;
          kind: string;
          last_value: number;
        };
        ComputedFields: never;
        Insert: {
          branch_id: string;
          kind: string;
          last_value?: number;
        };
        Update: {
          branch_id?: string;
          kind?: string;
          last_value?: number;
        };
        Relationships: [];
      };
      hash_chains: {
        Row: {
          chain: string;
          last_hash: string;
          last_no: number;
        };
        ComputedFields: never;
        Insert: {
          chain: string;
          last_hash: string;
          last_no: number;
        };
        Update: {
          chain?: string;
          last_hash?: string;
          last_no?: number;
        };
        Relationships: [];
      };
      profiles: {
        Row: {
          active: boolean;
          branch_id: string | null;
          created_at: string;
          created_by: string | null;
          full_name: string;
          id: string;
          phone: string | null;
          role: Database["public"]["Enums"]["app_role"];
          updated_at: string;
          updated_by: string | null;
        };
        ComputedFields: never;
        Insert: {
          active?: boolean;
          branch_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          full_name: string;
          id: string;
          phone?: string | null;
          role: Database["public"]["Enums"]["app_role"];
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          active?: boolean;
          branch_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          full_name?: string;
          id?: string;
          phone?: string | null;
          role?: Database["public"]["Enums"]["app_role"];
          updated_at?: string;
          updated_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "profiles_branch_id_fkey";
            columns: ["branch_id"];
            isOneToOne: false;
            referencedRelation: "branches";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "profiles_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "profiles_updated_by_fkey";
            columns: ["updated_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      settings: {
        Row: {
          key: string;
          updated_at: string;
          updated_by: string | null;
          value: NonNullable<Json>;
        };
        ComputedFields: never;
        Insert: {
          key: string;
          updated_at?: string;
          updated_by?: string | null;
          value: NonNullable<Json>;
        };
        Update: {
          key?: string;
          updated_at?: string;
          updated_by?: string | null;
          value?: NonNullable<Json>;
        };
        Relationships: [
          {
            foreignKeyName: "settings_updated_by_fkey";
            columns: ["updated_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      admin_record_password_reset: { Args: { p_user_id: string }; Returns: undefined };
      admin_set_profile: {
        Args: {
          p_active: boolean;
          p_branch_id: string;
          p_full_name: string;
          p_phone: string;
          p_role: Database["public"]["Enums"]["app_role"];
          p_user_id: string;
        };
        Returns: undefined;
      };
      app_now: { Args: Record<PropertyKey, never>; Returns: string };
      audit_row_digest: {
        Args: {
          p: Omit<
            Database["public"]["Tables"]["audit_log"]["Row"],
            Database["public"]["Tables"]["audit_log"]["ComputedFields"]
          >;
        };
        Returns: string;
      };
      auth_branch: { Args: Record<PropertyKey, never>; Returns: string };
      auth_role: { Args: Record<PropertyKey, never>; Returns: Database["public"]["Enums"]["app_role"] };
      business_today: { Args: Record<PropertyKey, never>; Returns: string };
      chain_genesis: { Args: { p_chain: string }; Returns: string };
      clock_override_allowed: { Args: Record<PropertyKey, never>; Returns: boolean };
      environment_kind: { Args: Record<PropertyKey, never>; Returns: string };
      is_staff: { Args: Record<PropertyKey, never>; Returns: boolean };
      jsonb_is_short_text: { Args: { p: Json; p_max: number }; Returns: boolean };
      jsonb_is_whole_number: { Args: { p: Json }; Returns: boolean };
      public_branding: { Args: Record<PropertyKey, never>; Returns: Json };
      require_role: {
        Args: { p_roles: Database["public"]["Enums"]["app_role"][] };
        Returns: Database["public"]["Enums"]["app_role"];
      };
      setting_error: { Args: { p_key: string; p_problem: string }; Returns: undefined };
      update_setting: { Args: { p_key: string; p_value: Json }; Returns: Json };
      upsert_branch: { Args: { p_branch: Json }; Returns: string };
      validate_setting: { Args: { p_key: string; p_value: Json }; Returns: undefined };
      verify_audit_chain: { Args: Record<PropertyKey, never>; Returns: number };
      write_audit: {
        Args: { p_action: string; p_after: Json; p_before: Json; p_entity_id: string; p_entity_type: string };
        Returns: undefined;
      };
    };
    Enums: {
      app_role: "admin" | "ceo" | "manager" | "accountant" | "cashier" | "loan_officer";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    keyof (DefaultSchema["Tables"] & DefaultSchema["Views"]) | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema["CompositeTypes"] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "ceo", "manager", "accountant", "cashier", "loan_officer"],
    },
  },
} as const;
