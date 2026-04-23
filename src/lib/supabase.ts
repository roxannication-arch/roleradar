"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type {
  CandidateLevel,
  CompanySize,
  OutreachStatus,
  ResumeProfile,
  SignalPriority,
  SignalTrigger,
  UserRole,
} from "./db-types";

export type ProfileRow = {
  id: string;
  email: string | null;
  role: UserRole;
  full_name: string | null;
  created_at: string;
  updated_at: string;
};

export type ClientRow = {
  id: string;
  consultant_id: string;
  name: string;
  resume: string;
  resume_file_name: string | null;
  resume_file_signature: string | null;
  target_role: string;
  location: string;
  experience_years: string;
  candidate_level: CandidateLevel;
  preferred_company_sizes: CompanySize[];
  last_analyzed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ClientInsert = {
  id?: string;
  consultant_id: string;
  name: string;
  resume: string;
  resume_file_name?: string | null;
  resume_file_signature?: string | null;
  target_role: string;
  location: string;
  experience_years: string;
  candidate_level: CandidateLevel;
  preferred_company_sizes: CompanySize[];
  last_analyzed_at?: string | null;
};

export type ResumeAnalysisRow = {
  id: string;
  client_id: string;
  profile: ResumeProfile;
  source_fingerprint: string;
  updated_at: string;
};

export type ResumeAnalysisInsert = {
  id?: string;
  client_id: string;
  profile: ResumeProfile;
  source_fingerprint: string;
};

export type JobRow = {
  id: string;
  client_id: string;
  title: string;
  company: string;
  location: string;
  url: string;
  posted_at: string | null;
  source_variant: string;
  company_size: CompanySize | "unknown";
  hiring_contact_role: string;
  evidence: string;
  outreach_message: string;
  fit_score: number;
  fit_reason: string;
  status: OutreachStatus;
  updated_at: string;
};

export type JobInsert = {
  id?: string;
  client_id: string;
  title: string;
  company: string;
  location: string;
  url: string;
  posted_at?: string | null;
  source_variant: string;
  company_size: CompanySize | "unknown";
  hiring_contact_role: string;
  evidence: string;
  outreach_message: string;
  fit_score: number;
  fit_reason: string;
  status: OutreachStatus;
};

export type SignalRow = {
  id: string;
  client_id: string;
  company: string;
  trigger_type: SignalTrigger;
  priority: SignalPriority;
  hiring_manager: string;
  evidence: string;
  source_url: string;
  outreach_message: string;
  status: OutreachStatus;
  updated_at: string;
};

export type SignalInsert = {
  id?: string;
  client_id: string;
  company: string;
  trigger_type: SignalTrigger;
  priority: SignalPriority;
  hiring_manager: string;
  evidence: string;
  source_url: string;
  outreach_message: string;
  status: OutreachStatus;
};

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: ProfileRow;
        Insert: Omit<ProfileRow, "created_at" | "updated_at">;
        Update: Partial<Omit<ProfileRow, "id" | "created_at" | "updated_at">>;
        Relationships: [];
      };
      clients: {
        Row: ClientRow;
        Insert: ClientInsert;
        Update: Partial<Omit<ClientRow, "id" | "created_at" | "updated_at">>;
        Relationships: [];
      };
      resume_analysis: {
        Row: ResumeAnalysisRow;
        Insert: ResumeAnalysisInsert;
        Update: Partial<Omit<ResumeAnalysisRow, "id" | "client_id" | "updated_at">>;
        Relationships: [];
      };
      jobs: {
        Row: JobRow;
        Insert: JobInsert;
        Update: Partial<Omit<JobRow, "id" | "client_id" | "updated_at">>;
        Relationships: [];
      };
      signals: {
        Row: SignalRow;
        Insert: SignalInsert;
        Update: Partial<Omit<SignalRow, "id" | "client_id" | "updated_at">>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

let browserClient: SupabaseClient<Database> | null = null;

export function getSupabaseBrowserClient(): SupabaseClient<Database> {
  if (browserClient) return browserClient;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error("Supabase env vars are missing (NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY).");
  }
  browserClient = createClient<Database>(url, anonKey);
  return browserClient;
}
