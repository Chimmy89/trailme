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
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      audit_log: {
        Row: {
          action: Database["public"]["Enums"]["audit_action"]
          actor_user_id: string | null
          id: string
          org_id: string
          params: Json
          target_guard_id: string | null
          ts: string
        }
        Insert: {
          action: Database["public"]["Enums"]["audit_action"]
          actor_user_id?: string | null
          id?: string
          org_id: string
          params?: Json
          target_guard_id?: string | null
          ts?: string
        }
        Update: {
          action?: Database["public"]["Enums"]["audit_action"]
          actor_user_id?: string | null
          id?: string
          org_id?: string
          params?: Json
          target_guard_id?: string | null
          ts?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      dead_letter_breadcrumbs: {
        Row: {
          client_seq: number | null
          created_at: string
          guard_id: string | null
          id: string
          org_id: string | null
          raw: Json
          reason: string
        }
        Insert: {
          client_seq?: number | null
          created_at?: string
          guard_id?: string | null
          id?: string
          org_id?: string | null
          raw: Json
          reason: string
        }
        Update: {
          client_seq?: number | null
          created_at?: string
          guard_id?: string | null
          id?: string
          org_id?: string | null
          raw?: Json
          reason?: string
        }
        Relationships: []
      }
      erasure_registry: {
        Row: {
          guard_column: string
          rationale: string | null
          strategy: Database["public"]["Enums"]["erasure_strategy"]
          table_name: string
          table_schema: string
        }
        Insert: {
          guard_column: string
          rationale?: string | null
          strategy: Database["public"]["Enums"]["erasure_strategy"]
          table_name: string
          table_schema: string
        }
        Update: {
          guard_column?: string
          rationale?: string | null
          strategy?: Database["public"]["Enums"]["erasure_strategy"]
          table_name?: string
          table_schema?: string
        }
        Relationships: []
      }
      guard_disclosures: {
        Row: {
          accepted_at: string
          id: string
          notice_version: string
          org_id: string
          tracking_mode_at_accept: Database["public"]["Enums"]["tracking_mode"]
          user_id: string
        }
        Insert: {
          accepted_at?: string
          id?: string
          notice_version: string
          org_id: string
          tracking_mode_at_accept: Database["public"]["Enums"]["tracking_mode"]
          user_id: string
        }
        Update: {
          accepted_at?: string
          id?: string
          notice_version?: string
          org_id?: string
          tracking_mode_at_accept?: Database["public"]["Enums"]["tracking_mode"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "guard_disclosures_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      guard_positions: {
        Row: {
          accuracy_m: number | null
          captured_at: string
          geom: unknown
          guard_id: string
          heading: number | null
          online: boolean
          org_id: string
          site_id: string
          updated_at: string
        }
        Insert: {
          accuracy_m?: number | null
          captured_at: string
          geom: unknown
          guard_id: string
          heading?: number | null
          online?: boolean
          org_id: string
          site_id: string
          updated_at?: string
        }
        Update: {
          accuracy_m?: number | null
          captured_at?: string
          geom?: unknown
          guard_id?: string
          heading?: number | null
          online?: boolean
          org_id?: string
          site_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "guard_positions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "guard_positions_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      inspection_checkpoints: {
        Row: {
          geom: unknown
          guard_id: string
          id: string
          label: string | null
          org_id: string
          site_id: string
          tagged_at: string
        }
        Insert: {
          geom: unknown
          guard_id: string
          id?: string
          label?: string | null
          org_id: string
          site_id: string
          tagged_at?: string
        }
        Update: {
          geom?: unknown
          guard_id?: string
          id?: string
          label?: string | null
          org_id?: string
          site_id?: string
          tagged_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "inspection_checkpoints_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inspection_checkpoints_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      location_breadcrumbs: {
        Row: {
          accuracy_m: number | null
          captured_at: string
          client_seq: number
          geom: unknown
          guard_id: string
          id: string
          ingested_at: string
          install_id: string
          is_keepalive: boolean
          is_low_confidence: boolean
          org_id: string
          partition_ts: string
          site_id: string
        }
        Insert: {
          accuracy_m?: number | null
          captured_at: string
          client_seq: number
          geom: unknown
          guard_id: string
          id?: string
          ingested_at?: string
          install_id: string
          is_keepalive?: boolean
          is_low_confidence?: boolean
          org_id: string
          partition_ts: string
          site_id: string
        }
        Update: {
          accuracy_m?: number | null
          captured_at?: string
          client_seq?: number
          geom?: unknown
          guard_id?: string
          id?: string
          ingested_at?: string
          install_id?: string
          is_keepalive?: boolean
          is_low_confidence?: boolean
          org_id?: string
          partition_ts?: string
          site_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "location_breadcrumbs_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "location_breadcrumbs_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      location_breadcrumbs_20260607: {
        Row: {
          accuracy_m: number | null
          captured_at: string
          client_seq: number
          geom: unknown
          guard_id: string
          id: string
          ingested_at: string
          install_id: string
          is_keepalive: boolean
          is_low_confidence: boolean
          org_id: string
          partition_ts: string
          site_id: string
        }
        Insert: {
          accuracy_m?: number | null
          captured_at: string
          client_seq: number
          geom: unknown
          guard_id: string
          id?: string
          ingested_at?: string
          install_id: string
          is_keepalive?: boolean
          is_low_confidence?: boolean
          org_id: string
          partition_ts: string
          site_id: string
        }
        Update: {
          accuracy_m?: number | null
          captured_at?: string
          client_seq?: number
          geom?: unknown
          guard_id?: string
          id?: string
          ingested_at?: string
          install_id?: string
          is_keepalive?: boolean
          is_low_confidence?: boolean
          org_id?: string
          partition_ts?: string
          site_id?: string
        }
        Relationships: []
      }
      location_breadcrumbs_20260608: {
        Row: {
          accuracy_m: number | null
          captured_at: string
          client_seq: number
          geom: unknown
          guard_id: string
          id: string
          ingested_at: string
          install_id: string
          is_keepalive: boolean
          is_low_confidence: boolean
          org_id: string
          partition_ts: string
          site_id: string
        }
        Insert: {
          accuracy_m?: number | null
          captured_at: string
          client_seq: number
          geom: unknown
          guard_id: string
          id?: string
          ingested_at?: string
          install_id: string
          is_keepalive?: boolean
          is_low_confidence?: boolean
          org_id: string
          partition_ts: string
          site_id: string
        }
        Update: {
          accuracy_m?: number | null
          captured_at?: string
          client_seq?: number
          geom?: unknown
          guard_id?: string
          id?: string
          ingested_at?: string
          install_id?: string
          is_keepalive?: boolean
          is_low_confidence?: boolean
          org_id?: string
          partition_ts?: string
          site_id?: string
        }
        Relationships: []
      }
      location_breadcrumbs_20260609: {
        Row: {
          accuracy_m: number | null
          captured_at: string
          client_seq: number
          geom: unknown
          guard_id: string
          id: string
          ingested_at: string
          install_id: string
          is_keepalive: boolean
          is_low_confidence: boolean
          org_id: string
          partition_ts: string
          site_id: string
        }
        Insert: {
          accuracy_m?: number | null
          captured_at: string
          client_seq: number
          geom: unknown
          guard_id: string
          id?: string
          ingested_at?: string
          install_id: string
          is_keepalive?: boolean
          is_low_confidence?: boolean
          org_id: string
          partition_ts: string
          site_id: string
        }
        Update: {
          accuracy_m?: number | null
          captured_at?: string
          client_seq?: number
          geom?: unknown
          guard_id?: string
          id?: string
          ingested_at?: string
          install_id?: string
          is_keepalive?: boolean
          is_low_confidence?: boolean
          org_id?: string
          partition_ts?: string
          site_id?: string
        }
        Relationships: []
      }
      location_breadcrumbs_20260610: {
        Row: {
          accuracy_m: number | null
          captured_at: string
          client_seq: number
          geom: unknown
          guard_id: string
          id: string
          ingested_at: string
          install_id: string
          is_keepalive: boolean
          is_low_confidence: boolean
          org_id: string
          partition_ts: string
          site_id: string
        }
        Insert: {
          accuracy_m?: number | null
          captured_at: string
          client_seq: number
          geom: unknown
          guard_id: string
          id?: string
          ingested_at?: string
          install_id: string
          is_keepalive?: boolean
          is_low_confidence?: boolean
          org_id: string
          partition_ts: string
          site_id: string
        }
        Update: {
          accuracy_m?: number | null
          captured_at?: string
          client_seq?: number
          geom?: unknown
          guard_id?: string
          id?: string
          ingested_at?: string
          install_id?: string
          is_keepalive?: boolean
          is_low_confidence?: boolean
          org_id?: string
          partition_ts?: string
          site_id?: string
        }
        Relationships: []
      }
      location_breadcrumbs_20260611: {
        Row: {
          accuracy_m: number | null
          captured_at: string
          client_seq: number
          geom: unknown
          guard_id: string
          id: string
          ingested_at: string
          install_id: string
          is_keepalive: boolean
          is_low_confidence: boolean
          org_id: string
          partition_ts: string
          site_id: string
        }
        Insert: {
          accuracy_m?: number | null
          captured_at: string
          client_seq: number
          geom: unknown
          guard_id: string
          id?: string
          ingested_at?: string
          install_id: string
          is_keepalive?: boolean
          is_low_confidence?: boolean
          org_id: string
          partition_ts: string
          site_id: string
        }
        Update: {
          accuracy_m?: number | null
          captured_at?: string
          client_seq?: number
          geom?: unknown
          guard_id?: string
          id?: string
          ingested_at?: string
          install_id?: string
          is_keepalive?: boolean
          is_low_confidence?: boolean
          org_id?: string
          partition_ts?: string
          site_id?: string
        }
        Relationships: []
      }
      location_breadcrumbs_20260612: {
        Row: {
          accuracy_m: number | null
          captured_at: string
          client_seq: number
          geom: unknown
          guard_id: string
          id: string
          ingested_at: string
          install_id: string
          is_keepalive: boolean
          is_low_confidence: boolean
          org_id: string
          partition_ts: string
          site_id: string
        }
        Insert: {
          accuracy_m?: number | null
          captured_at: string
          client_seq: number
          geom: unknown
          guard_id: string
          id?: string
          ingested_at?: string
          install_id: string
          is_keepalive?: boolean
          is_low_confidence?: boolean
          org_id: string
          partition_ts: string
          site_id: string
        }
        Update: {
          accuracy_m?: number | null
          captured_at?: string
          client_seq?: number
          geom?: unknown
          guard_id?: string
          id?: string
          ingested_at?: string
          install_id?: string
          is_keepalive?: boolean
          is_low_confidence?: boolean
          org_id?: string
          partition_ts?: string
          site_id?: string
        }
        Relationships: []
      }
      location_breadcrumbs_20260613: {
        Row: {
          accuracy_m: number | null
          captured_at: string
          client_seq: number
          geom: unknown
          guard_id: string
          id: string
          ingested_at: string
          install_id: string
          is_keepalive: boolean
          is_low_confidence: boolean
          org_id: string
          partition_ts: string
          site_id: string
        }
        Insert: {
          accuracy_m?: number | null
          captured_at: string
          client_seq: number
          geom: unknown
          guard_id: string
          id?: string
          ingested_at?: string
          install_id: string
          is_keepalive?: boolean
          is_low_confidence?: boolean
          org_id: string
          partition_ts: string
          site_id: string
        }
        Update: {
          accuracy_m?: number | null
          captured_at?: string
          client_seq?: number
          geom?: unknown
          guard_id?: string
          id?: string
          ingested_at?: string
          install_id?: string
          is_keepalive?: boolean
          is_low_confidence?: boolean
          org_id?: string
          partition_ts?: string
          site_id?: string
        }
        Relationships: []
      }
      location_breadcrumbs_20260614: {
        Row: {
          accuracy_m: number | null
          captured_at: string
          client_seq: number
          geom: unknown
          guard_id: string
          id: string
          ingested_at: string
          install_id: string
          is_keepalive: boolean
          is_low_confidence: boolean
          org_id: string
          partition_ts: string
          site_id: string
        }
        Insert: {
          accuracy_m?: number | null
          captured_at: string
          client_seq: number
          geom: unknown
          guard_id: string
          id?: string
          ingested_at?: string
          install_id: string
          is_keepalive?: boolean
          is_low_confidence?: boolean
          org_id: string
          partition_ts: string
          site_id: string
        }
        Update: {
          accuracy_m?: number | null
          captured_at?: string
          client_seq?: number
          geom?: unknown
          guard_id?: string
          id?: string
          ingested_at?: string
          install_id?: string
          is_keepalive?: boolean
          is_low_confidence?: boolean
          org_id?: string
          partition_ts?: string
          site_id?: string
        }
        Relationships: []
      }
      location_breadcrumbs_20260615: {
        Row: {
          accuracy_m: number | null
          captured_at: string
          client_seq: number
          geom: unknown
          guard_id: string
          id: string
          ingested_at: string
          install_id: string
          is_keepalive: boolean
          is_low_confidence: boolean
          org_id: string
          partition_ts: string
          site_id: string
        }
        Insert: {
          accuracy_m?: number | null
          captured_at: string
          client_seq: number
          geom: unknown
          guard_id: string
          id?: string
          ingested_at?: string
          install_id: string
          is_keepalive?: boolean
          is_low_confidence?: boolean
          org_id: string
          partition_ts: string
          site_id: string
        }
        Update: {
          accuracy_m?: number | null
          captured_at?: string
          client_seq?: number
          geom?: unknown
          guard_id?: string
          id?: string
          ingested_at?: string
          install_id?: string
          is_keepalive?: boolean
          is_low_confidence?: boolean
          org_id?: string
          partition_ts?: string
          site_id?: string
        }
        Relationships: []
      }
      location_breadcrumbs_20260616: {
        Row: {
          accuracy_m: number | null
          captured_at: string
          client_seq: number
          geom: unknown
          guard_id: string
          id: string
          ingested_at: string
          install_id: string
          is_keepalive: boolean
          is_low_confidence: boolean
          org_id: string
          partition_ts: string
          site_id: string
        }
        Insert: {
          accuracy_m?: number | null
          captured_at: string
          client_seq: number
          geom: unknown
          guard_id: string
          id?: string
          ingested_at?: string
          install_id: string
          is_keepalive?: boolean
          is_low_confidence?: boolean
          org_id: string
          partition_ts: string
          site_id: string
        }
        Update: {
          accuracy_m?: number | null
          captured_at?: string
          client_seq?: number
          geom?: unknown
          guard_id?: string
          id?: string
          ingested_at?: string
          install_id?: string
          is_keepalive?: boolean
          is_low_confidence?: boolean
          org_id?: string
          partition_ts?: string
          site_id?: string
        }
        Relationships: []
      }
      location_breadcrumbs_20260617: {
        Row: {
          accuracy_m: number | null
          captured_at: string
          client_seq: number
          geom: unknown
          guard_id: string
          id: string
          ingested_at: string
          install_id: string
          is_keepalive: boolean
          is_low_confidence: boolean
          org_id: string
          partition_ts: string
          site_id: string
        }
        Insert: {
          accuracy_m?: number | null
          captured_at: string
          client_seq: number
          geom: unknown
          guard_id: string
          id?: string
          ingested_at?: string
          install_id: string
          is_keepalive?: boolean
          is_low_confidence?: boolean
          org_id: string
          partition_ts: string
          site_id: string
        }
        Update: {
          accuracy_m?: number | null
          captured_at?: string
          client_seq?: number
          geom?: unknown
          guard_id?: string
          id?: string
          ingested_at?: string
          install_id?: string
          is_keepalive?: boolean
          is_low_confidence?: boolean
          org_id?: string
          partition_ts?: string
          site_id?: string
        }
        Relationships: []
      }
      location_breadcrumbs_20260618: {
        Row: {
          accuracy_m: number | null
          captured_at: string
          client_seq: number
          geom: unknown
          guard_id: string
          id: string
          ingested_at: string
          install_id: string
          is_keepalive: boolean
          is_low_confidence: boolean
          org_id: string
          partition_ts: string
          site_id: string
        }
        Insert: {
          accuracy_m?: number | null
          captured_at: string
          client_seq: number
          geom: unknown
          guard_id: string
          id?: string
          ingested_at?: string
          install_id: string
          is_keepalive?: boolean
          is_low_confidence?: boolean
          org_id: string
          partition_ts: string
          site_id: string
        }
        Update: {
          accuracy_m?: number | null
          captured_at?: string
          client_seq?: number
          geom?: unknown
          guard_id?: string
          id?: string
          ingested_at?: string
          install_id?: string
          is_keepalive?: boolean
          is_low_confidence?: boolean
          org_id?: string
          partition_ts?: string
          site_id?: string
        }
        Relationships: []
      }
      location_breadcrumbs_20260619: {
        Row: {
          accuracy_m: number | null
          captured_at: string
          client_seq: number
          geom: unknown
          guard_id: string
          id: string
          ingested_at: string
          install_id: string
          is_keepalive: boolean
          is_low_confidence: boolean
          org_id: string
          partition_ts: string
          site_id: string
        }
        Insert: {
          accuracy_m?: number | null
          captured_at: string
          client_seq: number
          geom: unknown
          guard_id: string
          id?: string
          ingested_at?: string
          install_id: string
          is_keepalive?: boolean
          is_low_confidence?: boolean
          org_id: string
          partition_ts: string
          site_id: string
        }
        Update: {
          accuracy_m?: number | null
          captured_at?: string
          client_seq?: number
          geom?: unknown
          guard_id?: string
          id?: string
          ingested_at?: string
          install_id?: string
          is_keepalive?: boolean
          is_low_confidence?: boolean
          org_id?: string
          partition_ts?: string
          site_id?: string
        }
        Relationships: []
      }
      location_breadcrumbs_20260620: {
        Row: {
          accuracy_m: number | null
          captured_at: string
          client_seq: number
          geom: unknown
          guard_id: string
          id: string
          ingested_at: string
          install_id: string
          is_keepalive: boolean
          is_low_confidence: boolean
          org_id: string
          partition_ts: string
          site_id: string
        }
        Insert: {
          accuracy_m?: number | null
          captured_at: string
          client_seq: number
          geom: unknown
          guard_id: string
          id?: string
          ingested_at?: string
          install_id: string
          is_keepalive?: boolean
          is_low_confidence?: boolean
          org_id: string
          partition_ts: string
          site_id: string
        }
        Update: {
          accuracy_m?: number | null
          captured_at?: string
          client_seq?: number
          geom?: unknown
          guard_id?: string
          id?: string
          ingested_at?: string
          install_id?: string
          is_keepalive?: boolean
          is_low_confidence?: boolean
          org_id?: string
          partition_ts?: string
          site_id?: string
        }
        Relationships: []
      }
      location_breadcrumbs_20260621: {
        Row: {
          accuracy_m: number | null
          captured_at: string
          client_seq: number
          geom: unknown
          guard_id: string
          id: string
          ingested_at: string
          install_id: string
          is_keepalive: boolean
          is_low_confidence: boolean
          org_id: string
          partition_ts: string
          site_id: string
        }
        Insert: {
          accuracy_m?: number | null
          captured_at: string
          client_seq: number
          geom: unknown
          guard_id: string
          id?: string
          ingested_at?: string
          install_id: string
          is_keepalive?: boolean
          is_low_confidence?: boolean
          org_id: string
          partition_ts: string
          site_id: string
        }
        Update: {
          accuracy_m?: number | null
          captured_at?: string
          client_seq?: number
          geom?: unknown
          guard_id?: string
          id?: string
          ingested_at?: string
          install_id?: string
          is_keepalive?: boolean
          is_low_confidence?: boolean
          org_id?: string
          partition_ts?: string
          site_id?: string
        }
        Relationships: []
      }
      location_breadcrumbs_20260622: {
        Row: {
          accuracy_m: number | null
          captured_at: string
          client_seq: number
          geom: unknown
          guard_id: string
          id: string
          ingested_at: string
          install_id: string
          is_keepalive: boolean
          is_low_confidence: boolean
          org_id: string
          partition_ts: string
          site_id: string
        }
        Insert: {
          accuracy_m?: number | null
          captured_at: string
          client_seq: number
          geom: unknown
          guard_id: string
          id?: string
          ingested_at?: string
          install_id: string
          is_keepalive?: boolean
          is_low_confidence?: boolean
          org_id: string
          partition_ts: string
          site_id: string
        }
        Update: {
          accuracy_m?: number | null
          captured_at?: string
          client_seq?: number
          geom?: unknown
          guard_id?: string
          id?: string
          ingested_at?: string
          install_id?: string
          is_keepalive?: boolean
          is_low_confidence?: boolean
          org_id?: string
          partition_ts?: string
          site_id?: string
        }
        Relationships: []
      }
      location_breadcrumbs_20260623: {
        Row: {
          accuracy_m: number | null
          captured_at: string
          client_seq: number
          geom: unknown
          guard_id: string
          id: string
          ingested_at: string
          install_id: string
          is_keepalive: boolean
          is_low_confidence: boolean
          org_id: string
          partition_ts: string
          site_id: string
        }
        Insert: {
          accuracy_m?: number | null
          captured_at: string
          client_seq: number
          geom: unknown
          guard_id: string
          id?: string
          ingested_at?: string
          install_id: string
          is_keepalive?: boolean
          is_low_confidence?: boolean
          org_id: string
          partition_ts: string
          site_id: string
        }
        Update: {
          accuracy_m?: number | null
          captured_at?: string
          client_seq?: number
          geom?: unknown
          guard_id?: string
          id?: string
          ingested_at?: string
          install_id?: string
          is_keepalive?: boolean
          is_low_confidence?: boolean
          org_id?: string
          partition_ts?: string
          site_id?: string
        }
        Relationships: []
      }
      location_breadcrumbs_20260624: {
        Row: {
          accuracy_m: number | null
          captured_at: string
          client_seq: number
          geom: unknown
          guard_id: string
          id: string
          ingested_at: string
          install_id: string
          is_keepalive: boolean
          is_low_confidence: boolean
          org_id: string
          partition_ts: string
          site_id: string
        }
        Insert: {
          accuracy_m?: number | null
          captured_at: string
          client_seq: number
          geom: unknown
          guard_id: string
          id?: string
          ingested_at?: string
          install_id: string
          is_keepalive?: boolean
          is_low_confidence?: boolean
          org_id: string
          partition_ts: string
          site_id: string
        }
        Update: {
          accuracy_m?: number | null
          captured_at?: string
          client_seq?: number
          geom?: unknown
          guard_id?: string
          id?: string
          ingested_at?: string
          install_id?: string
          is_keepalive?: boolean
          is_low_confidence?: boolean
          org_id?: string
          partition_ts?: string
          site_id?: string
        }
        Relationships: []
      }
      location_breadcrumbs_20260625: {
        Row: {
          accuracy_m: number | null
          captured_at: string
          client_seq: number
          geom: unknown
          guard_id: string
          id: string
          ingested_at: string
          install_id: string
          is_keepalive: boolean
          is_low_confidence: boolean
          org_id: string
          partition_ts: string
          site_id: string
        }
        Insert: {
          accuracy_m?: number | null
          captured_at: string
          client_seq: number
          geom: unknown
          guard_id: string
          id?: string
          ingested_at?: string
          install_id: string
          is_keepalive?: boolean
          is_low_confidence?: boolean
          org_id: string
          partition_ts: string
          site_id: string
        }
        Update: {
          accuracy_m?: number | null
          captured_at?: string
          client_seq?: number
          geom?: unknown
          guard_id?: string
          id?: string
          ingested_at?: string
          install_id?: string
          is_keepalive?: boolean
          is_low_confidence?: boolean
          org_id?: string
          partition_ts?: string
          site_id?: string
        }
        Relationships: []
      }
      location_breadcrumbs_20260626: {
        Row: {
          accuracy_m: number | null
          captured_at: string
          client_seq: number
          geom: unknown
          guard_id: string
          id: string
          ingested_at: string
          install_id: string
          is_keepalive: boolean
          is_low_confidence: boolean
          org_id: string
          partition_ts: string
          site_id: string
        }
        Insert: {
          accuracy_m?: number | null
          captured_at: string
          client_seq: number
          geom: unknown
          guard_id: string
          id?: string
          ingested_at?: string
          install_id: string
          is_keepalive?: boolean
          is_low_confidence?: boolean
          org_id: string
          partition_ts: string
          site_id: string
        }
        Update: {
          accuracy_m?: number | null
          captured_at?: string
          client_seq?: number
          geom?: unknown
          guard_id?: string
          id?: string
          ingested_at?: string
          install_id?: string
          is_keepalive?: boolean
          is_low_confidence?: boolean
          org_id?: string
          partition_ts?: string
          site_id?: string
        }
        Relationships: []
      }
      location_breadcrumbs_20260627: {
        Row: {
          accuracy_m: number | null
          captured_at: string
          client_seq: number
          geom: unknown
          guard_id: string
          id: string
          ingested_at: string
          install_id: string
          is_keepalive: boolean
          is_low_confidence: boolean
          org_id: string
          partition_ts: string
          site_id: string
        }
        Insert: {
          accuracy_m?: number | null
          captured_at: string
          client_seq: number
          geom: unknown
          guard_id: string
          id?: string
          ingested_at?: string
          install_id: string
          is_keepalive?: boolean
          is_low_confidence?: boolean
          org_id: string
          partition_ts: string
          site_id: string
        }
        Update: {
          accuracy_m?: number | null
          captured_at?: string
          client_seq?: number
          geom?: unknown
          guard_id?: string
          id?: string
          ingested_at?: string
          install_id?: string
          is_keepalive?: boolean
          is_low_confidence?: boolean
          org_id?: string
          partition_ts?: string
          site_id?: string
        }
        Relationships: []
      }
      location_breadcrumbs_20260628: {
        Row: {
          accuracy_m: number | null
          captured_at: string
          client_seq: number
          geom: unknown
          guard_id: string
          id: string
          ingested_at: string
          install_id: string
          is_keepalive: boolean
          is_low_confidence: boolean
          org_id: string
          partition_ts: string
          site_id: string
        }
        Insert: {
          accuracy_m?: number | null
          captured_at: string
          client_seq: number
          geom: unknown
          guard_id: string
          id?: string
          ingested_at?: string
          install_id: string
          is_keepalive?: boolean
          is_low_confidence?: boolean
          org_id: string
          partition_ts: string
          site_id: string
        }
        Update: {
          accuracy_m?: number | null
          captured_at?: string
          client_seq?: number
          geom?: unknown
          guard_id?: string
          id?: string
          ingested_at?: string
          install_id?: string
          is_keepalive?: boolean
          is_low_confidence?: boolean
          org_id?: string
          partition_ts?: string
          site_id?: string
        }
        Relationships: []
      }
      location_breadcrumbs_20260629: {
        Row: {
          accuracy_m: number | null
          captured_at: string
          client_seq: number
          geom: unknown
          guard_id: string
          id: string
          ingested_at: string
          install_id: string
          is_keepalive: boolean
          is_low_confidence: boolean
          org_id: string
          partition_ts: string
          site_id: string
        }
        Insert: {
          accuracy_m?: number | null
          captured_at: string
          client_seq: number
          geom: unknown
          guard_id: string
          id?: string
          ingested_at?: string
          install_id: string
          is_keepalive?: boolean
          is_low_confidence?: boolean
          org_id: string
          partition_ts: string
          site_id: string
        }
        Update: {
          accuracy_m?: number | null
          captured_at?: string
          client_seq?: number
          geom?: unknown
          guard_id?: string
          id?: string
          ingested_at?: string
          install_id?: string
          is_keepalive?: boolean
          is_low_confidence?: boolean
          org_id?: string
          partition_ts?: string
          site_id?: string
        }
        Relationships: []
      }
      location_breadcrumbs_20260630: {
        Row: {
          accuracy_m: number | null
          captured_at: string
          client_seq: number
          geom: unknown
          guard_id: string
          id: string
          ingested_at: string
          install_id: string
          is_keepalive: boolean
          is_low_confidence: boolean
          org_id: string
          partition_ts: string
          site_id: string
        }
        Insert: {
          accuracy_m?: number | null
          captured_at: string
          client_seq: number
          geom: unknown
          guard_id: string
          id?: string
          ingested_at?: string
          install_id: string
          is_keepalive?: boolean
          is_low_confidence?: boolean
          org_id: string
          partition_ts: string
          site_id: string
        }
        Update: {
          accuracy_m?: number | null
          captured_at?: string
          client_seq?: number
          geom?: unknown
          guard_id?: string
          id?: string
          ingested_at?: string
          install_id?: string
          is_keepalive?: boolean
          is_low_confidence?: boolean
          org_id?: string
          partition_ts?: string
          site_id?: string
        }
        Relationships: []
      }
      location_breadcrumbs_default: {
        Row: {
          accuracy_m: number | null
          captured_at: string
          client_seq: number
          geom: unknown
          guard_id: string
          id: string
          ingested_at: string
          install_id: string
          is_keepalive: boolean
          is_low_confidence: boolean
          org_id: string
          partition_ts: string
          site_id: string
        }
        Insert: {
          accuracy_m?: number | null
          captured_at: string
          client_seq: number
          geom: unknown
          guard_id: string
          id?: string
          ingested_at?: string
          install_id: string
          is_keepalive?: boolean
          is_low_confidence?: boolean
          org_id: string
          partition_ts: string
          site_id: string
        }
        Update: {
          accuracy_m?: number | null
          captured_at?: string
          client_seq?: number
          geom?: unknown
          guard_id?: string
          id?: string
          ingested_at?: string
          install_id?: string
          is_keepalive?: boolean
          is_low_confidence?: boolean
          org_id?: string
          partition_ts?: string
          site_id?: string
        }
        Relationships: []
      }
      memberships: {
        Row: {
          active: boolean
          created_at: string
          id: string
          org_id: string
          role: Database["public"]["Enums"]["membership_role"]
          site_ids: string[]
          user_id: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          org_id: string
          role: Database["public"]["Enums"]["membership_role"]
          site_ids?: string[]
          user_id: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          org_id?: string
          role?: Database["public"]["Enums"]["membership_role"]
          site_ids?: string[]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "memberships_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      org_settings: {
        Row: {
          created_at: string
          dpia_completed_at: string | null
          lawful_basis: Database["public"]["Enums"]["lawful_basis"]
          org_id: string
          plan: string
          retention_days: number
          seat_limit: number
          tracking_mode: Database["public"]["Enums"]["tracking_mode"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          dpia_completed_at?: string | null
          lawful_basis?: Database["public"]["Enums"]["lawful_basis"]
          org_id: string
          plan?: string
          retention_days?: number
          seat_limit?: number
          tracking_mode?: Database["public"]["Enums"]["tracking_mode"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          dpia_completed_at?: string | null
          lawful_basis?: Database["public"]["Enums"]["lawful_basis"]
          org_id?: string
          plan?: string
          retention_days?: number
          seat_limit?: number
          tracking_mode?: Database["public"]["Enums"]["tracking_mode"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "org_settings_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          created_at: string
          id: string
          name: string
          stripe_customer_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          stripe_customer_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          stripe_customer_id?: string | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          color: string | null
          created_at: string
          display_name: string | null
          id: string
        }
        Insert: {
          color?: string | null
          created_at?: string
          display_name?: string | null
          id: string
        }
        Update: {
          color?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
        }
        Relationships: []
      }
      shifts: {
        Row: {
          auto_closed: boolean
          clock_in: string
          clock_out: string | null
          created_at: string
          guard_id: string
          id: string
          org_id: string
          site_id: string
        }
        Insert: {
          auto_closed?: boolean
          clock_in: string
          clock_out?: string | null
          created_at?: string
          guard_id: string
          id?: string
          org_id: string
          site_id: string
        }
        Update: {
          auto_closed?: boolean
          clock_in?: string
          clock_out?: string | null
          created_at?: string
          guard_id?: string
          id?: string
          org_id?: string
          site_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "shifts_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      sites: {
        Row: {
          created_at: string
          geofence: unknown
          id: string
          name: string
          org_id: string
        }
        Insert: {
          created_at?: string
          geofence?: unknown
          id?: string
          name: string
          org_id: string
        }
        Update: {
          created_at?: string
          geofence?: unknown
          id?: string
          name?: string
          org_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sites_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      auto_close_forgotten_shifts: { Args: never; Returns: number }
      batch_insert_breadcrumbs: { Args: { p_rows: Json }; Returns: Json }
      clock_in: { Args: { p_at?: string; p_site: string }; Returns: string }
      clock_out: { Args: { p_at?: string }; Returns: string }
      custom_access_token_hook: { Args: { event: Json }; Returns: Json }
      drop_aged_partitions: {
        Args: { p_global_max_days?: number }
        Returns: number
      }
      ensure_breadcrumb_partitions: {
        Args: { p_ahead?: number; p_behind?: number }
        Returns: number
      }
      purge_aged_audit_log: { Args: { p_keep_days?: number }; Returns: number }
      purge_expired_breadcrumbs: { Args: never; Returns: number }
      tag_checkpoint: {
        Args: { p_label?: string; p_lat: number; p_lon: number; p_site: string }
        Returns: string
      }
      trail_window: {
        Args: { p_minutes: number; p_site: string }
        Returns: {
          accuracy_m: number
          captured_at: string
          guard_id: string
          lat: number
          lon: number
        }[]
      }
      trailme_captured_at_is_insane: {
        Args: { p_captured_at: string }
        Returns: boolean
      }
      trailme_max_shift_interval: { Args: never; Returns: string }
      trailme_partition_ts: { Args: { p_captured_at: string }; Returns: string }
      trailme_uuid: { Args: never; Returns: string }
      write_audit_log: {
        Args: {
          p_action: Database["public"]["Enums"]["audit_action"]
          p_actor_user_id: string
          p_org_id: string
          p_params?: Json
          p_target_guard_id?: string
        }
        Returns: undefined
      }
    }
    Enums: {
      audit_action:
        | "trail_window_read"
        | "dsar_export"
        | "erasure"
        | "settings_change"
        | "channel_join_sampled"
      erasure_strategy: "delete" | "anonymize" | "retain_legal"
      lawful_basis: "legitimate_interest" | "consent"
      membership_role: "org_admin" | "supervisor" | "guard"
      tracking_mode: "shift_gated" | "always_on"
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      audit_action: [
        "trail_window_read",
        "dsar_export",
        "erasure",
        "settings_change",
        "channel_join_sampled",
      ],
      erasure_strategy: ["delete", "anonymize", "retain_legal"],
      lawful_basis: ["legitimate_interest", "consent"],
      membership_role: ["org_admin", "supervisor", "guard"],
      tracking_mode: ["shift_gated", "always_on"],
    },
  },
} as const
