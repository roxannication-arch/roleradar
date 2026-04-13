export type UserRole = "admin" | "consultant";

export type CandidateLevel = "auto" | "junior" | "middle" | "senior";
export type CompanySize = "startup" | "scaleup" | "enterprise";
export type OutreachStatus = "Найдено" | "Outreach отправлен" | "Ответ получен" | "В процессе" | "Закрыто";
export type WorkspaceTab = "jobs" | "signals";
export type SignalTrigger = "funding" | "expansion" | "key_hire" | "contract";
export type SignalPriority = "hot" | "warm" | "cold";

export type ClientRecord = {
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

export type ResumeProfile = {
  jobTitlesCurrent: string[];
  jobTitlesTarget: string[];
  totalYearsExperience: number | null;
  topSkills: string[];
  industries: string[];
  seniorityLevel: string;
  location: string;
  preferredCompanySize: string;
};

export type ResumeAnalysisRecord = {
  client_id: string;
  profile: ResumeProfile;
  timestamp: number;
  source_fingerprint: string;
  updated_at: string;
};

export type JobRecord = {
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
  created_at: string;
  updated_at: string;
};

export type SignalRecord = {
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
  created_at: string;
  updated_at: string;
};

export type ProfileRecord = {
  id: string;
  email: string | null;
  full_name: string | null;
  role: UserRole;
  created_at: string;
  updated_at: string;
};
