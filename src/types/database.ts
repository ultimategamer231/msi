export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: {
      accounts: {
        Row: {
          active: boolean;
          branch_id: string | null;
          code: string;
          created_at: string;
          id: string;
          is_cash: boolean;
          name: string;
          type: Database["public"]["Enums"]["account_type"];
        };
        ComputedFields: never;
        Insert: {
          active?: boolean;
          branch_id?: string | null;
          code: string;
          created_at?: string;
          id?: string;
          is_cash?: boolean;
          name: string;
          type: Database["public"]["Enums"]["account_type"];
        };
        Update: {
          active?: boolean;
          branch_id?: string | null;
          code?: string;
          created_at?: string;
          id?: string;
          is_cash?: boolean;
          name?: string;
          type?: Database["public"]["Enums"]["account_type"];
        };
        Relationships: [
          {
            foreignKeyName: "accounts_branch_id_fkey";
            columns: ["branch_id"];
            isOneToOne: false;
            referencedRelation: "branches";
            referencedColumns: ["id"];
          },
        ];
      };
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
      approval_requests: {
        Row: {
          decided_at: string | null;
          decided_by: string | null;
          decision_note: string | null;
          entity_id: string | null;
          entity_type: string;
          id: string;
          payload: NonNullable<Json>;
          reason: string | null;
          requested_at: string;
          requested_by: string;
          required_role: Database["public"]["Enums"]["app_role"];
          status: string;
          type: string;
          apply_customer_edit: Json | null;
        };
        ComputedFields: "apply_customer_edit";
        Insert: {
          decided_at?: string | null;
          decided_by?: string | null;
          decision_note?: string | null;
          entity_id?: string | null;
          entity_type: string;
          id?: string;
          payload: NonNullable<Json>;
          reason?: string | null;
          requested_at?: string;
          requested_by: string;
          required_role: Database["public"]["Enums"]["app_role"];
          status?: string;
          type: string;
        };
        Update: {
          decided_at?: string | null;
          decided_by?: string | null;
          decision_note?: string | null;
          entity_id?: string | null;
          entity_type?: string;
          id?: string;
          payload?: NonNullable<Json>;
          reason?: string | null;
          requested_at?: string;
          requested_by?: string;
          required_role?: Database["public"]["Enums"]["app_role"];
          status?: string;
          type?: string;
        };
        Relationships: [
          {
            foreignKeyName: "approval_requests_decided_by_fkey";
            columns: ["decided_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "approval_requests_requested_by_fkey";
            columns: ["requested_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      attachments: {
        Row: {
          created_at: string;
          created_by: string;
          entity_id: string;
          entity_type: string;
          file_name: string;
          id: string;
          kind: string;
          mime: string;
          size_bytes: number;
          storage_path: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          created_by: string;
          entity_id: string;
          entity_type: string;
          file_name: string;
          id?: string;
          kind: string;
          mime: string;
          size_bytes: number;
          storage_path: string;
        };
        Update: {
          created_at?: string;
          created_by?: string;
          entity_id?: string;
          entity_type?: string;
          file_name?: string;
          id?: string;
          kind?: string;
          mime?: string;
          size_bytes?: number;
          storage_path?: string;
        };
        Relationships: [
          {
            foreignKeyName: "attachments_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
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
      customers: {
        Row: {
          address: string | null;
          assigned_officer_id: string | null;
          branch_id: string;
          business_name: string | null;
          city: string | null;
          code: string;
          contact_person: string | null;
          created_at: string;
          created_by: string;
          date_of_birth: string | null;
          employer_or_business: string | null;
          first_name: string | null;
          id: string;
          id_number: string | null;
          id_number_key: string | null;
          id_type: string | null;
          last_name: string | null;
          next_of_kin_name: string | null;
          next_of_kin_phone: string | null;
          next_of_kin_relation: string | null;
          notes: string | null;
          occupation: string | null;
          phone: string;
          phone_alt: string | null;
          phone_alt_key: string | null;
          phone_key: string | null;
          photo_path: string | null;
          registration_no: string | null;
          search_text: string | null;
          status: string;
          type: string;
          customer_display_name: string | null;
          validate_customer: undefined | null;
        };
        ComputedFields: "customer_display_name" | "validate_customer";
        Insert: {
          address?: string | null;
          assigned_officer_id?: string | null;
          branch_id: string;
          business_name?: string | null;
          city?: string | null;
          code: string;
          contact_person?: string | null;
          created_at?: string;
          created_by: string;
          date_of_birth?: string | null;
          employer_or_business?: string | null;
          first_name?: string | null;
          id?: string;
          id_number?: string | null;
          id_number_key?: never;
          id_type?: string | null;
          last_name?: string | null;
          next_of_kin_name?: string | null;
          next_of_kin_phone?: string | null;
          next_of_kin_relation?: string | null;
          notes?: string | null;
          occupation?: string | null;
          phone: string;
          phone_alt?: string | null;
          phone_alt_key?: never;
          phone_key?: never;
          photo_path?: string | null;
          registration_no?: string | null;
          search_text?: never;
          status?: string;
          type: string;
        };
        Update: {
          address?: string | null;
          assigned_officer_id?: string | null;
          branch_id?: string;
          business_name?: string | null;
          city?: string | null;
          code?: string;
          contact_person?: string | null;
          created_at?: string;
          created_by?: string;
          date_of_birth?: string | null;
          employer_or_business?: string | null;
          first_name?: string | null;
          id?: string;
          id_number?: string | null;
          id_number_key?: never;
          id_type?: string | null;
          last_name?: string | null;
          next_of_kin_name?: string | null;
          next_of_kin_phone?: string | null;
          next_of_kin_relation?: string | null;
          notes?: string | null;
          occupation?: string | null;
          phone?: string;
          phone_alt?: string | null;
          phone_alt_key?: never;
          phone_key?: never;
          photo_path?: string | null;
          registration_no?: string | null;
          search_text?: never;
          status?: string;
          type?: string;
        };
        Relationships: [
          {
            foreignKeyName: "customers_assigned_officer_id_fkey";
            columns: ["assigned_officer_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "customers_branch_id_fkey";
            columns: ["branch_id"];
            isOneToOne: false;
            referencedRelation: "branches";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "customers_created_by_fkey";
            columns: ["created_by"];
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
      guarantors: {
        Row: {
          address: string | null;
          created_at: string;
          created_by: string;
          doc_path: string | null;
          full_name: string;
          id: string;
          id_number: string | null;
          id_type: string | null;
          loan_id: string;
          phone: string;
          relationship: string | null;
        };
        ComputedFields: never;
        Insert: {
          address?: string | null;
          created_at?: string;
          created_by: string;
          doc_path?: string | null;
          full_name: string;
          id?: string;
          id_number?: string | null;
          id_type?: string | null;
          loan_id: string;
          phone: string;
          relationship?: string | null;
        };
        Update: {
          address?: string | null;
          created_at?: string;
          created_by?: string;
          doc_path?: string | null;
          full_name?: string;
          id?: string;
          id_number?: string | null;
          id_type?: string | null;
          loan_id?: string;
          phone?: string;
          relationship?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "guarantors_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
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
      journal_lines: {
        Row: {
          account_id: string;
          component: string | null;
          credit_cents: number;
          currency: string;
          customer_id: string | null;
          debit_cents: number;
          fx_rate_micros: number;
          id: string;
          journal_id: string;
          line_no: number;
          loan_id: string | null;
          payee_id: string | null;
          staff_id: string | null;
        };
        ComputedFields: never;
        Insert: {
          account_id: string;
          component?: string | null;
          credit_cents?: number;
          currency?: string;
          customer_id?: string | null;
          debit_cents?: number;
          fx_rate_micros?: number;
          id?: string;
          journal_id: string;
          line_no: number;
          loan_id?: string | null;
          payee_id?: string | null;
          staff_id?: string | null;
        };
        Update: {
          account_id?: string;
          component?: string | null;
          credit_cents?: number;
          currency?: string;
          customer_id?: string | null;
          debit_cents?: number;
          fx_rate_micros?: number;
          id?: string;
          journal_id?: string;
          line_no?: number;
          loan_id?: string | null;
          payee_id?: string | null;
          staff_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "journal_lines_account_id_fkey";
            columns: ["account_id"];
            isOneToOne: false;
            referencedRelation: "accounts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "journal_lines_journal_id_fkey";
            columns: ["journal_id"];
            isOneToOne: false;
            referencedRelation: "journals";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "journal_lines_staff_id_fkey";
            columns: ["staff_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      journals: {
        Row: {
          branch_id: string | null;
          chain_no: number;
          content_hash: string;
          entry_date: string;
          hash: string;
          id: string;
          journal_no: string;
          memo: string;
          posted_at: string;
          posted_by: string | null;
          posted_txid: number;
          prev_hash: string;
          reversal_of: string | null;
          source_id: string | null;
          source_type: string;
        };
        ComputedFields: never;
        Insert: {
          branch_id?: string | null;
          chain_no: number;
          content_hash: string;
          entry_date: string;
          hash: string;
          id?: string;
          journal_no: string;
          memo: string;
          posted_at?: string;
          posted_by?: string | null;
          posted_txid?: number;
          prev_hash: string;
          reversal_of?: string | null;
          source_id?: string | null;
          source_type: string;
        };
        Update: {
          branch_id?: string | null;
          chain_no?: number;
          content_hash?: string;
          entry_date?: string;
          hash?: string;
          id?: string;
          journal_no?: string;
          memo?: string;
          posted_at?: string;
          posted_by?: string | null;
          posted_txid?: number;
          prev_hash?: string;
          reversal_of?: string | null;
          source_id?: string | null;
          source_type?: string;
        };
        Relationships: [
          {
            foreignKeyName: "journals_branch_id_fkey";
            columns: ["branch_id"];
            isOneToOne: false;
            referencedRelation: "branches";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "journals_posted_by_fkey";
            columns: ["posted_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "journals_reversal_of_fkey";
            columns: ["reversal_of"];
            isOneToOne: true;
            referencedRelation: "journals";
            referencedColumns: ["id"];
          },
        ];
      };
      period_locks: {
        Row: {
          branch_id: string;
          locked_at: string;
          locked_by: string | null;
          locked_through: string;
        };
        ComputedFields: never;
        Insert: {
          branch_id: string;
          locked_at?: string;
          locked_by?: string | null;
          locked_through: string;
        };
        Update: {
          branch_id?: string;
          locked_at?: string;
          locked_by?: string | null;
          locked_through?: string;
        };
        Relationships: [
          {
            foreignKeyName: "period_locks_branch_id_fkey";
            columns: ["branch_id"];
            isOneToOne: true;
            referencedRelation: "branches";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "period_locks_locked_by_fkey";
            columns: ["locked_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
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
      account_component: { Args: { p_code: string }; Returns: string };
      add_customer_documents: { Args: { p_customer_id: string; p_files: Json }; Returns: undefined };
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
      apply_customer_edit: {
        Args: {
          p_request: Omit<
            Database["public"]["Tables"]["approval_requests"]["Row"],
            Database["public"]["Tables"]["approval_requests"]["ComputedFields"]
          >;
        };
        Returns: Json;
      };
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
      claim_upload: { Args: { p_images_only?: boolean; p_path: string }; Returns: Json };
      clean_guarantors: { Args: { p_guarantors: Json }; Returns: Json };
      clock_override_allowed: { Args: Record<PropertyKey, never>; Returns: boolean };
      create_customer: { Args: { p_customer: Json }; Returns: string };
      customer_clean: { Args: { p_input: Json }; Returns: Json };
      customer_display_name: {
        Args: {
          p_customer: Omit<
            Database["public"]["Tables"]["customers"]["Row"],
            Database["public"]["Tables"]["customers"]["ComputedFields"]
          >;
        };
        Returns: string;
      };
      customer_editable_fields: { Args: Record<PropertyKey, never>; Returns: string[] };
      decide_approval: { Args: { p_decision: string; p_id: string; p_note: string }; Returns: Json };
      environment_kind: { Args: Record<PropertyKey, never>; Returns: string };
      find_duplicate_customers: {
        Args: { p_exclude?: string; p_id_number: string; p_phone: string; p_phone_alt: string };
        Returns: Json;
      };
      global_sequence_branch: { Args: Record<PropertyKey, never>; Returns: string };
      guard_duplicate_customer: {
        Args: {
          p_override: boolean;
          p_override_reason: string;
          p_row: Omit<
            Database["public"]["Tables"]["customers"]["Row"],
            Database["public"]["Tables"]["customers"]["ComputedFields"]
          >;
        };
        Returns: Json;
      };
      id_number_key: { Args: { p_id: string }; Returns: string };
      is_staff: { Args: Record<PropertyKey, never>; Returns: boolean };
      journal_content_digest: {
        Args: {
          p_branch_id: string;
          p_entry_date: string;
          p_journal_no: string;
          p_lines: Json;
          p_memo: string;
          p_reversal_of: string;
          p_source_id: string;
          p_source_type: string;
        };
        Returns: string;
      };
      journal_lines_canonical: { Args: { p_journal_id: string }; Returns: Json };
      jsonb_is_short_text: { Args: { p: Json; p_max: number }; Returns: boolean };
      jsonb_is_whole_number: { Args: { p: Json }; Returns: boolean };
      link_attachments: {
        Args: { p_entity_id: string; p_entity_type: string; p_files: Json };
        Returns: Json;
      };
      next_number: { Args: { p_branch?: string; p_kind: string }; Returns: string };
      phone_key: { Args: { p_phone: string }; Returns: string };
      post_journal: {
        Args: {
          p_branch: string;
          p_date: string;
          p_lines: Json;
          p_memo: string;
          p_source_id: string;
          p_source_type: string;
        };
        Returns: string;
      };
      public_branding: { Args: Record<PropertyKey, never>; Returns: Json };
      request_capital_in: { Args: { p_request: Json }; Returns: string };
      request_customer_edit: {
        Args: { p_customer_id: string; p_patch: Json; p_reason: string };
        Returns: string;
      };
      request_manual_journal: { Args: { p_request: Json }; Returns: string };
      require_posting_date: { Args: { p_date: string }; Returns: undefined };
      require_role: {
        Args: { p_roles: Database["public"]["Enums"]["app_role"][] };
        Returns: Database["public"]["Enums"]["app_role"];
      };
      sequence_scope: { Args: { p_branch: string; p_kind: string }; Returns: string };
      set_sequence_start: {
        Args: { p_branch_id: string; p_kind: string; p_last_value: number };
        Returns: undefined;
      };
      setting_error: { Args: { p_key: string; p_problem: string }; Returns: undefined };
      trial_balance: {
        Args: { p_as_of: string };
        Returns: {
          account_id: string;
          code: string;
          credit_cents: number;
          debit_cents: number;
          name: string;
          type: Database["public"]["Enums"]["account_type"];
        }[];
      };
      update_setting: { Args: { p_key: string; p_value: Json }; Returns: Json };
      upsert_branch: { Args: { p_branch: Json }; Returns: string };
      validate_customer: {
        Args: {
          p_row: Omit<
            Database["public"]["Tables"]["customers"]["Row"],
            Database["public"]["Tables"]["customers"]["ComputedFields"]
          >;
        };
        Returns: undefined;
      };
      validate_setting: { Args: { p_key: string; p_value: Json }; Returns: undefined };
      verify_audit_chain: { Args: Record<PropertyKey, never>; Returns: number };
      verify_journal_chain: { Args: Record<PropertyKey, never>; Returns: number };
      write_audit: {
        Args: { p_action: string; p_after: Json; p_before: Json; p_entity_id: string; p_entity_type: string };
        Returns: undefined;
      };
    };
    Enums: {
      account_type: "asset" | "liability" | "equity" | "income" | "expense";
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
      account_type: ["asset", "liability", "equity", "income", "expense"],
      app_role: ["admin", "ceo", "manager", "accountant", "cashier", "loan_officer"],
    },
  },
} as const;
