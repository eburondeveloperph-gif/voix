import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export type Database = {
  public: {
    Tables: {
      user_profiles: {
        Row: {
          user_id: string;
          email: string | null;
          auth_display_name: string | null;
          preferred_name: string;
          preferred_address: string;
          avatar_url: string | null;
          beatrice_system_prompt: string | null;
          relationship_to_jo: 'associate' | 'principal';
          onboarding_completed: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          email?: string | null;
          auth_display_name?: string | null;
          preferred_name: string;
          preferred_address: string;
          avatar_url?: string | null;
          beatrice_system_prompt?: string | null;
          relationship_to_jo?: 'associate' | 'principal';
          onboarding_completed?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          user_id?: string;
          email?: string | null;
          auth_display_name?: string | null;
          preferred_name?: string;
          preferred_address?: string;
          avatar_url?: string | null;
          beatrice_system_prompt?: string | null;
          relationship_to_jo?: 'associate' | 'principal';
          onboarding_completed?: boolean;
          created_at?: string;
          updated_at?: string;
        };
      };
      documents: {
        Row: {
          document_id: string;
          owner_user_id: string;
          title: string;
          source: string;
          file_url: string | null;
          raw_image_data_url: string | null;
          ocr: unknown;
          analysis: unknown;
          embedding_vector: number[] | null;
          memory: unknown;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          document_id: string;
          owner_user_id: string;
          title: string;
          source: string;
          file_url?: string | null;
          raw_image_data_url?: string | null;
          ocr: unknown;
          analysis: unknown;
          embedding_vector?: number[] | null;
          memory?: unknown;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          document_id?: string;
          owner_user_id?: string;
          title?: string;
          source?: string;
          file_url?: string | null;
          raw_image_data_url?: string | null;
          ocr?: unknown;
          analysis?: unknown;
          embedding_vector?: number[] | null;
          memory?: unknown;
          created_at?: string;
          updated_at?: string;
        };
      };
      document_chunks: {
        Row: {
          chunk_id: string;
          document_id: string;
          owner_user_id: string;
          chunk_index: number;
          text: string;
          embedding_vector: number[] | null;
          created_at: string;
        };
        Insert: {
          chunk_id: string;
          document_id: string;
          owner_user_id: string;
          chunk_index: number;
          text: string;
          embedding_vector?: number[] | null;
          created_at?: string;
        };
        Update: {
          chunk_id?: string;
          document_id?: string;
          owner_user_id?: string;
          chunk_index?: number;
          text?: string;
          embedding_vector?: number[] | null;
          created_at?: string;
        };
      };
      memories: {
        Row: {
          id: string;
          document_id: string;
          memory_type: 'long';
          session_id: string;
          owner_user_id: string;
          source: string;
          raw_ocr_text: string;
          cleaned_text: string;
          detected_language: string;
          document_type: string;
          short_summary: string;
          detailed_summary: string;
          key_points: string[];
          important_entities: string[];
          action_items: string[];
          last_used_at: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          document_id: string;
          memory_type?: 'long';
          session_id: string;
          owner_user_id: string;
          source: string;
          raw_ocr_text: string;
          cleaned_text: string;
          detected_language: string;
          document_type: string;
          short_summary: string;
          detailed_summary: string;
          key_points: string[];
          important_entities: string[];
          action_items: string[];
          last_used_at: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          document_id?: string;
          memory_type?: 'long';
          session_id?: string;
          owner_user_id?: string;
          source?: string;
          raw_ocr_text?: string;
          cleaned_text?: string;
          detected_language?: string;
          document_type?: string;
          short_summary?: string;
          detailed_summary?: string;
          key_points?: string[];
          important_entities?: string[];
          action_items?: string[];
          last_used_at?: string;
          created_at?: string;
          updated_at?: string;
        };
      };
      scan_events: {
        Row: {
          event_id: string;
          document_id: string;
          user_id: string;
          event_type: string;
          payload: unknown;
          created_at: string;
        };
        Insert: {
          event_id: string;
          document_id: string;
          user_id: string;
          event_type: string;
          payload: unknown;
          created_at?: string;
        };
        Update: {
          event_id?: string;
          document_id?: string;
          user_id?: string;
          event_type?: string;
          payload?: unknown;
          created_at?: string;
        };
      };
      scan_memory_settings: {
        Row: {
          user_id: string;
          memoryRetention: string;
          saveRawOcrText: boolean;
          privateScanMode: boolean;
          saveOriginalImage: boolean;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          memoryRetention?: string;
          saveRawOcrText?: boolean;
          privateScanMode?: boolean;
          saveOriginalImage?: boolean;
          updated_at?: string;
        };
        Update: {
          user_id?: string;
          memoryRetention?: string;
          saveRawOcrText?: boolean;
          privateScanMode?: boolean;
          saveOriginalImage?: boolean;
          updated_at?: string;
        };
      };
    };
  };
};

