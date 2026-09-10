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
      admin_account_flags: {
        Row: {
          account_user_id: string
          created_at: string
          created_by: string | null
          flagged: boolean
          id: string
          note: string | null
          updated_at: string
        }
        Insert: {
          account_user_id: string
          created_at?: string
          created_by?: string | null
          flagged?: boolean
          id?: string
          note?: string | null
          updated_at?: string
        }
        Update: {
          account_user_id?: string
          created_at?: string
          created_by?: string | null
          flagged?: boolean
          id?: string
          note?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      agency_portal_access: {
        Row: {
          access_count: number
          access_token: string
          contact_email: string
          contact_name: string | null
          contract_id: string
          created_at: string
          expires_at: string | null
          id: string
          last_accessed_at: string | null
          status: string
          user_id: string
        }
        Insert: {
          access_count?: number
          access_token: string
          contact_email: string
          contact_name?: string | null
          contract_id: string
          created_at?: string
          expires_at?: string | null
          id?: string
          last_accessed_at?: string | null
          status?: string
          user_id: string
        }
        Update: {
          access_count?: number
          access_token?: string
          contact_email?: string
          contact_name?: string | null
          contract_id?: string
          created_at?: string
          expires_at?: string | null
          id?: string
          last_accessed_at?: string | null
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agency_portal_access_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "compliance_contracts"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_job_log: {
        Row: {
          completed_at: string | null
          duration_ms: number | null
          error_message: string | null
          estimated_cost_usd: number | null
          id: string
          input_tokens: number | null
          job_type: string
          model_used: string | null
          output_tokens: number | null
          related_entity_id: string | null
          related_entity_type: string | null
          request_summary: Json | null
          started_at: string
          status: string
          user_id: string | null
        }
        Insert: {
          completed_at?: string | null
          duration_ms?: number | null
          error_message?: string | null
          estimated_cost_usd?: number | null
          id?: string
          input_tokens?: number | null
          job_type: string
          model_used?: string | null
          output_tokens?: number | null
          related_entity_id?: string | null
          related_entity_type?: string | null
          request_summary?: Json | null
          started_at?: string
          status?: string
          user_id?: string | null
        }
        Update: {
          completed_at?: string | null
          duration_ms?: number | null
          error_message?: string | null
          estimated_cost_usd?: number | null
          id?: string
          input_tokens?: number | null
          job_type?: string
          model_used?: string | null
          output_tokens?: number | null
          related_entity_id?: string | null
          related_entity_type?: string | null
          request_summary?: Json | null
          started_at?: string
          status?: string
          user_id?: string | null
        }
        Relationships: []
      }
      api_rate_log: {
        Row: {
          action: string
          created_at: string
          id: string
          user_id: string
        }
        Insert: {
          action: string
          created_at?: string
          id?: string
          user_id: string
        }
        Update: {
          action?: string
          created_at?: string
          id?: string
          user_id?: string
        }
        Relationships: []
      }
      audit_packages: {
        Row: {
          contract_id: string
          created_at: string
          expires_at: string | null
          file_url: string | null
          format: string
          id: string
          open_count: number
          opened_at: string | null
          recipient_agency: string | null
          recipient_name: string | null
          share_link_token: string | null
          snapshot: Json | null
          storage_path: string | null
          user_id: string
        }
        Insert: {
          contract_id: string
          created_at?: string
          expires_at?: string | null
          file_url?: string | null
          format?: string
          id?: string
          open_count?: number
          opened_at?: string | null
          recipient_agency?: string | null
          recipient_name?: string | null
          share_link_token?: string | null
          snapshot?: Json | null
          storage_path?: string | null
          user_id: string
        }
        Update: {
          contract_id?: string
          created_at?: string
          expires_at?: string | null
          file_url?: string | null
          format?: string
          id?: string
          open_count?: number
          opened_at?: string | null
          recipient_agency?: string | null
          recipient_name?: string | null
          share_link_token?: string | null
          snapshot?: Json | null
          storage_path?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_packages_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "compliance_contracts"
            referencedColumns: ["id"]
          },
        ]
      }
      client_workspaces: {
        Row: {
          archived: boolean
          city: string | null
          client_name: string
          country: string
          created_at: string
          focus_areas: string[]
          funding_amount_max: number | null
          funding_amount_min: number | null
          id: string
          mission: string | null
          notes: string | null
          operating_states: string[]
          org_type: string | null
          populations_served: string[]
          state: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          archived?: boolean
          city?: string | null
          client_name: string
          country?: string
          created_at?: string
          focus_areas?: string[]
          funding_amount_max?: number | null
          funding_amount_min?: number | null
          id?: string
          mission?: string | null
          notes?: string | null
          operating_states?: string[]
          org_type?: string | null
          populations_served?: string[]
          state?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          archived?: boolean
          city?: string | null
          client_name?: string
          country?: string
          created_at?: string
          focus_areas?: string[]
          funding_amount_max?: number | null
          funding_amount_min?: number | null
          id?: string
          mission?: string | null
          notes?: string | null
          operating_states?: string[]
          org_type?: string | null
          populations_served?: string[]
          state?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      compliance_activity_log: {
        Row: {
          action: string
          contract_id: string
          created_at: string
          detail: string | null
          id: string
          new_value: string | null
          obligation_id: string | null
          old_value: string | null
          user_id: string
        }
        Insert: {
          action: string
          contract_id: string
          created_at?: string
          detail?: string | null
          id?: string
          new_value?: string | null
          obligation_id?: string | null
          old_value?: string | null
          user_id: string
        }
        Update: {
          action?: string
          contract_id?: string
          created_at?: string
          detail?: string | null
          id?: string
          new_value?: string | null
          obligation_id?: string | null
          old_value?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "compliance_activity_log_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "compliance_contracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "compliance_activity_log_obligation_id_fkey"
            columns: ["obligation_id"]
            isOneToOne: false
            referencedRelation: "compliance_obligations"
            referencedColumns: ["id"]
          },
        ]
      }
      compliance_budget_categories: {
        Row: {
          budgeted_amount: number
          cap_amount: number | null
          category_type: string
          contract_id: string
          created_at: string
          id: string
          name: string
          notes: string | null
          spent_amount: number
          updated_at: string
          user_id: string
        }
        Insert: {
          budgeted_amount?: number
          cap_amount?: number | null
          category_type?: string
          contract_id: string
          created_at?: string
          id?: string
          name: string
          notes?: string | null
          spent_amount?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          budgeted_amount?: number
          cap_amount?: number | null
          category_type?: string
          contract_id?: string
          created_at?: string
          id?: string
          name?: string
          notes?: string | null
          spent_amount?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "compliance_budget_categories_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "compliance_contracts"
            referencedColumns: ["id"]
          },
        ]
      }
      compliance_comments: {
        Row: {
          author_name: string | null
          body: string
          contract_id: string
          created_at: string
          id: string
          mentions: string[]
          obligation_id: string
          parent_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          author_name?: string | null
          body: string
          contract_id: string
          created_at?: string
          id?: string
          mentions?: string[]
          obligation_id: string
          parent_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          author_name?: string | null
          body?: string
          contract_id?: string
          created_at?: string
          id?: string
          mentions?: string[]
          obligation_id?: string
          parent_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "compliance_comments_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "compliance_contracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "compliance_comments_obligation_id_fkey"
            columns: ["obligation_id"]
            isOneToOne: false
            referencedRelation: "compliance_obligations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "compliance_comments_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "compliance_comments"
            referencedColumns: ["id"]
          },
        ]
      }
      compliance_contracts: {
        Row: {
          archived: boolean
          award_amount: number | null
          compensation_type: string
          contract_number: string | null
          contract_type: string
          created_at: string
          default_reminder_days: number[]
          extraction_error: string | null
          extraction_model: string | null
          extraction_status: string
          extraction_summary: string | null
          file_name: string | null
          funder: string
          grant_record_id: string | null
          health_score: number | null
          health_score_updated_at: string | null
          id: string
          invoicing_basis: string | null
          lump_sum_amount: number | null
          mime_type: string | null
          name: string
          owner_name: string | null
          period_end: string | null
          period_start: string | null
          raw_extraction: Json | null
          raw_extraction_saved_at: string | null
          reimbursable_cap: number | null
          reimbursable_multiplier: number | null
          size_bytes: number | null
          status: string
          storage_path: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          archived?: boolean
          award_amount?: number | null
          compensation_type?: string
          contract_number?: string | null
          contract_type?: string
          created_at?: string
          default_reminder_days?: number[]
          extraction_error?: string | null
          extraction_model?: string | null
          extraction_status?: string
          extraction_summary?: string | null
          file_name?: string | null
          funder?: string
          grant_record_id?: string | null
          health_score?: number | null
          health_score_updated_at?: string | null
          id?: string
          invoicing_basis?: string | null
          lump_sum_amount?: number | null
          mime_type?: string | null
          name: string
          owner_name?: string | null
          period_end?: string | null
          period_start?: string | null
          raw_extraction?: Json | null
          raw_extraction_saved_at?: string | null
          reimbursable_cap?: number | null
          reimbursable_multiplier?: number | null
          size_bytes?: number | null
          status?: string
          storage_path?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          archived?: boolean
          award_amount?: number | null
          compensation_type?: string
          contract_number?: string | null
          contract_type?: string
          created_at?: string
          default_reminder_days?: number[]
          extraction_error?: string | null
          extraction_model?: string | null
          extraction_status?: string
          extraction_summary?: string | null
          file_name?: string | null
          funder?: string
          grant_record_id?: string | null
          health_score?: number | null
          health_score_updated_at?: string | null
          id?: string
          invoicing_basis?: string | null
          lump_sum_amount?: number | null
          mime_type?: string | null
          name?: string
          owner_name?: string | null
          period_end?: string | null
          period_start?: string | null
          raw_extraction?: Json | null
          raw_extraction_saved_at?: string | null
          reimbursable_cap?: number | null
          reimbursable_multiplier?: number | null
          size_bytes?: number | null
          status?: string
          storage_path?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "compliance_contracts_grant_record_id_fkey"
            columns: ["grant_record_id"]
            isOneToOne: false
            referencedRelation: "grant_records"
            referencedColumns: ["id"]
          },
        ]
      }
      compliance_deliverable_progress: {
        Row: {
          created_at: string
          id: string
          note: string | null
          obligation_id: string
          percent_complete: number
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          note?: string | null
          obligation_id: string
          percent_complete?: number
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          note?: string | null
          obligation_id?: string
          percent_complete?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "compliance_deliverable_progress_obligation_id_fkey"
            columns: ["obligation_id"]
            isOneToOne: false
            referencedRelation: "compliance_obligations"
            referencedColumns: ["id"]
          },
        ]
      }
      compliance_documents: {
        Row: {
          contract_id: string
          created_at: string
          document_type: string
          id: string
          mime_type: string | null
          name: string
          obligation_id: string | null
          size_bytes: number | null
          storage_path: string
          updated_at: string
          user_id: string
        }
        Insert: {
          contract_id: string
          created_at?: string
          document_type?: string
          id?: string
          mime_type?: string | null
          name: string
          obligation_id?: string | null
          size_bytes?: number | null
          storage_path: string
          updated_at?: string
          user_id: string
        }
        Update: {
          contract_id?: string
          created_at?: string
          document_type?: string
          id?: string
          mime_type?: string | null
          name?: string
          obligation_id?: string | null
          size_bytes?: number | null
          storage_path?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "compliance_documents_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "compliance_contracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "compliance_documents_obligation_id_fkey"
            columns: ["obligation_id"]
            isOneToOne: false
            referencedRelation: "compliance_obligations"
            referencedColumns: ["id"]
          },
        ]
      }
      compliance_extraction_runs: {
        Row: {
          contract_id: string
          created_at: string
          extraction: Json
          id: string
          is_original: boolean
          model: string | null
          source_label: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          contract_id: string
          created_at?: string
          extraction: Json
          id?: string
          is_original?: boolean
          model?: string | null
          source_label?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          contract_id?: string
          created_at?: string
          extraction?: Json
          id?: string
          is_original?: boolean
          model?: string | null
          source_label?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "compliance_extraction_runs_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "compliance_contracts"
            referencedColumns: ["id"]
          },
        ]
      }
      compliance_invoices: {
        Row: {
          contract_id: string
          created_at: string
          fee_amount: number
          id: string
          invoice_number: string | null
          issued_date: string | null
          notes: string | null
          paid_date: string | null
          percent_complete: number
          period_end: string | null
          period_start: string | null
          reimbursables_amount: number
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          contract_id: string
          created_at?: string
          fee_amount?: number
          id?: string
          invoice_number?: string | null
          issued_date?: string | null
          notes?: string | null
          paid_date?: string | null
          percent_complete?: number
          period_end?: string | null
          period_start?: string | null
          reimbursables_amount?: number
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          contract_id?: string
          created_at?: string
          fee_amount?: number
          id?: string
          invoice_number?: string | null
          issued_date?: string | null
          notes?: string | null
          paid_date?: string | null
          percent_complete?: number
          period_end?: string | null
          period_start?: string | null
          reimbursables_amount?: number
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "compliance_invoices_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "compliance_contracts"
            referencedColumns: ["id"]
          },
        ]
      }
      compliance_obligations: {
        Row: {
          amount: number | null
          assignee_email: string | null
          assignee_name: string | null
          category: string
          completed_at: string | null
          completed_by: string | null
          completion_notes: string | null
          confidence: number | null
          confirmed: boolean
          contract_id: string
          created_at: string
          cycles_completed: number
          cycles_on_time: number
          description: string | null
          due_date: string | null
          extraction_index: number | null
          extraction_source: string
          id: string
          next_due_date: string | null
          notes: string | null
          original_ai_due_date: string | null
          original_ai_text: string | null
          percent_complete: number
          prior_approval_required: boolean
          priority: string
          recurrence: string
          recurrence_rule: string | null
          reminder_days: number[] | null
          reminders_silenced: boolean
          series_ended: boolean
          snoozed_until: string | null
          sort_order: number
          source_page: number | null
          source_quote: string | null
          status: string
          submission_confirmation: string | null
          submit_to_address: string | null
          submit_to_email: string | null
          submit_to_name: string | null
          title: string
          updated_at: string
          user_id: string
          user_review_action: string | null
        }
        Insert: {
          amount?: number | null
          assignee_email?: string | null
          assignee_name?: string | null
          category?: string
          completed_at?: string | null
          completed_by?: string | null
          completion_notes?: string | null
          confidence?: number | null
          confirmed?: boolean
          contract_id: string
          created_at?: string
          cycles_completed?: number
          cycles_on_time?: number
          description?: string | null
          due_date?: string | null
          extraction_index?: number | null
          extraction_source?: string
          id?: string
          next_due_date?: string | null
          notes?: string | null
          original_ai_due_date?: string | null
          original_ai_text?: string | null
          percent_complete?: number
          prior_approval_required?: boolean
          priority?: string
          recurrence?: string
          recurrence_rule?: string | null
          reminder_days?: number[] | null
          reminders_silenced?: boolean
          series_ended?: boolean
          snoozed_until?: string | null
          sort_order?: number
          source_page?: number | null
          source_quote?: string | null
          status?: string
          submission_confirmation?: string | null
          submit_to_address?: string | null
          submit_to_email?: string | null
          submit_to_name?: string | null
          title: string
          updated_at?: string
          user_id: string
          user_review_action?: string | null
        }
        Update: {
          amount?: number | null
          assignee_email?: string | null
          assignee_name?: string | null
          category?: string
          completed_at?: string | null
          completed_by?: string | null
          completion_notes?: string | null
          confidence?: number | null
          confirmed?: boolean
          contract_id?: string
          created_at?: string
          cycles_completed?: number
          cycles_on_time?: number
          description?: string | null
          due_date?: string | null
          extraction_index?: number | null
          extraction_source?: string
          id?: string
          next_due_date?: string | null
          notes?: string | null
          original_ai_due_date?: string | null
          original_ai_text?: string | null
          percent_complete?: number
          prior_approval_required?: boolean
          priority?: string
          recurrence?: string
          recurrence_rule?: string | null
          reminder_days?: number[] | null
          reminders_silenced?: boolean
          series_ended?: boolean
          snoozed_until?: string | null
          sort_order?: number
          source_page?: number | null
          source_quote?: string | null
          status?: string
          submission_confirmation?: string | null
          submit_to_address?: string | null
          submit_to_email?: string | null
          submit_to_name?: string | null
          title?: string
          updated_at?: string
          user_id?: string
          user_review_action?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "compliance_obligations_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "compliance_contracts"
            referencedColumns: ["id"]
          },
        ]
      }
      compliance_rate_cards: {
        Row: {
          contract_id: string
          created_at: string
          effective_through: string | null
          hourly_rate: number
          id: string
          labor_category: string
          level: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          contract_id: string
          created_at?: string
          effective_through?: string | null
          hourly_rate: number
          id?: string
          labor_category: string
          level?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          contract_id?: string
          created_at?: string
          effective_through?: string | null
          hourly_rate?: number
          id?: string
          labor_category?: string
          level?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "compliance_rate_cards_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "compliance_contracts"
            referencedColumns: ["id"]
          },
        ]
      }
      compliance_task_assignees: {
        Row: {
          assigned_at: string
          contract_id: string
          id: string
          member_email: string | null
          member_name: string
          obligation_id: string
          user_id: string
        }
        Insert: {
          assigned_at?: string
          contract_id: string
          id?: string
          member_email?: string | null
          member_name: string
          obligation_id: string
          user_id: string
        }
        Update: {
          assigned_at?: string
          contract_id?: string
          id?: string
          member_email?: string | null
          member_name?: string
          obligation_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "compliance_task_assignees_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "compliance_contracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "compliance_task_assignees_obligation_id_fkey"
            columns: ["obligation_id"]
            isOneToOne: false
            referencedRelation: "compliance_obligations"
            referencedColumns: ["id"]
          },
        ]
      }
      compliance_team_members: {
        Row: {
          contract_id: string
          created_at: string
          id: string
          invited_at: string
          member_email: string
          member_name: string
          member_role: string
          user_id: string
        }
        Insert: {
          contract_id: string
          created_at?: string
          id?: string
          invited_at?: string
          member_email: string
          member_name: string
          member_role?: string
          user_id: string
        }
        Update: {
          contract_id?: string
          created_at?: string
          id?: string
          invited_at?: string
          member_email?: string
          member_name?: string
          member_role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "compliance_team_members_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "compliance_contracts"
            referencedColumns: ["id"]
          },
        ]
      }
      email_report_log: {
        Row: {
          created_at: string
          error: string | null
          id: string
          opportunity_count: number
          recipient: string
          status: string
          subject: string
          trigger_source: string
          user_id: string
        }
        Insert: {
          created_at?: string
          error?: string | null
          id?: string
          opportunity_count?: number
          recipient: string
          status?: string
          subject: string
          trigger_source?: string
          user_id: string
        }
        Update: {
          created_at?: string
          error?: string | null
          id?: string
          opportunity_count?: number
          recipient?: string
          status?: string
          subject?: string
          trigger_source?: string
          user_id?: string
        }
        Relationships: []
      }
      email_report_settings: {
        Row: {
          created_at: string
          enabled: boolean
          frequency: string
          last_sent_at: string | null
          min_fit_score: number
          next_send_at: string | null
          recipients: string[]
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          frequency?: string
          last_sent_at?: string | null
          min_fit_score?: number
          next_send_at?: string | null
          recipients?: string[]
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          enabled?: boolean
          frequency?: string
          last_sent_at?: string | null
          min_fit_score?: number
          next_send_at?: string | null
          recipients?: string[]
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      evidence_vault_files: {
        Row: {
          category: string | null
          citation_id: string | null
          compliance_cycle: string | null
          contract_id: string
          created_at: string
          document_type: string
          file_hash: string | null
          file_name: string
          id: string
          mime_type: string | null
          notes: string | null
          obligation_id: string | null
          size_bytes: number | null
          storage_path: string
          submission_confirmation: string | null
          upload_timestamp: string
          uploaded_by_name: string | null
          user_id: string
        }
        Insert: {
          category?: string | null
          citation_id?: string | null
          compliance_cycle?: string | null
          contract_id: string
          created_at?: string
          document_type?: string
          file_hash?: string | null
          file_name: string
          id?: string
          mime_type?: string | null
          notes?: string | null
          obligation_id?: string | null
          size_bytes?: number | null
          storage_path: string
          submission_confirmation?: string | null
          upload_timestamp?: string
          uploaded_by_name?: string | null
          user_id: string
        }
        Update: {
          category?: string | null
          citation_id?: string | null
          compliance_cycle?: string | null
          contract_id?: string
          created_at?: string
          document_type?: string
          file_hash?: string | null
          file_name?: string
          id?: string
          mime_type?: string | null
          notes?: string | null
          obligation_id?: string | null
          size_bytes?: number | null
          storage_path?: string
          submission_confirmation?: string | null
          upload_timestamp?: string
          uploaded_by_name?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "evidence_vault_files_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "compliance_contracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "evidence_vault_files_obligation_id_fkey"
            columns: ["obligation_id"]
            isOneToOne: false
            referencedRelation: "compliance_obligations"
            referencedColumns: ["id"]
          },
        ]
      }
      funding_scan_runs: {
        Row: {
          created_at: string
          frequency: string
          id: string
          matches_found: number
          new_matches: number
          scan_type: string
          user_id: string
          workspace_id: string | null
        }
        Insert: {
          created_at?: string
          frequency?: string
          id?: string
          matches_found?: number
          new_matches?: number
          scan_type?: string
          user_id: string
          workspace_id?: string | null
        }
        Update: {
          created_at?: string
          frequency?: string
          id?: string
          matches_found?: number
          new_matches?: number
          scan_type?: string
          user_id?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "funding_scan_runs_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "client_workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      funding_sources: {
        Row: {
          active: boolean
          api_available: boolean
          api_documentation: string | null
          api_endpoint: string | null
          api_key_required: boolean
          authentication_type: string | null
          cities_served: string[]
          city: string | null
          counties_served: string[]
          country: string
          county: string | null
          crawl_frequency: string | null
          crawler_available: boolean
          created_at: string
          error_status: string | null
          feed_type: string | null
          feed_url: string | null
          funding_page: string | null
          geographic_coverage_description: string | null
          id: string
          last_successful_sync: string | null
          last_sync: string | null
          nationwide: boolean
          next_crawl: string | null
          notes: string | null
          opportunities_found: number
          organization_name: string
          organization_type: string
          region: string | null
          robots_status: string | null
          search_terms: string[]
          source_level: string
          source_name: string
          source_priority: number
          source_reliability: number
          state: string | null
          states_served: string[]
          structured_feed_available: boolean
          updated_at: string
          website: string | null
        }
        Insert: {
          active?: boolean
          api_available?: boolean
          api_documentation?: string | null
          api_endpoint?: string | null
          api_key_required?: boolean
          authentication_type?: string | null
          cities_served?: string[]
          city?: string | null
          counties_served?: string[]
          country?: string
          county?: string | null
          crawl_frequency?: string | null
          crawler_available?: boolean
          created_at?: string
          error_status?: string | null
          feed_type?: string | null
          feed_url?: string | null
          funding_page?: string | null
          geographic_coverage_description?: string | null
          id?: string
          last_successful_sync?: string | null
          last_sync?: string | null
          nationwide?: boolean
          next_crawl?: string | null
          notes?: string | null
          opportunities_found?: number
          organization_name: string
          organization_type?: string
          region?: string | null
          robots_status?: string | null
          search_terms?: string[]
          source_level?: string
          source_name: string
          source_priority?: number
          source_reliability?: number
          state?: string | null
          states_served?: string[]
          structured_feed_available?: boolean
          updated_at?: string
          website?: string | null
        }
        Update: {
          active?: boolean
          api_available?: boolean
          api_documentation?: string | null
          api_endpoint?: string | null
          api_key_required?: boolean
          authentication_type?: string | null
          cities_served?: string[]
          city?: string | null
          counties_served?: string[]
          country?: string
          county?: string | null
          crawl_frequency?: string | null
          crawler_available?: boolean
          created_at?: string
          error_status?: string | null
          feed_type?: string | null
          feed_url?: string | null
          funding_page?: string | null
          geographic_coverage_description?: string | null
          id?: string
          last_successful_sync?: string | null
          last_sync?: string | null
          nationwide?: boolean
          next_crawl?: string | null
          notes?: string | null
          opportunities_found?: number
          organization_name?: string
          organization_type?: string
          region?: string | null
          robots_status?: string | null
          search_terms?: string[]
          source_level?: string
          source_name?: string
          source_priority?: number
          source_reliability?: number
          state?: string | null
          states_served?: string[]
          structured_feed_available?: boolean
          updated_at?: string
          website?: string | null
        }
        Relationships: []
      }
      grant_activity_log: {
        Row: {
          action: string
          created_at: string
          detail: string | null
          grant_record_id: string
          id: string
          metadata: Json
          user_id: string
        }
        Insert: {
          action: string
          created_at?: string
          detail?: string | null
          grant_record_id: string
          id?: string
          metadata?: Json
          user_id: string
        }
        Update: {
          action?: string
          created_at?: string
          detail?: string | null
          grant_record_id?: string
          id?: string
          metadata?: Json
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "grant_activity_log_grant_record_id_fkey"
            columns: ["grant_record_id"]
            isOneToOne: false
            referencedRelation: "grant_records"
            referencedColumns: ["id"]
          },
        ]
      }
      grant_documents: {
        Row: {
          created_at: string
          document_type: string
          grant_record_id: string
          id: string
          mime_type: string | null
          name: string
          size_bytes: number | null
          storage_path: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          document_type?: string
          grant_record_id: string
          id?: string
          mime_type?: string | null
          name: string
          size_bytes?: number | null
          storage_path: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          document_type?: string
          grant_record_id?: string
          id?: string
          mime_type?: string | null
          name?: string
          size_bytes?: number | null
          storage_path?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "grant_documents_grant_record_id_fkey"
            columns: ["grant_record_id"]
            isOneToOne: false
            referencedRelation: "grant_records"
            referencedColumns: ["id"]
          },
        ]
      }
      grant_records: {
        Row: {
          archived: boolean
          awarded_amount: number | null
          created_at: string
          deadline: string | null
          decision_date_actual: string | null
          decision_date_expected: string | null
          focus_areas: string[]
          funder: string
          funder_contact_email: string | null
          funder_contact_name: string | null
          funder_contact_phone: string | null
          funder_type: string
          grant_name: string
          id: string
          internal_notes: string | null
          last_activity_at: string
          match_score: number | null
          opportunity_id: string | null
          opportunity_slug: string | null
          outcome: string
          portal_url: string | null
          proposal_id: string | null
          requested_amount: number | null
          stage: string
          submission_date: string | null
          submitted_amount: number | null
          tags: string[]
          updated_at: string
          user_id: string
        }
        Insert: {
          archived?: boolean
          awarded_amount?: number | null
          created_at?: string
          deadline?: string | null
          decision_date_actual?: string | null
          decision_date_expected?: string | null
          focus_areas?: string[]
          funder: string
          funder_contact_email?: string | null
          funder_contact_name?: string | null
          funder_contact_phone?: string | null
          funder_type?: string
          grant_name: string
          id?: string
          internal_notes?: string | null
          last_activity_at?: string
          match_score?: number | null
          opportunity_id?: string | null
          opportunity_slug?: string | null
          outcome?: string
          portal_url?: string | null
          proposal_id?: string | null
          requested_amount?: number | null
          stage?: string
          submission_date?: string | null
          submitted_amount?: number | null
          tags?: string[]
          updated_at?: string
          user_id: string
        }
        Update: {
          archived?: boolean
          awarded_amount?: number | null
          created_at?: string
          deadline?: string | null
          decision_date_actual?: string | null
          decision_date_expected?: string | null
          focus_areas?: string[]
          funder?: string
          funder_contact_email?: string | null
          funder_contact_name?: string | null
          funder_contact_phone?: string | null
          funder_type?: string
          grant_name?: string
          id?: string
          internal_notes?: string | null
          last_activity_at?: string
          match_score?: number | null
          opportunity_id?: string | null
          opportunity_slug?: string | null
          outcome?: string
          portal_url?: string | null
          proposal_id?: string | null
          requested_amount?: number | null
          stage?: string
          submission_date?: string | null
          submitted_amount?: number | null
          tags?: string[]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "grant_records_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "grant_records_proposal_id_fkey"
            columns: ["proposal_id"]
            isOneToOne: false
            referencedRelation: "proposals"
            referencedColumns: ["id"]
          },
        ]
      }
      grant_reporting_items: {
        Row: {
          created_at: string
          document_id: string | null
          due_date: string | null
          grant_record_id: string
          id: string
          notes: string | null
          report_type: string
          submitted_date: string | null
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          document_id?: string | null
          due_date?: string | null
          grant_record_id: string
          id?: string
          notes?: string | null
          report_type?: string
          submitted_date?: string | null
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          document_id?: string | null
          due_date?: string | null
          grant_record_id?: string
          id?: string
          notes?: string | null
          report_type?: string
          submitted_date?: string | null
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "grant_reporting_items_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "grant_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "grant_reporting_items_grant_record_id_fkey"
            columns: ["grant_record_id"]
            isOneToOne: false
            referencedRelation: "grant_records"
            referencedColumns: ["id"]
          },
        ]
      }
      grant_stage_history: {
        Row: {
          created_at: string
          from_stage: string | null
          grant_record_id: string
          id: string
          note: string | null
          to_stage: string
          user_id: string
        }
        Insert: {
          created_at?: string
          from_stage?: string | null
          grant_record_id: string
          id?: string
          note?: string | null
          to_stage: string
          user_id: string
        }
        Update: {
          created_at?: string
          from_stage?: string | null
          grant_record_id?: string
          id?: string
          note?: string | null
          to_stage?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "grant_stage_history_grant_record_id_fkey"
            columns: ["grant_record_id"]
            isOneToOne: false
            referencedRelation: "grant_records"
            referencedColumns: ["id"]
          },
        ]
      }
      grant_team_members: {
        Row: {
          created_at: string
          grant_record_id: string
          id: string
          member_email: string | null
          member_name: string
          member_role: string
          user_id: string
        }
        Insert: {
          created_at?: string
          grant_record_id: string
          id?: string
          member_email?: string | null
          member_name: string
          member_role?: string
          user_id: string
        }
        Update: {
          created_at?: string
          grant_record_id?: string
          id?: string
          member_email?: string | null
          member_name?: string
          member_role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "grant_team_members_grant_record_id_fkey"
            columns: ["grant_record_id"]
            isOneToOne: false
            referencedRelation: "grant_records"
            referencedColumns: ["id"]
          },
        ]
      }
      impact_statistics: {
        Row: {
          created_at: string
          id: string
          numeric_value: number | null
          program_area: string | null
          source_document_id: string | null
          stat_text: string
          time_period: string | null
          unit: string | null
          user_id: string
          verified: boolean
        }
        Insert: {
          created_at?: string
          id?: string
          numeric_value?: number | null
          program_area?: string | null
          source_document_id?: string | null
          stat_text: string
          time_period?: string | null
          unit?: string | null
          user_id: string
          verified?: boolean
        }
        Update: {
          created_at?: string
          id?: string
          numeric_value?: number | null
          program_area?: string | null
          source_document_id?: string | null
          stat_text?: string
          time_period?: string | null
          unit?: string | null
          user_id?: string
          verified?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "impact_statistics_source_document_id_fkey"
            columns: ["source_document_id"]
            isOneToOne: false
            referencedRelation: "profile_source_documents"
            referencedColumns: ["id"]
          },
        ]
      }
      module_subscriptions: {
        Row: {
          annual: boolean
          created_at: string
          current_period_end: string | null
          environment: string
          id: string
          module: string
          plan: string
          price_id: string | null
          status: string
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          trial_end: string | null
          trial_start: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          annual?: boolean
          created_at?: string
          current_period_end?: string | null
          environment?: string
          id?: string
          module: string
          plan: string
          price_id?: string | null
          status?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          trial_end?: string | null
          trial_start?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          annual?: boolean
          created_at?: string
          current_period_end?: string | null
          environment?: string
          id?: string
          module?: string
          plan?: string
          price_id?: string | null
          status?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          trial_end?: string | null
          trial_start?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      opportunities: {
        Row: {
          application_url: string | null
          award_max: number | null
          award_min: number | null
          country: string
          created_at: string
          deadline: string | null
          eligible_cities: string[]
          eligible_counties: string[]
          eligible_org_types: string[]
          eligible_states: string[]
          focus_areas: string[]
          funder: string
          funder_type: string
          geo_level: string
          headquarters_location_required: boolean
          id: string
          is_active: boolean
          is_forecasted: boolean
          match_required: boolean
          opportunity_type: string
          populations_served: string[]
          project_location_required: boolean
          region: string | null
          slug: string
          source: string | null
          source_id: string | null
          source_reliability: number
          summary: string
          title: string
          updated_at: string
          verified_at: string | null
        }
        Insert: {
          application_url?: string | null
          award_max?: number | null
          award_min?: number | null
          country?: string
          created_at?: string
          deadline?: string | null
          eligible_cities?: string[]
          eligible_counties?: string[]
          eligible_org_types?: string[]
          eligible_states?: string[]
          focus_areas?: string[]
          funder: string
          funder_type?: string
          geo_level?: string
          headquarters_location_required?: boolean
          id?: string
          is_active?: boolean
          is_forecasted?: boolean
          match_required?: boolean
          opportunity_type?: string
          populations_served?: string[]
          project_location_required?: boolean
          region?: string | null
          slug: string
          source?: string | null
          source_id?: string | null
          source_reliability?: number
          summary: string
          title: string
          updated_at?: string
          verified_at?: string | null
        }
        Update: {
          application_url?: string | null
          award_max?: number | null
          award_min?: number | null
          country?: string
          created_at?: string
          deadline?: string | null
          eligible_cities?: string[]
          eligible_counties?: string[]
          eligible_org_types?: string[]
          eligible_states?: string[]
          focus_areas?: string[]
          funder?: string
          funder_type?: string
          geo_level?: string
          headquarters_location_required?: boolean
          id?: string
          is_active?: boolean
          is_forecasted?: boolean
          match_required?: boolean
          opportunity_type?: string
          populations_served?: string[]
          project_location_required?: boolean
          region?: string | null
          slug?: string
          source?: string | null
          source_id?: string | null
          source_reliability?: number
          summary?: string
          title?: string
          updated_at?: string
          verified_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "opportunities_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "funding_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      org_documents: {
        Row: {
          created_at: string
          description: string | null
          document_type: string
          expires_on: string | null
          id: string
          mime_type: string | null
          name: string
          size_bytes: number | null
          storage_path: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          document_type?: string
          expires_on?: string | null
          id?: string
          mime_type?: string | null
          name: string
          size_bytes?: number | null
          storage_path: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          description?: string | null
          document_type?: string
          expires_on?: string | null
          id?: string
          mime_type?: string | null
          name?: string
          size_bytes?: number | null
          storage_path?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      org_profile_data_points: {
        Row: {
          category: string
          confidence: string
          created_at: string
          field_name: string
          field_value: string
          id: string
          last_used_at: string | null
          source_document_id: string | null
          source_label: string | null
          source_scrape_session_id: string | null
          source_type: string
          times_used_in_proposals: number
          updated_at: string
          user_id: string
        }
        Insert: {
          category: string
          confidence?: string
          created_at?: string
          field_name: string
          field_value: string
          id?: string
          last_used_at?: string | null
          source_document_id?: string | null
          source_label?: string | null
          source_scrape_session_id?: string | null
          source_type?: string
          times_used_in_proposals?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          category?: string
          confidence?: string
          created_at?: string
          field_name?: string
          field_value?: string
          id?: string
          last_used_at?: string | null
          source_document_id?: string | null
          source_label?: string | null
          source_scrape_session_id?: string | null
          source_type?: string
          times_used_in_proposals?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "org_profile_data_points_source_document_id_fkey"
            columns: ["source_document_id"]
            isOneToOne: false
            referencedRelation: "profile_source_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "org_profile_data_points_source_scrape_session_id_fkey"
            columns: ["source_scrape_session_id"]
            isOneToOne: false
            referencedRelation: "website_scrape_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      org_profiles: {
        Row: {
          annual_budget: number | null
          capability_summary: string | null
          certifications: string[]
          city: string | null
          contract_vehicles: string[]
          core_competencies: string[]
          counties_served: string[]
          country: string | null
          created_at: string
          differentiators: string[]
          ein: string | null
          focus_areas: string[]
          funding_amount_max: number | null
          funding_amount_min: number | null
          funding_needs: string | null
          geographic_scope_preference: string
          id: string
          last_scraped_at: string | null
          mission: string | null
          naics_codes: string[]
          onboarding_complete: boolean
          onboarding_step: number
          operating_states: string[]
          org_name: string
          org_type: string | null
          populations_served: string[]
          project_location_flexibility: string | null
          readiness_notes: string | null
          relocation_willingness: string | null
          sam_registered: boolean | null
          service_area_scope: string | null
          staff_size: number | null
          state: string | null
          target_expansion_markets: string[]
          uei: string | null
          updated_at: string
          user_id: string
          website: string | null
          year_founded: number | null
        }
        Insert: {
          annual_budget?: number | null
          capability_summary?: string | null
          certifications?: string[]
          city?: string | null
          contract_vehicles?: string[]
          core_competencies?: string[]
          counties_served?: string[]
          country?: string | null
          created_at?: string
          differentiators?: string[]
          ein?: string | null
          focus_areas?: string[]
          funding_amount_max?: number | null
          funding_amount_min?: number | null
          funding_needs?: string | null
          geographic_scope_preference?: string
          id?: string
          last_scraped_at?: string | null
          mission?: string | null
          naics_codes?: string[]
          onboarding_complete?: boolean
          onboarding_step?: number
          operating_states?: string[]
          org_name?: string
          org_type?: string | null
          populations_served?: string[]
          project_location_flexibility?: string | null
          readiness_notes?: string | null
          relocation_willingness?: string | null
          sam_registered?: boolean | null
          service_area_scope?: string | null
          staff_size?: number | null
          state?: string | null
          target_expansion_markets?: string[]
          uei?: string | null
          updated_at?: string
          user_id: string
          website?: string | null
          year_founded?: number | null
        }
        Update: {
          annual_budget?: number | null
          capability_summary?: string | null
          certifications?: string[]
          city?: string | null
          contract_vehicles?: string[]
          core_competencies?: string[]
          counties_served?: string[]
          country?: string | null
          created_at?: string
          differentiators?: string[]
          ein?: string | null
          focus_areas?: string[]
          funding_amount_max?: number | null
          funding_amount_min?: number | null
          funding_needs?: string | null
          geographic_scope_preference?: string
          id?: string
          last_scraped_at?: string | null
          mission?: string | null
          naics_codes?: string[]
          onboarding_complete?: boolean
          onboarding_step?: number
          operating_states?: string[]
          org_name?: string
          org_type?: string | null
          populations_served?: string[]
          project_location_flexibility?: string | null
          readiness_notes?: string | null
          relocation_willingness?: string | null
          sam_registered?: boolean | null
          service_area_scope?: string | null
          staff_size?: number | null
          state?: string | null
          target_expansion_markets?: string[]
          uei?: string | null
          updated_at?: string
          user_id?: string
          website?: string | null
          year_founded?: number | null
        }
        Relationships: []
      }
      org_team_members: {
        Row: {
          created_at: string
          id: string
          invited_at: string
          member_email: string
          member_name: string
          member_role: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          invited_at?: string
          member_email: string
          member_name: string
          member_role?: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          invited_at?: string
          member_email?: string
          member_name?: string
          member_role?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      person_profiles: {
        Row: {
          ai_generated_bio_long: string | null
          ai_generated_bio_short: string | null
          areas_of_expertise: string[]
          awards: string[]
          certifications: string[]
          confidence: string | null
          created_at: string
          education: Json
          full_name: string
          id: string
          languages: string[]
          last_used_at: string | null
          person_type: string
          publications: string[]
          relevant_skills: string[]
          role_on_proposals: string[]
          selected_projects: Json
          source_document_id: string | null
          teaming_org_name: string | null
          times_included_in_proposals: number
          title: string | null
          updated_at: string
          user_id: string
          years_of_experience: number | null
        }
        Insert: {
          ai_generated_bio_long?: string | null
          ai_generated_bio_short?: string | null
          areas_of_expertise?: string[]
          awards?: string[]
          certifications?: string[]
          confidence?: string | null
          created_at?: string
          education?: Json
          full_name: string
          id?: string
          languages?: string[]
          last_used_at?: string | null
          person_type?: string
          publications?: string[]
          relevant_skills?: string[]
          role_on_proposals?: string[]
          selected_projects?: Json
          source_document_id?: string | null
          teaming_org_name?: string | null
          times_included_in_proposals?: number
          title?: string | null
          updated_at?: string
          user_id: string
          years_of_experience?: number | null
        }
        Update: {
          ai_generated_bio_long?: string | null
          ai_generated_bio_short?: string | null
          areas_of_expertise?: string[]
          awards?: string[]
          certifications?: string[]
          confidence?: string | null
          created_at?: string
          education?: Json
          full_name?: string
          id?: string
          languages?: string[]
          last_used_at?: string | null
          person_type?: string
          publications?: string[]
          relevant_skills?: string[]
          role_on_proposals?: string[]
          selected_projects?: Json
          source_document_id?: string | null
          teaming_org_name?: string | null
          times_included_in_proposals?: number
          title?: string | null
          updated_at?: string
          user_id?: string
          years_of_experience?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "person_profiles_source_document_id_fkey"
            columns: ["source_document_id"]
            isOneToOne: false
            referencedRelation: "profile_source_documents"
            referencedColumns: ["id"]
          },
        ]
      }
      plan_limits: {
        Row: {
          calendar_export: boolean
          client_workspaces: number | null
          compliance_budget_tracking: boolean
          compliance_contracts_max: number | null
          compliance_health_score: boolean
          compliance_level: string
          compliance_timeline_view: boolean
          created_at: string
          duplicate_enabled: boolean
          email_reports: boolean
          export_enabled: boolean
          matches_per_month: number | null
          plan_id: string
          price_id: string
          priority_support: boolean
          proposal_drafts_per_month: number | null
          saved_opportunities_max: number | null
          scan_frequency: string
          team_seats: number | null
          templates_enabled: boolean
          tracker_csv_export: boolean
          tracker_pdf_report: boolean
          tracker_team_assignment: boolean
          updated_at: string
          usage_analytics: boolean
          white_label_export: boolean
        }
        Insert: {
          calendar_export?: boolean
          client_workspaces?: number | null
          compliance_budget_tracking?: boolean
          compliance_contracts_max?: number | null
          compliance_health_score?: boolean
          compliance_level?: string
          compliance_timeline_view?: boolean
          created_at?: string
          duplicate_enabled?: boolean
          email_reports?: boolean
          export_enabled?: boolean
          matches_per_month?: number | null
          plan_id: string
          price_id: string
          priority_support?: boolean
          proposal_drafts_per_month?: number | null
          saved_opportunities_max?: number | null
          scan_frequency?: string
          team_seats?: number | null
          templates_enabled?: boolean
          tracker_csv_export?: boolean
          tracker_pdf_report?: boolean
          tracker_team_assignment?: boolean
          updated_at?: string
          usage_analytics?: boolean
          white_label_export?: boolean
        }
        Update: {
          calendar_export?: boolean
          client_workspaces?: number | null
          compliance_budget_tracking?: boolean
          compliance_contracts_max?: number | null
          compliance_health_score?: boolean
          compliance_level?: string
          compliance_timeline_view?: boolean
          created_at?: string
          duplicate_enabled?: boolean
          email_reports?: boolean
          export_enabled?: boolean
          matches_per_month?: number | null
          plan_id?: string
          price_id?: string
          priority_support?: boolean
          proposal_drafts_per_month?: number | null
          saved_opportunities_max?: number | null
          scan_frequency?: string
          team_seats?: number | null
          templates_enabled?: boolean
          tracker_csv_export?: boolean
          tracker_pdf_report?: boolean
          tracker_team_assignment?: boolean
          updated_at?: string
          usage_analytics?: boolean
          white_label_export?: boolean
        }
        Relationships: []
      }
      platform_config: {
        Row: {
          key: string
          updated_at: string
          updated_by: string | null
          value: Json
        }
        Insert: {
          key: string
          updated_at?: string
          updated_by?: string | null
          value: Json
        }
        Update: {
          key?: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Relationships: []
      }
      platform_error_log: {
        Row: {
          created_at: string
          error_type: string
          id: string
          message: string
          request_context: Json | null
          resolution_note: string | null
          resolved: boolean
          resolved_at: string | null
          resolved_by: string | null
          source_function: string | null
          stacktrace: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          error_type: string
          id?: string
          message: string
          request_context?: Json | null
          resolution_note?: string | null
          resolved?: boolean
          resolved_at?: string | null
          resolved_by?: string | null
          source_function?: string | null
          stacktrace?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          error_type?: string
          id?: string
          message?: string
          request_context?: Json | null
          resolution_note?: string | null
          resolved?: boolean
          resolved_at?: string | null
          resolved_by?: string | null
          source_function?: string | null
          stacktrace?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      profile_source_documents: {
        Row: {
          award_amount: number | null
          award_status: string | null
          created_at: string
          document_type: string
          extracted_count: number
          extraction_completed_at: string | null
          extraction_status: string
          file_name: string
          file_path: string | null
          file_size: number | null
          funder_name: string | null
          id: string
          last_used_at: string | null
          notes: string | null
          opportunity_title: string | null
          program_area: string | null
          submission_date: string | null
          times_referenced: number
          updated_at: string
          user_id: string
        }
        Insert: {
          award_amount?: number | null
          award_status?: string | null
          created_at?: string
          document_type: string
          extracted_count?: number
          extraction_completed_at?: string | null
          extraction_status?: string
          file_name: string
          file_path?: string | null
          file_size?: number | null
          funder_name?: string | null
          id?: string
          last_used_at?: string | null
          notes?: string | null
          opportunity_title?: string | null
          program_area?: string | null
          submission_date?: string | null
          times_referenced?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          award_amount?: number | null
          award_status?: string | null
          created_at?: string
          document_type?: string
          extracted_count?: number
          extraction_completed_at?: string | null
          extraction_status?: string
          file_name?: string
          file_path?: string | null
          file_size?: number | null
          funder_name?: string | null
          id?: string
          last_used_at?: string | null
          notes?: string | null
          opportunity_title?: string | null
          program_area?: string | null
          submission_date?: string | null
          times_referenced?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          job_title: string | null
          phone: string | null
          trial_used: boolean
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
          job_title?: string | null
          phone?: string | null
          trial_used?: boolean
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          job_title?: string | null
          phone?: string | null
          trial_used?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      proposal_addon_purchases: {
        Row: {
          addon_id: string
          amount_cents: number
          created_at: string
          currency: string
          cycle_start: string | null
          drafts_granted: number
          environment: string
          id: string
          price_id: string
          proposal_id: string | null
          status: string
          stripe_session_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          addon_id: string
          amount_cents?: number
          created_at?: string
          currency?: string
          cycle_start?: string | null
          drafts_granted?: number
          environment?: string
          id?: string
          price_id: string
          proposal_id?: string | null
          status?: string
          stripe_session_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          addon_id?: string
          amount_cents?: number
          created_at?: string
          currency?: string
          cycle_start?: string | null
          drafts_granted?: number
          environment?: string
          id?: string
          price_id?: string
          proposal_id?: string | null
          status?: string
          stripe_session_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "proposal_addon_purchases_proposal_id_fkey"
            columns: ["proposal_id"]
            isOneToOne: false
            referencedRelation: "proposals"
            referencedColumns: ["id"]
          },
        ]
      }
      proposal_content_library: {
        Row: {
          award_status: string | null
          block_type: string
          content: string
          created_at: string
          funder_type: string | null
          id: string
          last_used_at: string | null
          program_area: string | null
          source_document_id: string | null
          times_used: number
          title: string | null
          tone: string | null
          user_id: string
          word_count: number
        }
        Insert: {
          award_status?: string | null
          block_type: string
          content: string
          created_at?: string
          funder_type?: string | null
          id?: string
          last_used_at?: string | null
          program_area?: string | null
          source_document_id?: string | null
          times_used?: number
          title?: string | null
          tone?: string | null
          user_id: string
          word_count?: number
        }
        Update: {
          award_status?: string | null
          block_type?: string
          content?: string
          created_at?: string
          funder_type?: string | null
          id?: string
          last_used_at?: string | null
          program_area?: string | null
          source_document_id?: string | null
          times_used?: number
          title?: string | null
          tone?: string | null
          user_id?: string
          word_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "proposal_content_library_source_document_id_fkey"
            columns: ["source_document_id"]
            isOneToOne: false
            referencedRelation: "profile_source_documents"
            referencedColumns: ["id"]
          },
        ]
      }
      proposal_events: {
        Row: {
          created_at: string
          event: string
          id: string
          metadata: Json
          proposal_id: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          event: string
          id?: string
          metadata?: Json
          proposal_id?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          event?: string
          id?: string
          metadata?: Json
          proposal_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "proposal_events_proposal_id_fkey"
            columns: ["proposal_id"]
            isOneToOne: false
            referencedRelation: "proposals"
            referencedColumns: ["id"]
          },
        ]
      }
      proposal_templates: {
        Row: {
          created_at: string
          draft_content: Json
          id: string
          interview_answers: Json
          name: string
          source_proposal_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          draft_content?: Json
          id?: string
          interview_answers?: Json
          name: string
          source_proposal_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          draft_content?: Json
          id?: string
          interview_answers?: Json
          name?: string
          source_proposal_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "proposal_templates_source_proposal_id_fkey"
            columns: ["source_proposal_id"]
            isOneToOne: false
            referencedRelation: "proposals"
            referencedColumns: ["id"]
          },
        ]
      }
      proposals: {
        Row: {
          archived: boolean
          completeness_score: number
          compliance_review_results: Json | null
          created_at: string
          deadline: string | null
          downloaded_at: string | null
          draft_content: Json
          eligibility_checklist: Json
          funder: string
          id: string
          interview_answers: Json
          interview_plan: Json
          interview_position: number
          match_score: number | null
          opportunity_id: string | null
          opportunity_slug: string
          opportunity_title: string
          status: string
          updated_at: string
          user_id: string
          version_history: Json
        }
        Insert: {
          archived?: boolean
          completeness_score?: number
          compliance_review_results?: Json | null
          created_at?: string
          deadline?: string | null
          downloaded_at?: string | null
          draft_content?: Json
          eligibility_checklist?: Json
          funder: string
          id?: string
          interview_answers?: Json
          interview_plan?: Json
          interview_position?: number
          match_score?: number | null
          opportunity_id?: string | null
          opportunity_slug: string
          opportunity_title: string
          status?: string
          updated_at?: string
          user_id: string
          version_history?: Json
        }
        Update: {
          archived?: boolean
          completeness_score?: number
          compliance_review_results?: Json | null
          created_at?: string
          deadline?: string | null
          downloaded_at?: string | null
          draft_content?: Json
          eligibility_checklist?: Json
          funder?: string
          id?: string
          interview_answers?: Json
          interview_plan?: Json
          interview_position?: number
          match_score?: number | null
          opportunity_id?: string | null
          opportunity_slug?: string
          opportunity_title?: string
          status?: string
          updated_at?: string
          user_id?: string
          version_history?: Json
        }
        Relationships: [
          {
            foreignKeyName: "proposals_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["id"]
          },
        ]
      }
      regulatory_citations: {
        Row: {
          citation: string
          contract_id: string
          created_at: string
          id: string
          official_url: string | null
          plain_language_summary: string | null
          reviewed: boolean
          reviewed_at: string | null
          source_quote: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          citation: string
          contract_id: string
          created_at?: string
          id?: string
          official_url?: string | null
          plain_language_summary?: string | null
          reviewed?: boolean
          reviewed_at?: string | null
          source_quote?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          citation?: string
          contract_id?: string
          created_at?: string
          id?: string
          official_url?: string | null
          plain_language_summary?: string | null
          reviewed?: boolean
          reviewed_at?: string | null
          source_quote?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "regulatory_citations_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "compliance_contracts"
            referencedColumns: ["id"]
          },
        ]
      }
      saved_opportunities: {
        Row: {
          created_at: string
          id: string
          notes: string | null
          opportunity_slug: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          notes?: string | null
          opportunity_slug: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          notes?: string | null
          opportunity_slug?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      security_audit_log: {
        Row: {
          action: string
          created_at: string
          id: string
          ip_address: string | null
          metadata: Json
          resource_id: string | null
          resource_type: string | null
          user_agent: string | null
          user_id: string
        }
        Insert: {
          action: string
          created_at?: string
          id?: string
          ip_address?: string | null
          metadata?: Json
          resource_id?: string | null
          resource_type?: string | null
          user_agent?: string | null
          user_id: string
        }
        Update: {
          action?: string
          created_at?: string
          id?: string
          ip_address?: string | null
          metadata?: Json
          resource_id?: string | null
          resource_type?: string | null
          user_agent?: string | null
          user_id?: string
        }
        Relationships: []
      }
      subscriptions: {
        Row: {
          cancel_at_period_end: boolean | null
          created_at: string
          current_period_end: string | null
          current_period_start: string | null
          environment: string
          id: string
          price_id: string
          product_id: string
          status: string
          stripe_customer_id: string
          stripe_subscription_id: string
          trial_end: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          cancel_at_period_end?: boolean | null
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          environment?: string
          id?: string
          price_id: string
          product_id: string
          status?: string
          stripe_customer_id: string
          stripe_subscription_id: string
          trial_end?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          cancel_at_period_end?: boolean | null
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          environment?: string
          id?: string
          price_id?: string
          product_id?: string
          status?: string
          stripe_customer_id?: string
          stripe_subscription_id?: string
          trial_end?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      usage_counters: {
        Row: {
          addon_drafts_purchased: number
          addon_drafts_used: number
          created_at: string
          id: string
          matches_used: number
          period_end: string | null
          period_start: string
          proposal_drafts_used: number
          updated_at: string
          user_id: string
        }
        Insert: {
          addon_drafts_purchased?: number
          addon_drafts_used?: number
          created_at?: string
          id?: string
          matches_used?: number
          period_end?: string | null
          period_start: string
          proposal_drafts_used?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          addon_drafts_purchased?: number
          addon_drafts_used?: number
          created_at?: string
          id?: string
          matches_used?: number
          period_end?: string | null
          period_start?: string
          proposal_drafts_used?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      website_scrape_sessions: {
        Row: {
          created_at: string
          id: string
          pages_scraped: string[]
          raw_extraction: Json | null
          reviewed_at: string | null
          scraped_at: string
          status: string
          total_data_points_extracted: number
          user_id: string
          website_url: string
        }
        Insert: {
          created_at?: string
          id?: string
          pages_scraped?: string[]
          raw_extraction?: Json | null
          reviewed_at?: string | null
          scraped_at?: string
          status?: string
          total_data_points_extracted?: number
          user_id: string
          website_url: string
        }
        Update: {
          created_at?: string
          id?: string
          pages_scraped?: string[]
          raw_extraction?: Json | null
          reviewed_at?: string | null
          scraped_at?: string
          status?: string
          total_data_points_extracted?: number
          user_id?: string
          website_url?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      active_price_id: {
        Args: { _env?: string; _user_id: string }
        Returns: string
      }
      billing_cycle_start: {
        Args: { _env?: string; _user_id: string }
        Returns: string
      }
      check_rate_limit: {
        Args: { _action: string; _limit_per_hour: number }
        Returns: Json
      }
      consume_proposal_draft: { Args: { _env?: string }; Returns: Json }
      gi_price_id: {
        Args: { _env?: string; _user_id: string }
        Returns: string
      }
      has_active_subscription: {
        Args: { check_env?: string; user_uuid: string }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_platform_admin: { Args: { _user_id: string }; Returns: boolean }
      is_platform_staff: { Args: { _user_id: string }; Returns: boolean }
      my_active_price_id: { Args: { _env?: string }; Returns: string }
      my_billing_cycle_start: { Args: { _env?: string }; Returns: string }
      my_plan_limit: {
        Args: { _env?: string; _limit: string }
        Returns: number
      }
      plan_limit_for: {
        Args: { _env?: string; _limit: string; _user_id: string }
        Returns: number
      }
    }
    Enums: {
      app_role: "admin" | "member" | "platform_admin" | "platform_support"
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
    Enums: {
      app_role: ["admin", "member", "platform_admin", "platform_support"],
    },
  },
} as const
