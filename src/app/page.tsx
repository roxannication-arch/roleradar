"use client";

import { ChangeEvent, ClipboardEvent, DragEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { type User } from "@supabase/supabase-js";

import type { UserRole } from "@/lib/db-types";
import {
  getSupabaseBrowserClient,
  type ClientRow,
  type Database,
  type JobRow,
  type ProfileRow,
  type ResumeAnalysisRow,
  type SignalRow,
} from "@/lib/supabase";

type CandidateLevel = "auto" | "junior" | "middle" | "senior";
type CompanySize = "startup" | "scaleup" | "enterprise";
type OutreachStatus = "Найдено" | "Outreach отправлен" | "Ответ получен" | "В процессе" | "Закрыто";
type WorkspaceTab = "jobs" | "signals";
type SignalTrigger = "funding" | "expansion" | "key_hire" | "contract";
type SignalPriority = "hot" | "warm" | "cold";

type Client = {
  id: string;
  consultantId: string;
  name: string;
  resume: string;
  resumeFileName?: string;
  resumeFileSignature?: string;
  targetRole: string;
  location: string;
  experienceYears: string;
  candidateLevel: CandidateLevel;
  preferredCompanySizes: CompanySize[];
  lastAnalyzedAt?: string;
};

type ResumeProfile = {
  jobTitlesCurrent: string[];
  jobTitlesTarget: string[];
  totalYearsExperience: number | null;
  topSkills: string[];
  industries: string[];
  seniorityLevel: string;
  location: string;
  preferredCompanySize: string;
};

type ResumeAnalysisEntry = {
  profile: ResumeProfile;
  timestamp: number;
  sourceFingerprint: string;
};

type JobItem = {
  id: string;
  title: string;
  company: string;
  location: string;
  url: string;
  postedAt?: string;
  sourceVariant: string;
  companySize: CompanySize | "unknown";
  hiringContactRole: string;
  evidence: string;
  outreachMessage: string;
  fitScore: number;
  fitReason: string;
  status: OutreachStatus;
};

type GrowthSignal = {
  id: string;
  company: string;
  triggerType: SignalTrigger;
  priority: SignalPriority;
  hiringManager: string;
  evidence: string;
  sourceUrl: string;
  outreachMessage: string;
  status: OutreachStatus;
};

type JobsCacheEntry = {
  items: JobItem[];
  timestamp: number;
};

type SignalsCacheEntry = {
  items: GrowthSignal[];
  timestamp: number;
};

type ConsultantOption = {
  id: string;
  email: string;
  role: UserRole;
  fullName: string | null;
};

type ClaudeResponseContentBlock = {
  type?: string;
  text?: string;
};

type LegacyJobApiItem = {
  id?: string;
  title?: string;
  company?: string;
  location?: string;
  matchScore?: number;
  fitReason?: string;
  applyUrl?: string;
  postedAt?: string;
  linkedinTargetRole?: string;
  outreachTip?: string;
};

type LegacyJobsPayload = {
  jobs?: LegacyJobApiItem[];
  exactMatches?: LegacyJobApiItem[];
  adjacentMatches?: LegacyJobApiItem[];
};

const OUTREACH_STATUS_OPTIONS: OutreachStatus[] = [
  "Найдено",
  "Outreach отправлен",
  "Ответ получен",
  "В процессе",
  "Закрыто",
];

const OUTREACH_STATUS_RANK: Record<OutreachStatus, number> = {
  Найдено: 0,
  "Outreach отправлен": 1,
  "Ответ получен": 2,
  "В процессе": 3,
  Закрыто: 4,
};

const CANDIDATE_LEVEL_OPTIONS: { value: CandidateLevel; label: string }[] = [
  { value: "auto", label: "Авто (по резюме)" },
  { value: "junior", label: "Junior" },
  { value: "middle", label: "Middle" },
  { value: "senior", label: "Senior" },
];

const COMPANY_SIZE_OPTIONS: { value: CompanySize; label: string }[] = [
  { value: "startup", label: "Стартап (до 200)" },
  { value: "scaleup", label: "Scale-up (200–1000)" },
  { value: "enterprise", label: "Корпорация (1000+)" },
];

const WEB_SEARCH_TOOL = {
  type: "web_search_20250305",
  name: "web_search",
  max_uses: 2,
};

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CLAUDE_PROXY_TIMEOUT_MS = 35000;

const LEGACY_CLIENTS_STORAGE_KEY = "roleradar.clients.v2";
const LEGACY_RESUME_ANALYSIS_STORAGE_KEY = "roleradar.resume-analysis.v1";
const LEGACY_JOBS_CACHE_STORAGE_KEY = "roleradar.jobs-cache.v1";
const LEGACY_SIGNALS_CACHE_STORAGE_KEY = "roleradar.signals-cache.v1";

function normalize(value: string): string {
  return value.toLowerCase().trim();
}

function tokenize(value: string): string[] {
  return normalize(value)
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 2);
}

function unique<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function todayRu(): string {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date());
}

function isCacheFresh(timestamp?: number): boolean {
  if (!timestamp) return false;
  return Date.now() - timestamp < CACHE_TTL_MS;
}

function relativeCacheAge(timestamp?: number): string {
  if (!timestamp) return "ещё не запускался";
  const diffMinutes = Math.floor((Date.now() - timestamp) / 60000);
  if (diffMinutes < 1) return "только что";
  if (diffMinutes < 60) return `${diffMinutes} мин назад`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours} ч назад`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays} д назад`;
}

function parseCandidateLevel(value: unknown): CandidateLevel {
  if (value === "junior" || value === "middle" || value === "senior" || value === "auto") {
    return value;
  }
  return "auto";
}

function parseCompanySizes(value: unknown): CompanySize[] {
  const allowed: CompanySize[] = ["startup", "scaleup", "enterprise"];
  if (!Array.isArray(value)) return [...allowed];
  const parsed = value.filter((size): size is CompanySize => allowed.includes(size as CompanySize));
  return parsed.length ? parsed : [...allowed];
}

function parseCompanySize(value: unknown): CompanySize | "unknown" {
  if (value === "startup" || value === "scaleup" || value === "enterprise") return value;
  return "unknown";
}

function parseOutreachStatus(value: unknown): OutreachStatus {
  if (
    value === "Найдено" ||
    value === "Outreach отправлен" ||
    value === "Ответ получен" ||
    value === "В процессе" ||
    value === "Закрыто"
  ) {
    return value;
  }
  return "Найдено";
}

function parseSignalPriority(value: unknown): SignalPriority {
  if (value === "hot" || value === "warm" || value === "cold") return value;
  return "warm";
}

function parseSignalTrigger(value: unknown): SignalTrigger {
  if (value === "funding" || value === "expansion" || value === "key_hire" || value === "contract") {
    return value;
  }
  return "contract";
}

function makeDbId(prefix: string): string {
  const random = Math.random().toString(36).slice(2, 10);
  return `${prefix}-${Date.now().toString(36)}-${random}`;
}

function normalizeJobUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    parsed.searchParams.delete("utm_source");
    parsed.searchParams.delete("utm_medium");
    parsed.searchParams.delete("utm_campaign");
    return parsed.toString();
  } catch {
    return url.trim();
  }
}

function makeStableId(parts: string[]): string {
  return parts
    .join("-")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 96);
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function timestampFromIso(value: string | null | undefined): number {
  if (!value) return Date.now();
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function extractClaudeText(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const record = payload as { content?: unknown; output_text?: unknown };
  const parts: string[] = [];
  if (typeof record.output_text === "string" && record.output_text.trim()) {
    parts.push(record.output_text);
  }
  if (Array.isArray(record.content)) {
    for (const block of record.content as ClaudeResponseContentBlock[]) {
      if (block?.type === "text" && typeof block.text === "string") {
        parts.push(block.text);
      }
    }
  }
  return parts.join("\n").trim();
}

function extractFromCodeFence(text: string): string | null {
  const fenceRegex = /```(?:json)?\s*([\s\S]*?)```/gi;
  let match: RegExpExecArray | null = null;
  let best: string | null = null;
  while (true) {
    match = fenceRegex.exec(text);
    if (!match) break;
    const candidate = (match[1] || "").trim();
    if (!candidate) continue;
    if (candidate.includes("{") || candidate.includes("[")) {
      if (!best || candidate.length > best.length) best = candidate;
    }
  }
  return best;
}

function extractFirstJsonValue(text: string): string | null {
  const fenced = extractFromCodeFence(text);
  if (fenced) return fenced;

  const firstBrace = text.search(/[\[{]/);
  if (firstBrace === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  let opening = "";
  for (let i = firstBrace; i < text.length; i += 1) {
    const ch = text[i];
    if (!opening && (ch === "{" || ch === "[")) {
      opening = ch;
      depth = 1;
      continue;
    }
    if (!opening) continue;
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{" || ch === "[") depth += 1;
    if (ch === "}" || ch === "]") depth -= 1;
    if (depth === 0) {
      return text.slice(firstBrace, i + 1).trim();
    }
  }
  return null;
}

function tryParseJsonCandidate<T>(text: string): T | null {
  const directCandidate = extractFirstJsonValue(text);
  const candidates = [directCandidate, text]
    .filter((item): item is string => Boolean(item))
    .map((item) => item.trim())
    .filter(Boolean);

  for (const candidate of candidates) {
    const normalized = candidate
      .replace(/^\s*json\s*/i, "")
      .replace(/[“”]/g, '"')
      .replace(/[‘’]/g, "'")
      .replace(/,\s*([}\]])/g, "$1");
    try {
      return JSON.parse(normalized) as T;
    } catch {
      // keep iterating
    }
  }
  return null;
}

function parseClaudeJson<T>(payload: unknown): T {
  const text = extractClaudeText(payload);
  if (!text) throw new Error("Claude вернул пустой ответ.");
  const parsed = tryParseJsonCandidate<T>(text);
  if (!parsed) throw new Error("Не удалось извлечь JSON из ответа Claude.");
  return parsed;
}

function humanizeClaudeError(error: unknown): string {
  if (!(error instanceof Error)) return "Не удалось выполнить запрос к Claude.";
  if (error.message.toLowerCase().includes("rate limit") || error.message.includes("429")) {
    return "Claude временно ограничил запросы. Подождите 30–60 секунд и запустите снова.";
  }
  return error.message;
}

async function callClaudeProxy(body: { messages: unknown[]; tools?: unknown[]; system?: string }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CLAUDE_PROXY_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch("/api/claude", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (error) {
    clearTimeout(timeout);
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("Запрос к Claude превысил лимит ожидания. Нажмите «Обновить».");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const details =
      payload && typeof payload === "object" && "message" in payload
        ? String((payload as { message: unknown }).message)
        : `status ${response.status}`;
    throw new Error(`Ошибка /api/claude: ${details}`);
  }
  return payload;
}

async function parseClaudeJsonWithRepair<T>(payload: unknown, schemaHint: string): Promise<T> {
  try {
    return parseClaudeJson<T>(payload);
  } catch {
    const rawText = extractClaudeText(payload);
    if (!rawText) throw new Error("Claude вернул пустой ответ.");
    const repairPrompt = [
      "Convert the following content into STRICT valid JSON only.",
      "Do not add explanations, markdown, or comments.",
      schemaHint,
      "",
      "Content to convert:",
      rawText.slice(0, 6000),
    ].join("\n");
    const repairPayload = await callClaudeProxy({
      messages: [{ role: "user", content: [{ type: "text", text: repairPrompt }] }],
    });
    return parseClaudeJson<T>(repairPayload);
  }
}

async function runInBatchesSettled<TInput, TOutput>(
  items: TInput[],
  batchSize: number,
  worker: (item: TInput) => Promise<TOutput>,
): Promise<{ fulfilled: TOutput[]; failed: number }> {
  const fulfilled: TOutput[] = [];
  let failed = 0;
  for (let i = 0; i < items.length; i += batchSize) {
    const chunk = items.slice(i, i + batchSize);
    const chunkResults = await Promise.allSettled(chunk.map((item) => worker(item)));
    for (const result of chunkResults) {
      if (result.status === "fulfilled") {
        fulfilled.push(result.value);
      } else {
        failed += 1;
      }
    }
    if (i + batchSize < items.length) await sleep(1200);
  }
  return { fulfilled, failed };
}

function scoreTone(score: number): string {
  if (score >= 85) return "bg-emerald-100 text-emerald-800 border-emerald-200";
  if (score >= 70) return "bg-amber-100 text-amber-800 border-amber-200";
  return "bg-slate-100 text-slate-700 border-slate-200";
}

function metricTone(index: number): string {
  const tones = [
    "from-blue-500/12 to-indigo-500/12 border-blue-200/70",
    "from-emerald-500/12 to-green-500/12 border-emerald-200/70",
    "from-fuchsia-500/12 to-violet-500/12 border-fuchsia-200/70",
    "from-amber-500/12 to-orange-500/12 border-amber-200/70",
    "from-cyan-500/12 to-sky-500/12 border-cyan-200/70",
    "from-rose-500/12 to-pink-500/12 border-rose-200/70",
    "from-slate-400/12 to-slate-500/12 border-slate-300/70",
  ];
  return tones[index % tones.length];
}

function statusReached(status: OutreachStatus, milestone: OutreachStatus): boolean {
  return OUTREACH_STATUS_RANK[status] >= OUTREACH_STATUS_RANK[milestone];
}

function detectSeniorityBand(value: string): Exclude<CandidateLevel, "auto"> {
  const text = normalize(value);
  if (
    text.includes("principal") ||
    text.includes("staff") ||
    text.includes("director") ||
    text.includes("head") ||
    text.includes("lead") ||
    text.includes("senior") ||
    text.includes("vp")
  ) {
    return "senior";
  }
  if (text.includes("junior") || text.includes("intern") || text.includes("entry")) {
    return "junior";
  }
  return "middle";
}

function normalizeResumeProfile(raw: unknown, fallbackLocation: string): ResumeProfile {
  const input = (raw || {}) as Record<string, unknown>;
  const toStringArray = (value: unknown, max = 10): string[] =>
    Array.isArray(value)
      ? value
          .map((item) => (typeof item === "string" ? item.trim() : ""))
          .filter(Boolean)
          .slice(0, max)
      : [];

  const yearsCandidate =
    typeof input.total_years_experience === "number"
      ? input.total_years_experience
      : typeof input.totalYearsExperience === "number"
        ? input.totalYearsExperience
        : null;

  const safeYears =
    yearsCandidate === null || Number.isNaN(yearsCandidate)
      ? null
      : clamp(Math.round(yearsCandidate), 0, 50);

  return {
    jobTitlesCurrent: toStringArray(input.job_titles_current ?? input.jobTitlesCurrent, 5),
    jobTitlesTarget: toStringArray(input.job_titles_target ?? input.jobTitlesTarget, 5),
    totalYearsExperience: safeYears,
    topSkills: toStringArray(input.top_10_skills ?? input.topSkills, 10),
    industries: toStringArray(input.industries, 8),
    seniorityLevel:
      typeof input.seniority_level === "string"
        ? input.seniority_level
        : typeof input.seniorityLevel === "string"
          ? input.seniorityLevel
          : "unknown",
    location:
      typeof input.location === "string" && input.location.trim()
        ? input.location.trim()
        : fallbackLocation,
    preferredCompanySize:
      typeof input.preferred_company_size === "string"
        ? input.preferred_company_size
        : typeof input.preferredCompanySize === "string"
          ? input.preferredCompanySize
          : "unknown",
  };
}

function mapClientRow(row: ClientRow): Client {
  return {
    id: row.id,
    consultantId: row.consultant_id,
    name: row.name,
    resume: row.resume,
    resumeFileName: row.resume_file_name ?? undefined,
    resumeFileSignature: row.resume_file_signature ?? undefined,
    targetRole: row.target_role,
    location: row.location,
    experienceYears: row.experience_years,
    candidateLevel: parseCandidateLevel(row.candidate_level),
    preferredCompanySizes: parseCompanySizes(row.preferred_company_sizes),
    lastAnalyzedAt: row.last_analyzed_at ?? undefined,
  };
}

type ClientRowUpdate = Database["public"]["Tables"]["clients"]["Update"];

function mapClientPatchToRow(patch: Partial<Client>): ClientRowUpdate {
  const mapped: ClientRowUpdate = {};
  if (patch.name !== undefined) mapped.name = patch.name;
  if (patch.resume !== undefined) mapped.resume = patch.resume;
  if (patch.resumeFileName !== undefined) mapped.resume_file_name = patch.resumeFileName ?? null;
  if (patch.resumeFileSignature !== undefined) mapped.resume_file_signature = patch.resumeFileSignature ?? null;
  if (patch.targetRole !== undefined) mapped.target_role = patch.targetRole;
  if (patch.location !== undefined) mapped.location = patch.location;
  if (patch.experienceYears !== undefined) mapped.experience_years = patch.experienceYears;
  if (patch.candidateLevel !== undefined) mapped.candidate_level = patch.candidateLevel;
  if (patch.preferredCompanySizes !== undefined) {
    mapped.preferred_company_sizes = patch.preferredCompanySizes;
  }
  if (patch.lastAnalyzedAt !== undefined) mapped.last_analyzed_at = patch.lastAnalyzedAt ?? null;
  if (patch.consultantId !== undefined) mapped.consultant_id = patch.consultantId;
  return mapped;
}

function mapJobRow(row: JobRow): JobItem {
  return {
    id: row.id,
    title: row.title,
    company: row.company,
    location: row.location,
    url: normalizeJobUrl(row.url),
    postedAt: row.posted_at ?? undefined,
    sourceVariant: row.source_variant,
    companySize: parseCompanySize(row.company_size),
    hiringContactRole: row.hiring_contact_role,
    evidence: row.evidence,
    outreachMessage: row.outreach_message,
    fitScore: clamp(row.fit_score, 0, 100),
    fitReason: row.fit_reason,
    status: parseOutreachStatus(row.status),
  };
}

function mapSignalRow(row: SignalRow): GrowthSignal {
  return {
    id: row.id,
    company: row.company,
    triggerType: parseSignalTrigger(row.trigger_type),
    priority: parseSignalPriority(row.priority),
    hiringManager: row.hiring_manager,
    evidence: row.evidence,
    sourceUrl: normalizeJobUrl(row.source_url),
    outreachMessage: row.outreach_message,
    status: parseOutreachStatus(row.status),
  };
}

function buildJobsCacheByClient(rows: JobRow[]): Record<string, JobsCacheEntry> {
  const grouped = new Map<string, JobRow[]>();
  for (const row of rows) {
    const list = grouped.get(row.client_id) ?? [];
    list.push(row);
    grouped.set(row.client_id, list);
  }
  const result: Record<string, JobsCacheEntry> = {};
  for (const [clientId, list] of grouped.entries()) {
    const timestamp = list.reduce(
      (max, row) => Math.max(max, timestampFromIso(row.updated_at)),
      0,
    );
    result[clientId] = {
      items: list.map(mapJobRow).sort((a, b) => b.fitScore - a.fitScore),
      timestamp: timestamp || Date.now(),
    };
  }
  return result;
}

function buildSignalsCacheByClient(rows: SignalRow[]): Record<string, SignalsCacheEntry> {
  const grouped = new Map<string, SignalRow[]>();
  for (const row of rows) {
    const list = grouped.get(row.client_id) ?? [];
    list.push(row);
    grouped.set(row.client_id, list);
  }
  const priorityRank: Record<SignalPriority, number> = { hot: 0, warm: 1, cold: 2 };
  const result: Record<string, SignalsCacheEntry> = {};
  for (const [clientId, list] of grouped.entries()) {
    const timestamp = list.reduce(
      (max, row) => Math.max(max, timestampFromIso(row.updated_at)),
      0,
    );
    result[clientId] = {
      items: list
        .map(mapSignalRow)
        .sort((a, b) => priorityRank[a.priority] - priorityRank[b.priority]),
      timestamp: timestamp || Date.now(),
    };
  }
  return result;
}

function buildResumeAnalysisByClient(rows: ResumeAnalysisRow[]): Record<string, ResumeAnalysisEntry> {
  const result: Record<string, ResumeAnalysisEntry> = {};
  for (const row of rows) {
    result[row.client_id] = {
      profile: row.profile,
      timestamp: timestampFromIso(row.updated_at),
      sourceFingerprint: row.source_fingerprint,
    };
  }
  return result;
}

function readLegacyJson<T>(key: string): T | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function normalizeLegacyClient(raw: unknown, index: number): Client | null {
  if (!raw || typeof raw !== "object") return null;
  const client = raw as Partial<Client>;
  if (!client.id || !client.name) return null;
  return {
    id: String(client.id || `legacy-${index}`),
    consultantId: String(client.consultantId || ""),
    name: String(client.name || `Клиент ${index + 1}`),
    resume: String(client.resume || ""),
    resumeFileName: client.resumeFileName ? String(client.resumeFileName) : undefined,
    resumeFileSignature: client.resumeFileSignature ? String(client.resumeFileSignature) : undefined,
    targetRole: String(client.targetRole || ""),
    location: String(client.location || ""),
    experienceYears: String(client.experienceYears || "3"),
    candidateLevel: parseCandidateLevel(client.candidateLevel),
    preferredCompanySizes: parseCompanySizes(client.preferredCompanySizes),
    lastAnalyzedAt: client.lastAnalyzedAt ? String(client.lastAnalyzedAt) : undefined,
  };
}

async function migrateLegacyLocalStorageData(
  supabase: ReturnType<typeof getSupabaseBrowserClient>,
  ownerUserId: string,
): Promise<boolean> {
  const legacyClientsRaw = readLegacyJson<unknown[]>(LEGACY_CLIENTS_STORAGE_KEY);
  if (!legacyClientsRaw || !Array.isArray(legacyClientsRaw) || !legacyClientsRaw.length) return false;

  const legacyResumeMap = readLegacyJson<Record<string, unknown>>(LEGACY_RESUME_ANALYSIS_STORAGE_KEY) || {};
  const legacyJobsMap = readLegacyJson<Record<string, unknown>>(LEGACY_JOBS_CACHE_STORAGE_KEY) || {};
  const legacySignalsMap = readLegacyJson<Record<string, unknown>>(LEGACY_SIGNALS_CACHE_STORAGE_KEY) || {};

  const legacyClients = legacyClientsRaw
    .map((item, index) => normalizeLegacyClient(item, index))
    .filter((item): item is Client => item !== null);
  if (!legacyClients.length) return false;

  for (const legacyClient of legacyClients) {
    const clientId = makeDbId("client");
    const { data: insertedClient, error: insertClientError } = await supabase
      .from("clients")
      .insert({
        id: clientId,
        consultant_id: ownerUserId,
        name: legacyClient.name,
        resume: legacyClient.resume,
        resume_file_name: legacyClient.resumeFileName ?? null,
        resume_file_signature: legacyClient.resumeFileSignature ?? null,
        target_role: legacyClient.targetRole,
        location: legacyClient.location,
        experience_years: legacyClient.experienceYears,
        candidate_level: legacyClient.candidateLevel,
        preferred_company_sizes: legacyClient.preferredCompanySizes,
        last_analyzed_at: legacyClient.lastAnalyzedAt ?? null,
      })
      .select("*")
      .single();
    if (insertClientError || !insertedClient) continue;

    const legacyResumeEntry = legacyResumeMap[legacyClient.id] as
      | { profile?: ResumeProfile; sourceFingerprint?: string }
      | undefined;
    if (legacyResumeEntry?.profile) {
      await supabase.from("resume_analysis").upsert(
        {
          id: makeDbId("resume"),
          client_id: insertedClient.id,
          profile: legacyResumeEntry.profile,
          source_fingerprint: legacyResumeEntry.sourceFingerprint || `${legacyClient.id}-legacy`,
        },
        { onConflict: "client_id" },
      );
    }

    const legacyJobsEntry = legacyJobsMap[legacyClient.id] as { items?: JobItem[] } | undefined;
    if (legacyJobsEntry?.items?.length) {
      const rows: Database["public"]["Tables"]["jobs"]["Insert"][] = legacyJobsEntry.items.map((job) => ({
        id: makeDbId("job"),
        client_id: insertedClient.id,
        title: job.title,
        company: job.company,
        location: job.location,
        url: normalizeJobUrl(job.url),
        posted_at: job.postedAt || null,
        source_variant: job.sourceVariant,
        company_size: job.companySize,
        hiring_contact_role: job.hiringContactRole,
        evidence: job.evidence,
        outreach_message: job.outreachMessage,
        fit_score: clamp(job.fitScore, 0, 100),
        fit_reason: job.fitReason,
        status: parseOutreachStatus(job.status),
      }));
      await supabase.from("jobs").insert(rows);
    }

    const legacySignalsEntry = legacySignalsMap[legacyClient.id] as { items?: GrowthSignal[] } | undefined;
    if (legacySignalsEntry?.items?.length) {
      const rows: Database["public"]["Tables"]["signals"]["Insert"][] = legacySignalsEntry.items.map(
        (signal) => ({
          id: makeDbId("signal"),
          client_id: insertedClient.id,
          company: signal.company,
          trigger_type: parseSignalTrigger(signal.triggerType),
          priority: parseSignalPriority(signal.priority),
          hiring_manager: signal.hiringManager,
          evidence: signal.evidence,
          source_url: normalizeJobUrl(signal.sourceUrl),
          outreach_message: signal.outreachMessage,
          status: parseOutreachStatus(signal.status),
        }),
      );
      await supabase.from("signals").insert(rows);
    }
  }

  return true;
}

export default function Home() {
  const [supabase, setSupabase] = useState<ReturnType<typeof getSupabaseBrowserClient> | null>(null);
  const [supabaseError, setSupabaseError] = useState<string>("");

  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [appLoading, setAppLoading] = useState(false);
  const [appError, setAppError] = useState("");

  const [user, setUser] = useState<User | null>(null);
  const [userRole, setUserRole] = useState<UserRole | null>(null);
  const [consultants, setConsultants] = useState<ConsultantOption[]>([]);
  const [isAdminUsersOpen, setIsAdminUsersOpen] = useState(false);
  const [isSavingUserProfiles, setIsSavingUserProfiles] = useState(false);

  const [authMode, setAuthMode] = useState<"signin" | "signup">("signin");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [authInfo, setAuthInfo] = useState("");
  const [isAuthActionLoading, setIsAuthActionLoading] = useState(false);
  const [adminPanelError, setAdminPanelError] = useState("");

  const [clients, setClients] = useState<Client[]>([]);
  const [activeClientId, setActiveClientId] = useState<string>("");
  const [newClientName, setNewClientName] = useState<string>("");
  const [newClientConsultantId, setNewClientConsultantId] = useState<string>("");

  const [generatedReport, setGeneratedReport] = useState<string>("");
  const [isReportOpen, setIsReportOpen] = useState(false);
  const [dragActive, setDragActive] = useState(false);

  const [resumeInputError, setResumeInputError] = useState<string>("");
  const [jobsError, setJobsError] = useState<string>("");
  const [signalsError, setSignalsError] = useState<string>("");
  const [isResumeAnalyzing, setIsResumeAnalyzing] = useState(false);
  const [isJobsLoading, setIsJobsLoading] = useState(false);
  const [isSignalsLoading, setIsSignalsLoading] = useState(false);
  const [workspaceTab, setWorkspaceTab] = useState<WorkspaceTab>("jobs");

  const [resumeAnalysisByClient, setResumeAnalysisByClient] = useState<Record<string, ResumeAnalysisEntry>>({});
  const [jobsCacheByClient, setJobsCacheByClient] = useState<Record<string, JobsCacheEntry>>({});
  const [signalsCacheByClient, setSignalsCacheByClient] = useState<Record<string, SignalsCacheEntry>>({});

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    try {
      const client = getSupabaseBrowserClient();
      setSupabase(client);
      void (async () => {
        const {
          data: { session },
          error,
        } = await client.auth.getSession();
        if (error) {
          setSupabaseError(error.message);
        } else {
          setUser(session?.user ?? null);
        }
        setIsAuthLoading(false);
      })();
      const { data: listener } = client.auth.onAuthStateChange((_event, session) => {
        setUser(session?.user ?? null);
        if (!session?.user) {
          setUserRole(null);
          setClients([]);
          setConsultants([]);
          setResumeAnalysisByClient({});
          setJobsCacheByClient({});
          setSignalsCacheByClient({});
          setActiveClientId("");
          setGeneratedReport("");
          setIsReportOpen(false);
        }
      });
      return () => {
        listener.subscription.unsubscribe();
      };
    } catch (error) {
      setSupabaseError(error instanceof Error ? error.message : "Не удалось инициализировать Supabase.");
      setIsAuthLoading(false);
    }
  }, []);

  async function ensureProfile(currentUser: User): Promise<ProfileRow> {
    if (!supabase) throw new Error("Supabase не инициализирован.");
    const { data: existing, error: existingError } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", currentUser.id)
      .maybeSingle();
    if (existingError) throw existingError;
    if (existing) return existing;

    const payload: Database["public"]["Tables"]["profiles"]["Insert"] = {
      id: currentUser.id,
      email: currentUser.email ?? null,
      role: "consultant",
      full_name:
        typeof currentUser.user_metadata?.full_name === "string"
          ? currentUser.user_metadata.full_name
          : null,
    };
    const { data: inserted, error: insertError } = await supabase
      .from("profiles")
      .insert(payload)
      .select("*")
      .single();
    if (insertError || !inserted) throw insertError ?? new Error("Не удалось создать профиль пользователя.");
    return inserted;
  }

  async function loadAllDataForUser(currentUser: User) {
    if (!supabase) return;
    setAppLoading(true);
    setAppError("");
    try {
      const profile = await ensureProfile(currentUser);
      setUserRole(profile.role);

      let consultantRows: ProfileRow[] = [];
      if (profile.role === "admin") {
        const { data: rows, error } = await supabase
          .from("profiles")
          .select("*")
          .order("email", { ascending: true });
        if (error) throw error;
        consultantRows = rows || [];
      } else {
        consultantRows = [profile];
      }

      const consultantOptions: ConsultantOption[] = consultantRows.map((row) => ({
        id: row.id,
        email: row.email || "без email",
        role: row.role,
        fullName: row.full_name,
      }));
      setConsultants(consultantOptions);
      if (!newClientConsultantId) {
        if (profile.role === "admin") {
          const firstConsultant = consultantOptions.find((item) => item.role === "consultant");
          setNewClientConsultantId(firstConsultant?.id || currentUser.id);
        } else {
          setNewClientConsultantId(currentUser.id);
        }
      }

      let clientQuery = supabase.from("clients").select("*").order("created_at", { ascending: false });
      if (profile.role !== "admin") {
        clientQuery = clientQuery.eq("consultant_id", currentUser.id);
      }
      const { data: clientRowsInitial, error: clientsInitialError } = await clientQuery;
      if (clientsInitialError) throw clientsInitialError;
      let clientRows = clientRowsInitial || [];

      if (clientRows.length === 0) {
        const migrated = await migrateLegacyLocalStorageData(supabase, currentUser.id);
        if (migrated) {
          let refetchQuery = supabase.from("clients").select("*").order("created_at", { ascending: false });
          if (profile.role !== "admin") {
            refetchQuery = refetchQuery.eq("consultant_id", currentUser.id);
          }
          const { data: afterMigrateRows, error: afterMigrateError } = await refetchQuery;
          if (afterMigrateError) throw afterMigrateError;
          clientRows = afterMigrateRows || [];
        }
      }

      const mappedClients = clientRows.map(mapClientRow);
      setClients(mappedClients);
      setActiveClientId((prev) =>
        prev && mappedClients.some((client) => client.id === prev) ? prev : mappedClients[0]?.id || "",
      );

      if (!clientRows.length) {
        setResumeAnalysisByClient({});
        setJobsCacheByClient({});
        setSignalsCacheByClient({});
        return;
      }

      const clientIds = clientRows.map((client) => client.id);

      const [resumeResp, jobsResp, signalsResp] = await Promise.all([
        supabase.from("resume_analysis").select("*").in("client_id", clientIds),
        supabase.from("jobs").select("*").in("client_id", clientIds),
        supabase.from("signals").select("*").in("client_id", clientIds),
      ]);

      if (resumeResp.error) throw resumeResp.error;
      if (jobsResp.error) throw jobsResp.error;
      if (signalsResp.error) throw signalsResp.error;

      setResumeAnalysisByClient(buildResumeAnalysisByClient(resumeResp.data || []));
      setJobsCacheByClient(buildJobsCacheByClient(jobsResp.data || []));
      setSignalsCacheByClient(buildSignalsCacheByClient(signalsResp.data || []));
    } catch (error) {
      setAppError(error instanceof Error ? error.message : "Не удалось загрузить данные пользователя.");
    } finally {
      setAppLoading(false);
    }
  }

  useEffect(() => {
    if (!supabase || !user) return;
    void loadAllDataForUser(user);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase, user]);

  const consultantById = useMemo(() => {
    const map = new Map<string, ConsultantOption>();
    for (const consultant of consultants) map.set(consultant.id, consultant);
    return map;
  }, [consultants]);

  function updateConsultantDraft(
    consultantId: string,
    patch: Partial<Pick<ConsultantOption, "fullName" | "role">>,
  ) {
    setConsultants((prev) =>
      prev.map((item) => (item.id === consultantId ? { ...item, ...patch } : item)),
    );
  }

  async function saveUserProfiles() {
    if (!supabase || userRole !== "admin") return;
    setIsSavingUserProfiles(true);
    setAdminPanelError("");
    setAppError("");
    try {
      const updates = consultants.map((item) => ({
        id: item.id,
        role: item.role,
        full_name: item.fullName,
      }));
      const self = updates.find((item) => item.id === user?.id);
      if (self && self.role !== "admin") {
        throw new Error("Нельзя снять роль admin у текущего пользователя.");
      }
      for (const item of updates) {
        const { error } = await supabase
          .from("profiles")
          .update({ role: item.role, full_name: item.full_name })
          .eq("id", item.id);
        if (error) throw error;
      }
      if (user) {
        await loadAllDataForUser(user);
      }
      setIsAdminUsersOpen(false);
    } catch (error) {
      setAdminPanelError(
        error instanceof Error ? error.message : "Не удалось сохранить профили пользователей.",
      );
    } finally {
      setIsSavingUserProfiles(false);
    }
  }

  const activeClient = useMemo(
    () => clients.find((client) => client.id === activeClientId),
    [activeClientId, clients],
  );

  const activeResumeAnalysis = activeClient ? resumeAnalysisByClient[activeClient.id] : undefined;
  const activeJobsCache = activeClient ? jobsCacheByClient[activeClient.id] : undefined;
  const activeSignalsCache = activeClient ? signalsCacheByClient[activeClient.id] : undefined;
  const activeJobs = useMemo(() => activeJobsCache?.items ?? [], [activeJobsCache]);
  const activeSignals = useMemo(() => activeSignalsCache?.items ?? [], [activeSignalsCache]);

  const pipelineSummary = useMemo(() => {
    const jobsFound = activeJobs.length;
    const highMatches = activeJobs.filter((job) => job.fitScore >= 80).length;
    const contactsFound =
      activeJobs.filter((job) => job.hiringContactRole.trim().length > 0).length +
      activeSignals.filter((signal) => signal.hiringManager.trim().length > 0).length;
    const outreachReady = [...activeJobs, ...activeSignals].filter((item) =>
      statusReached(item.status, "Outreach отправлен"),
    ).length;
    const outreachSent = [...activeJobs, ...activeSignals].filter((item) =>
      statusReached(item.status, "Outreach отправлен"),
    ).length;
    const responses = [...activeJobs, ...activeSignals].filter((item) =>
      statusReached(item.status, "Ответ получен"),
    ).length;
    const conversion = outreachSent > 0 ? Math.round((responses / outreachSent) * 100) : 0;
    return {
      jobsFound,
      highMatches,
      contactsFound,
      outreachReady,
      signalsFound: activeSignals.length,
      outreachSent,
      responses,
      conversion,
    };
  }, [activeJobs, activeSignals]);

  const metrics = [
    { label: "Найдено вакансий", value: pipelineSummary.jobsFound, hint: "по текущему поиску" },
    { label: "High-fit вакансий", value: pipelineSummary.highMatches, hint: "fit score 80+" },
    { label: "Сигналы роста", value: pipelineSummary.signalsFound, hint: "компании с признаками найма" },
    { label: "Найдено контактов", value: pipelineSummary.contactsFound, hint: "по вакансиям и сигналам" },
    { label: "Outreach отправлено", value: pipelineSummary.outreachSent, hint: "по статусам" },
    { label: "Ответов получено", value: pipelineSummary.responses, hint: "по статусам" },
    { label: "Конверсия", value: `${pipelineSummary.conversion}%`, hint: "ответы / outreach" },
  ];

  function persistClientPatch(clientId: string, patch: Partial<Client>) {
    if (!supabase) return;
    const rowPatch = mapClientPatchToRow(patch);
    if (!Object.keys(rowPatch).length) return;
    void supabase.from("clients").update(rowPatch).eq("id", clientId);
  }

  function updateActiveClient(patch: Partial<Client>) {
    if (!activeClient) return;
    setClients((prev) =>
      prev.map((client) => (client.id === activeClient.id ? { ...client, ...patch } : client)),
    );
    persistClientPatch(activeClient.id, patch);
  }

  async function addClient() {
    if (!supabase || !user) return;
    const trimmedName = newClientName.trim();
    if (!trimmedName) return;
    const consultantId =
      userRole === "admin" ? newClientConsultantId || user.id : user.id;
    const payload: Database["public"]["Tables"]["clients"]["Insert"] = {
      id: makeDbId("client"),
      consultant_id: consultantId,
      name: trimmedName,
      resume: "",
      resume_file_name: null,
      resume_file_signature: null,
      target_role: "",
      location: "",
      experience_years: "3",
      candidate_level: "auto",
      preferred_company_sizes: ["startup", "scaleup", "enterprise"],
      last_analyzed_at: null,
    };
    const { data, error } = await supabase.from("clients").insert(payload).select("*").single();
    if (error || !data) {
      setAppError(error?.message || "Не удалось добавить клиента.");
      return;
    }
    const mapped = mapClientRow(data);
    setClients((prev) => [mapped, ...prev]);
    setActiveClientId(mapped.id);
    setWorkspaceTab("jobs");
    setNewClientName("");
    setGeneratedReport("");
    setIsReportOpen(false);
  }

  async function renameClient(clientId: string) {
    const current = clients.find((client) => client.id === clientId);
    if (!current) return;
    const renamed = window.prompt("Новое имя клиента", current.name);
    if (!renamed) return;
    const value = renamed.trim();
    if (!value) return;
    setClients((prev) =>
      prev.map((client) => (client.id === clientId ? { ...client, name: value } : client)),
    );
    if (supabase) {
      const { error } = await supabase.from("clients").update({ name: value }).eq("id", clientId);
      if (error) setAppError(error.message);
    }
  }

  async function deleteClient(clientId: string) {
    if (!supabase) return;
    const target = clients.find((client) => client.id === clientId);
    if (!target) return;
    const accepted = window.confirm(`Удалить клиента "${target.name}"?`);
    if (!accepted) return;
    const { error } = await supabase.from("clients").delete().eq("id", clientId);
    if (error) {
      setAppError(error.message);
      return;
    }
    const nextClients = clients.filter((client) => client.id !== clientId);
    setClients(nextClients);
    setResumeAnalysisByClient((prev) => {
      const next = { ...prev };
      delete next[clientId];
      return next;
    });
    setJobsCacheByClient((prev) => {
      const next = { ...prev };
      delete next[clientId];
      return next;
    });
    setSignalsCacheByClient((prev) => {
      const next = { ...prev };
      delete next[clientId];
      return next;
    });
    if (clientId === activeClientId) {
      setActiveClientId(nextClients[0]?.id || "");
      setGeneratedReport("");
      setIsReportOpen(false);
    }
  }

  async function reassignClient(clientId: string, consultantId: string) {
    if (!supabase || userRole !== "admin") return;
    setClients((prev) =>
      prev.map((client) => (client.id === clientId ? { ...client, consultantId } : client)),
    );
    const { error } = await supabase
      .from("clients")
      .update({ consultant_id: consultantId })
      .eq("id", clientId);
    if (error) {
      setAppError(error.message);
      await loadAllDataForUser(user!);
    }
  }

  function buildResumeFingerprint(clientSnapshot: Client, file?: File): string {
    const fileSignature =
      file !== undefined
        ? `${file.name}:${file.size}:${file.lastModified}`
        : clientSnapshot.resumeFileSignature || clientSnapshot.resumeFileName || "";
    return `${fileSignature}|${clientSnapshot.resume.slice(0, 6000).trim()}`;
  }

  async function ensureResumeAnalysis(clientSnapshot: Client, force = false, file?: File) {
    if (!supabase) throw new Error("Supabase не инициализирован.");
    const currentFingerprint = buildResumeFingerprint(clientSnapshot, file);
    const cached = resumeAnalysisByClient[clientSnapshot.id];
    if (
      !force &&
      cached &&
      cached.sourceFingerprint === currentFingerprint &&
      isCacheFresh(cached.timestamp)
    ) {
      return cached.profile;
    }

    if (!clientSnapshot.resume.trim()) {
      throw new Error("Для анализа резюме нужен текст или PDF файл.");
    }

    const resumePrompt = [
      "Extract structured candidate profile from this resume.",
      "Return ONLY valid JSON with fields:",
      "{",
      '  "job_titles_current": string[],',
      '  "job_titles_target": string[],',
      '  "total_years_experience": number | null,',
      '  "top_10_skills": string[],',
      '  "industries": string[],',
      '  "seniority_level": string,',
      '  "location": string,',
      '  "preferred_company_size": string',
      "}",
      `Target role hint: ${clientSnapshot.targetRole || "unknown"}.`,
      `Location hint: ${clientSnapshot.location || "unknown"}.`,
    ].join("\n");

    setIsResumeAnalyzing(true);
    try {
      const contentBlocks: unknown[] = [{ type: "text", text: resumePrompt }];
      if (file && file.type === "application/pdf") {
        const base64Pdf = arrayBufferToBase64(await file.arrayBuffer());
        contentBlocks.push({
          type: "document",
          source: {
            type: "base64",
            media_type: "application/pdf",
            data: base64Pdf,
          },
        });
      }
      contentBlocks.push({
        type: "text",
        text: `Resume text:\n${clientSnapshot.resume.slice(0, 6000)}`,
      });

      const payload = await callClaudeProxy({
        messages: [{ role: "user", content: contentBlocks }],
      });
      const raw = await parseClaudeJsonWithRepair<Record<string, unknown>>(
        payload,
        'Expected schema: {"job_titles_current":[],"job_titles_target":[],"total_years_experience":number|null,"top_10_skills":[],"industries":[],"seniority_level":"string","location":"string","preferred_company_size":"string"}',
      );
      const profile = normalizeResumeProfile(raw, clientSnapshot.location || "United States");

      const { data, error } = await supabase
        .from("resume_analysis")
        .upsert(
          {
            id: makeDbId("resume"),
            client_id: clientSnapshot.id,
            profile,
            source_fingerprint: currentFingerprint,
          },
          { onConflict: "client_id" },
        )
        .select("*")
        .single();
      if (error || !data) throw error ?? new Error("Не удалось сохранить анализ резюме.");

      setResumeAnalysisByClient((prev) => ({
        ...prev,
        [clientSnapshot.id]: {
          profile,
          timestamp: timestampFromIso(data.updated_at),
          sourceFingerprint: currentFingerprint,
        },
      }));
      return profile;
    } finally {
      setIsResumeAnalyzing(false);
    }
  }

  async function applyResumeFile(file: File) {
    if (!activeClient) return;
    let nextResume = activeClient.resume || "";
    try {
      const formData = new FormData();
      formData.set("file", file);
      const extractionResponse = await fetch("/api/resume-extract", {
        method: "POST",
        body: formData,
      });
      const extractionPayload = (await extractionResponse.json().catch(() => null)) as
        | { text?: string; message?: string }
        | null;
      if (!extractionResponse.ok || !extractionPayload?.text) {
        throw new Error(
          extractionPayload?.message ||
            "Не удалось извлечь текст из файла. Вставьте резюме вручную.",
        );
      }
      nextResume = extractionPayload.text.slice(0, 12000);
    } catch (error) {
      setResumeInputError(
        error instanceof Error
          ? error.message
          : "Не удалось извлечь текст из файла. Вставьте резюме вручную.",
      );
    }
    const nextClient: Client = {
      ...activeClient,
      resume: nextResume,
      resumeFileName: file.name,
      resumeFileSignature: `${file.name}:${file.size}:${file.lastModified}`,
    };
    updateActiveClient({
      resume: nextResume,
      resumeFileName: file.name,
      resumeFileSignature: `${file.name}:${file.size}:${file.lastModified}`,
    });
    setResumeInputError("");
    try {
      await ensureResumeAnalysis(nextClient, false, file);
    } catch (error) {
      setResumeInputError(humanizeClaudeError(error));
    }
  }

  function onDropResume(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragActive(false);
    if (!event.dataTransfer.files?.length) return;
    void applyResumeFile(event.dataTransfer.files[0]);
  }

  function onSelectResume(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    void applyResumeFile(file);
    event.target.value = "";
  }

  function onPasteResume(event: ClipboardEvent<HTMLTextAreaElement>) {
    if (!activeClient) return;
    const pasted = event.clipboardData.getData("text/plain");
    if (!pasted) return;
    event.preventDefault();
    const element = event.currentTarget;
    const start = element.selectionStart ?? element.value.length;
    const end = element.selectionEnd ?? element.value.length;
    const nextResume = `${activeClient.resume.slice(0, start)}${pasted}${activeClient.resume.slice(end)}`;
    const nextClient = { ...activeClient, resume: nextResume };
    updateActiveClient({ resume: nextResume });
    setResumeInputError("");
    if (!resumeAnalysisByClient[activeClient.id]) {
      void ensureResumeAnalysis(nextClient, false).catch(() =>
        setResumeInputError("Не удалось автоматически распарсить вставленное резюме."),
      );
    }
  }

  async function pasteResumeFromClipboard() {
    if (!activeClient) return;
    try {
      const text = await navigator.clipboard.readText();
      if (!text.trim()) {
        setResumeInputError("Буфер обмена пуст. Скопируйте текст резюме и попробуйте снова.");
        return;
      }
      const trimmed = text.slice(0, 12000);
      const nextClient = { ...activeClient, resume: trimmed };
      updateActiveClient({ resume: trimmed });
      setResumeInputError("");
      await ensureResumeAnalysis(nextClient, false);
    } catch {
      setResumeInputError(
        "Браузер заблокировал доступ к буферу. Используйте Ctrl/Cmd+V прямо в поле резюме.",
      );
    }
  }

  async function runResumeReanalysis() {
    if (!activeClient) return;
    try {
      await ensureResumeAnalysis(activeClient, true);
      setResumeInputError("");
    } catch (error) {
      setResumeInputError(humanizeClaudeError(error));
    }
  }

  function buildCandidateContext(clientSnapshot: Client, profile: ResumeProfile): string {
    const compactSkills = profile.topSkills.slice(0, 6);
    const compactIndustries = profile.industries.slice(0, 3);
    const compactCurrentTitles = profile.jobTitlesCurrent.slice(0, 2);
    const compactTargetTitles = profile.jobTitlesTarget.slice(0, 2);
    return [
      `Candidate target role: ${clientSnapshot.targetRole || compactTargetTitles.join(", ") || "unknown"}`,
      `Candidate location: ${clientSnapshot.location || profile.location || "United States"}`,
      `Candidate seniority: ${profile.seniorityLevel || clientSnapshot.candidateLevel}`,
      `Years of experience: ${(profile.totalYearsExperience ?? clientSnapshot.experienceYears) || "unknown"}`,
      `Current titles: ${compactCurrentTitles.join(", ") || "unknown"}`,
      `Top skills: ${compactSkills.join(", ") || "unknown"}`,
      `Industries: ${compactIndustries.join(", ") || "unknown"}`,
      `Preferred company size: ${clientSnapshot.preferredCompanySizes.join(", ")}`,
    ].join("\n");
  }

  async function fetchJobsVariant(
    variantLabel: string,
    variantQuery: string,
    clientSnapshot: Client,
    profile: ResumeProfile,
  ): Promise<Omit<JobItem, "id" | "fitScore" | "fitReason" | "status">[]> {
    const prompt = [
      "You are a US job market researcher.",
      "Use web search and return CURRENT OPEN jobs from US-based sites posted within last 7 days.",
      "Return ONLY valid JSON object with shape:",
      "{",
      '  "jobs": [',
      "    {",
      '      "title": "string",',
      '      "company": "string",',
      '      "location": "string",',
      '      "url": "https://...",',
      '      "posted_at": "YYYY-MM-DD or unknown",',
      '      "company_size": "startup|scaleup|enterprise|unknown",',
      '      "reason": "short relevance note",',
      '      "hiring_contact_role": "specific role in LinkedIn",',
      '      "outreach_message": "3-4 sentence outreach message in English"',
      "    }",
      "  ]",
      "}",
      "Return 6-10 items. Do not include duplicates.",
      `Search focus: ${variantQuery}.`,
      "Candidate context:",
      buildCandidateContext(clientSnapshot, profile),
    ].join("\n");

    const payload = await callClaudeProxy({
      messages: [{ role: "user", content: [{ type: "text", text: prompt }] }],
      tools: [WEB_SEARCH_TOOL],
    });

    const parsed = await parseClaudeJsonWithRepair<{ jobs?: unknown[] }>(
      payload,
      'Expected schema: {"jobs":[{"title":"string","company":"string","location":"string","url":"https://...","posted_at":"string","company_size":"startup|scaleup|enterprise|unknown","reason":"string","hiring_contact_role":"string","outreach_message":"string"}]}',
    );
    const jobsRaw = Array.isArray(parsed.jobs) ? parsed.jobs : [];
    return jobsRaw.reduce<Omit<JobItem, "id" | "fitScore" | "fitReason" | "status">[]>(
      (acc, raw) => {
        const item = (raw || {}) as Record<string, unknown>;
        const url = typeof item.url === "string" ? normalizeJobUrl(item.url) : "";
        if (!url.startsWith("http")) return acc;
        const title = typeof item.title === "string" ? item.title.trim() : "";
        const company = typeof item.company === "string" ? item.company.trim() : "";
        if (!title || !company) return acc;
        const location = typeof item.location === "string" ? item.location.trim() : "United States";
        const postedAt = typeof item.posted_at === "string" ? item.posted_at : undefined;
        const evidence =
          typeof item.reason === "string" && item.reason.trim()
            ? item.reason.trim()
            : `${title} aligns with candidate context.`;
        const hiringContactRole =
          typeof item.hiring_contact_role === "string" && item.hiring_contact_role.trim()
            ? item.hiring_contact_role.trim()
            : "Talent Acquisition Manager";
        const outreachMessage =
          typeof item.outreach_message === "string" && item.outreach_message.trim()
            ? item.outreach_message.trim()
            : `Hi, I noticed the ${title} opening at ${company}. I have relevant experience and would love to connect about this opportunity.`;
        acc.push({
          title,
          company,
          location,
          url,
          postedAt,
          sourceVariant: variantLabel,
          companySize: parseCompanySize(item.company_size),
          hiringContactRole,
          evidence,
          outreachMessage,
        });
        return acc;
      },
      [],
    );
  }

  function scoreJobFit(
    job: Omit<JobItem, "id" | "fitScore" | "fitReason" | "status">,
    clientSnapshot: Client,
    profile: ResumeProfile,
  ): { score: number; reason: string } {
    const corpus = `${job.title} ${job.evidence} ${job.company}`.toLowerCase();
    const roleReference =
      clientSnapshot.targetRole || profile.jobTitlesTarget[0] || profile.jobTitlesCurrent[0] || "";
    const roleTokens = tokenize(roleReference);
    const roleHits = roleTokens.filter((token) => corpus.includes(token)).length;

    const skillHits = profile.topSkills
      .map((skill) => normalize(skill))
      .filter((skill) => skill && corpus.includes(skill))
      .length;

    const locationNeedle = normalize(clientSnapshot.location || profile.location || "");
    const locationMatched =
      !locationNeedle ||
      normalize(job.location).includes(locationNeedle) ||
      normalize(job.location).includes("remote") ||
      normalize(job.location).includes("united states");

    const candidateBand =
      clientSnapshot.candidateLevel === "auto"
        ? detectSeniorityBand(profile.seniorityLevel)
        : clientSnapshot.candidateLevel;
    const jobBand = detectSeniorityBand(job.title);
    const seniorityMatched = candidateBand === "senior" ? true : candidateBand === jobBand;

    const sizeMatched =
      job.companySize === "unknown" || clientSnapshot.preferredCompanySizes.includes(job.companySize);

    let score = 38;
    score += Math.min(22, roleHits * 8);
    score += Math.min(20, skillHits * 5);
    if (locationMatched) score += 10;
    if (seniorityMatched) score += 8;
    if (sizeMatched) score += 8;
    if (!sizeMatched) score -= 6;
    if (!seniorityMatched && candidateBand !== "senior") score -= 8;
    score = clamp(score, 0, 100);

    const reason = [
      roleHits > 0 ? `Совпали ролевые маркеры (${roleHits})` : "Слабые ролевые маркеры",
      skillHits > 0 ? `навыков из резюме совпало: ${skillHits}` : "нет явных совпадений навыков",
      locationMatched ? "локация релевантна" : "локация частично расходится",
      seniorityMatched ? "уровень подходит" : "уровень выше профиля",
      sizeMatched ? "размер компании в приоритете" : "размер компании не в приоритете",
    ].join(", ");

    return { score, reason };
  }

  async function fetchJobsFromFallbackEngine(
    clientSnapshot: Client,
    previousStatuses: Map<string, OutreachStatus>,
  ): Promise<JobItem[]> {
    const response = await fetch("/api/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        role: clientSnapshot.targetRole || "",
        location: clientSnapshot.location || "",
        resumeText: (clientSnapshot.resume || "").slice(0, 4000),
        candidateBand: clientSnapshot.candidateLevel,
        experienceYears: clientSnapshot.experienceYears || "",
        companySizes: clientSnapshot.preferredCompanySizes,
        daysWindow: 7,
        limit: 40,
      }),
    });
    if (!response.ok) {
      throw new Error(`Fallback API returned ${response.status}`);
    }
    const payload = (await response.json()) as LegacyJobsPayload;
    const sourceItems = Array.isArray(payload.jobs) && payload.jobs.length
      ? payload.jobs
      : [...(payload.exactMatches || []), ...(payload.adjacentMatches || [])];

    const deduped = unique(
      sourceItems
        .map((item) => (typeof item.applyUrl === "string" ? normalizeJobUrl(item.applyUrl) : ""))
        .filter(Boolean),
    ).map((url) => sourceItems.find((item) => normalizeJobUrl(item.applyUrl || "") === url)!);

    return deduped
      .slice(0, 30)
      .map((item, index) => {
        const url = normalizeJobUrl(item.applyUrl || "");
        const score = typeof item.matchScore === "number" ? clamp(item.matchScore, 0, 100) : 62;
        return {
          id: makeStableId([item.id || url || String(index), "fallback"]),
          title: item.title || "Untitled role",
          company: item.company || "Unknown company",
          location: item.location || "United States",
          url,
          postedAt: item.postedAt,
          sourceVariant: "Fallback US job boards",
          companySize: "unknown",
          hiringContactRole: item.linkedinTargetRole || "Talent Acquisition Manager",
          evidence: item.fitReason || "Вакансия получена из fallback-движка RoleRadar.",
          outreachMessage:
            item.outreachTip ||
            "Hi, I saw this role and believe my profile is a strong fit. I would love to connect and share relevant experience.",
          fitScore: score,
          fitReason: item.fitReason || "Matched by fallback engine (US job boards).",
          status: previousStatuses.get(url) || "Найдено",
        } satisfies JobItem;
      })
      .filter((item) => item.url.startsWith("http"));
  }

  function buildSignalsFallbackFromJobs(
    jobs: JobItem[],
    previousStatuses: Map<string, OutreachStatus>,
  ): GrowthSignal[] {
    return jobs.slice(0, 8).map((job, index) => {
      const triggerType: SignalTrigger = index % 2 === 0 ? "key_hire" : "contract";
      const priority: SignalPriority = index < 2 ? "hot" : index < 5 ? "warm" : "cold";
      const sourceUrl = normalizeJobUrl(job.url);
      const signalId = makeStableId([job.company, triggerType, sourceUrl, "fallback-signal"]);
      return {
        id: signalId,
        company: job.company,
        triggerType,
        priority,
        hiringManager: job.hiringContactRole || "Hiring Manager",
        evidence: `Fallback signal based on active hiring for ${job.title} at ${job.company}.`,
        sourceUrl,
        outreachMessage:
          `Hi, I noticed your team is actively hiring for ${job.title}. ` +
          "My background aligns well with this direction, and I'd value a quick conversation about potential fit and priorities.",
        status: previousStatuses.get(`${job.company}|${triggerType}|${sourceUrl}`) || "Найдено",
      };
    });
  }

  async function persistJobsForClient(clientId: string, jobs: JobItem[]) {
    if (!supabase) return;
    await supabase.from("jobs").delete().eq("client_id", clientId);
    if (!jobs.length) {
      setJobsCacheByClient((prev) => ({ ...prev, [clientId]: { items: [], timestamp: Date.now() } }));
      return;
    }
    const payload: Database["public"]["Tables"]["jobs"]["Insert"][] = jobs.map((job) => ({
      id: makeDbId("job"),
      client_id: clientId,
      title: job.title,
      company: job.company,
      location: job.location,
      url: normalizeJobUrl(job.url),
      posted_at: job.postedAt || null,
      source_variant: job.sourceVariant,
      company_size: job.companySize,
      hiring_contact_role: job.hiringContactRole,
      evidence: job.evidence,
      outreach_message: job.outreachMessage,
      fit_score: clamp(job.fitScore, 0, 100),
      fit_reason: job.fitReason,
      status: parseOutreachStatus(job.status),
    }));
    const { data, error } = await supabase.from("jobs").insert(payload).select("*");
    if (error) throw error;
    const rows = (data || []).map(mapJobRow).sort((a, b) => b.fitScore - a.fitScore);
    const timestamp = (data || []).reduce((max, row) => Math.max(max, timestampFromIso(row.updated_at)), 0);
    setJobsCacheByClient((prev) => ({
      ...prev,
      [clientId]: { items: rows, timestamp: timestamp || Date.now() },
    }));
  }

  async function persistSignalsForClient(clientId: string, signals: GrowthSignal[]) {
    if (!supabase) return;
    await supabase.from("signals").delete().eq("client_id", clientId);
    if (!signals.length) {
      setSignalsCacheByClient((prev) => ({ ...prev, [clientId]: { items: [], timestamp: Date.now() } }));
      return;
    }
    const payload: Database["public"]["Tables"]["signals"]["Insert"][] = signals.map((signal) => ({
      id: makeDbId("signal"),
      client_id: clientId,
      company: signal.company,
      trigger_type: signal.triggerType,
      priority: signal.priority,
      hiring_manager: signal.hiringManager,
      evidence: signal.evidence,
      source_url: normalizeJobUrl(signal.sourceUrl),
      outreach_message: signal.outreachMessage,
      status: parseOutreachStatus(signal.status),
    }));
    const { data, error } = await supabase.from("signals").insert(payload).select("*");
    if (error) throw error;
    const priorityRank: Record<SignalPriority, number> = { hot: 0, warm: 1, cold: 2 };
    const rows = (data || [])
      .map(mapSignalRow)
      .sort((a, b) => priorityRank[a.priority] - priorityRank[b.priority]);
    const timestamp = (data || []).reduce((max, row) => Math.max(max, timestampFromIso(row.updated_at)), 0);
    setSignalsCacheByClient((prev) => ({
      ...prev,
      [clientId]: { items: rows, timestamp: timestamp || Date.now() },
    }));
  }

  async function runJobsEngine(forceRefresh: boolean) {
    if (!activeClient) return;
    setJobsError("");
    setIsJobsLoading(true);
    try {
      const cached = jobsCacheByClient[activeClient.id];
      if (!forceRefresh && cached && isCacheFresh(cached.timestamp)) return;

      const profile = await ensureResumeAnalysis(activeClient, false);
      const variants = [
        {
          label: "По title",
          query: `Exact title search for "${activeClient.targetRole || profile.jobTitlesTarget[0] || "candidate role"}"`,
        },
        {
          label: "По skills",
          query: `Search by top skills: ${(profile.topSkills || []).slice(0, 6).join(", ")}`,
        },
        {
          label: "По индустрии",
          query: `Industry-focused search: ${(profile.industries || []).slice(0, 4).join(", ") || "technology"}`,
        },
        {
          label: "По локации + role",
          query: `Location + role search: ${activeClient.location || profile.location || "United States"} and ${
            activeClient.targetRole || profile.jobTitlesTarget[0] || "candidate role"
          }`,
        },
        {
          label: "По размеру компании + role",
          query: `Company size filter: ${activeClient.preferredCompanySizes.join(", ")} for role ${
            activeClient.targetRole || profile.jobTitlesTarget[0] || "candidate role"
          }`,
        },
      ];

      const settledBatches = await runInBatchesSettled(
        variants,
        2,
        (variant) => fetchJobsVariant(variant.label, variant.query, activeClient, profile),
      );
      const batches = settledBatches.fulfilled;
      if (!batches.length) {
        throw new Error("Не удалось получить ответы Claude по вакансиям. Попробуйте «Обновить» через минуту.");
      }

      let merged = unique(
        batches.flat().map((item) => normalizeJobUrl(item.url)),
      ).map((url) => batches.flat().find((item) => normalizeJobUrl(item.url) === url)!);

      let extraAttempt = 0;
      while (merged.length < 25 && extraAttempt < 1) {
        extraAttempt += 1;
        const extraSettled = await runInBatchesSettled(
          [
            {
              label: `Расширенный поиск #${extraAttempt}`,
              query: `Broader US search for ${
                activeClient.targetRole || profile.jobTitlesTarget[0] || "target role"
              } with candidate skills ${profile.topSkills.slice(0, 5).join(", ") || "general"}`,
            },
          ],
          1,
          (variant) => fetchJobsVariant(variant.label, variant.query, activeClient, profile),
        );
        const extraBatch = extraSettled.fulfilled.flat();
        if (!extraBatch.length) break;
        merged = unique([...merged, ...extraBatch].map((item) => normalizeJobUrl(item.url))).map((url) =>
          [...merged, ...extraBatch].find((item) => normalizeJobUrl(item.url) === url)!,
        );
      }

      const previousStatuses = new Map(activeJobs.map((job) => [normalizeJobUrl(job.url), job.status]));
      const scored = merged
        .map((job, index) => {
          const { score, reason } = scoreJobFit(job, activeClient, profile);
          return {
            ...job,
            id: makeStableId([job.company, job.title, String(index), normalizeJobUrl(job.url)]),
            fitScore: score,
            fitReason: reason,
            status: previousStatuses.get(normalizeJobUrl(job.url)) || "Найдено",
          } satisfies JobItem;
        })
        .sort((a, b) => b.fitScore - a.fitScore);

      const minDesired = 10;
      const finalJobs = scored.slice(0, Math.min(60, Math.max(minDesired, scored.length)));
      if (!finalJobs.length) {
        throw new Error("Claude не вернул вакансии. Попробуйте обновить анализ.");
      }

      await persistJobsForClient(activeClient.id, finalJobs);
      updateActiveClient({ lastAnalyzedAt: new Date().toISOString().slice(0, 10) });

      if (settledBatches.failed > 0) {
        setJobsError(
          `Часть источников недоступна (${settledBatches.failed}/${variants.length}), показаны частичные результаты.`,
        );
      }
    } catch (error) {
      const previousStatuses = new Map(activeJobs.map((job) => [normalizeJobUrl(job.url), job.status]));
      try {
        const fallbackJobs = await fetchJobsFromFallbackEngine(activeClient, previousStatuses);
        if (fallbackJobs.length > 0) {
          await persistJobsForClient(activeClient.id, fallbackJobs);
          setJobsError("Claude временно недоступен, показаны результаты из fallback job engine.");
        } else {
          setJobsError(humanizeClaudeError(error));
        }
      } catch {
        setJobsError(humanizeClaudeError(error));
      }
    } finally {
      setIsJobsLoading(false);
    }
  }

  async function fetchSignalsVariant(
    trigger: SignalTrigger,
    query: string,
    clientSnapshot: Client,
    profile: ResumeProfile,
  ): Promise<Omit<GrowthSignal, "id" | "status">[]> {
    const prompt = [
      "You are identifying hiring growth signals for a candidate.",
      "Use web search. Focus on US companies relevant to candidate profile.",
      "Return ONLY JSON object with shape:",
      "{",
      '  "signals": [',
      "    {",
      '      "company": "string",',
      '      "trigger_type": "funding|expansion|key_hire|contract",',
      '      "priority": "hot|warm|cold",',
      '      "hiring_manager": "string",',
      '      "evidence": "specific trigger evidence",',
      '      "source_url": "https://...",',
      '      "outreach_message": "3-4 sentence outreach message in English mentioning the trigger"',
      "    }",
      "  ]",
      "}",
      `Trigger focus: ${trigger}.`,
      `Search task: ${query}.`,
      "Candidate context:",
      buildCandidateContext(clientSnapshot, profile),
    ].join("\n");

    const payload = await callClaudeProxy({
      messages: [{ role: "user", content: [{ type: "text", text: prompt }] }],
      tools: [WEB_SEARCH_TOOL],
    });

    const parsed = await parseClaudeJsonWithRepair<{ signals?: unknown[] }>(
      payload,
      'Expected schema: {"signals":[{"company":"string","trigger_type":"funding|expansion|key_hire|contract","priority":"hot|warm|cold","hiring_manager":"string","evidence":"string","source_url":"https://...","outreach_message":"string"}]}',
    );
    const signalRaw = Array.isArray(parsed.signals) ? parsed.signals : [];
    return signalRaw.reduce<Omit<GrowthSignal, "id" | "status">[]>((acc, raw) => {
      const item = (raw || {}) as Record<string, unknown>;
      const company = typeof item.company === "string" ? item.company.trim() : "";
      const sourceUrl = typeof item.source_url === "string" ? normalizeJobUrl(item.source_url) : "";
      if (!company || !sourceUrl.startsWith("http")) return acc;
      const triggerType = parseSignalTrigger(item.trigger_type);
      const priority = parseSignalPriority(item.priority);
      const hiringManager =
        typeof item.hiring_manager === "string" && item.hiring_manager.trim()
          ? item.hiring_manager.trim()
          : "Hiring Manager";
      const evidence =
        typeof item.evidence === "string" && item.evidence.trim()
          ? item.evidence.trim()
          : "Growth signal detected from public sources.";
      const outreachMessage =
        typeof item.outreach_message === "string" && item.outreach_message.trim()
          ? item.outreach_message.trim()
          : `Hi, I noticed your recent growth milestone at ${company}. I work on similar challenges and would love to connect if your team is hiring.`;
      acc.push({ company, triggerType, priority, hiringManager, evidence, sourceUrl, outreachMessage });
      return acc;
    }, []);
  }

  async function runSignalsEngine(forceRefresh: boolean) {
    if (!activeClient) return;
    setSignalsError("");
    setIsSignalsLoading(true);
    try {
      const cached = signalsCacheByClient[activeClient.id];
      if (!forceRefresh && cached && isCacheFresh(cached.timestamp)) return;

      const profile = await ensureResumeAnalysis(activeClient, false);
      const tasks: { trigger: SignalTrigger; query: string }[] = [
        {
          trigger: "funding",
          query: `Funding rounds in last 90 days for industries: ${profile.industries.join(", ") || "technology"}`,
        },
        {
          trigger: "expansion",
          query: `Companies opening new offices in ${activeClient.location || profile.location || "United States"}`,
        },
        {
          trigger: "key_hire",
          query: `New VP or Director hires in last 60 days in companies relevant to ${
            activeClient.targetRole || profile.jobTitlesTarget[0] || "candidate profile"
          }`,
        },
        {
          trigger: "contract",
          query: "Companies winning major contracts or strategic partnerships recently",
        },
      ];

      const settledBatches = await runInBatchesSettled(tasks, 2, (task) =>
        fetchSignalsVariant(task.trigger, task.query, activeClient, profile),
      );
      const batches = settledBatches.fulfilled;
      if (!batches.length) {
        throw new Error("Не удалось получить ответы Claude по сигналам. Попробуйте «Обновить» через минуту.");
      }

      const merged = unique(
        batches.flat().map((signal) => `${signal.company}|${signal.triggerType}|${normalizeJobUrl(signal.sourceUrl)}`),
      ).map((key) =>
        batches
          .flat()
          .find(
            (signal) =>
              `${signal.company}|${signal.triggerType}|${normalizeJobUrl(signal.sourceUrl)}` === key,
          )!,
      );

      const previousStatuses = new Map(
        activeSignals.map((signal) => [
          `${signal.company}|${signal.triggerType}|${normalizeJobUrl(signal.sourceUrl)}`,
          signal.status,
        ]),
      );

      const priorityRank: Record<SignalPriority, number> = { hot: 0, warm: 1, cold: 2 };
      const finalSignals = merged
        .map((signal, index) => {
          const key = `${signal.company}|${signal.triggerType}|${normalizeJobUrl(signal.sourceUrl)}`;
          return {
            ...signal,
            id: makeStableId([signal.company, signal.triggerType, String(index), signal.sourceUrl]),
            status: previousStatuses.get(key) || "Найдено",
          } satisfies GrowthSignal;
        })
        .sort((a, b) => priorityRank[a.priority] - priorityRank[b.priority]);

      await persistSignalsForClient(activeClient.id, finalSignals);
      if (settledBatches.failed > 0) {
        setSignalsError(
          `Часть источников сигналов недоступна (${settledBatches.failed}/${tasks.length}), показаны частичные результаты.`,
        );
      }
    } catch (error) {
      const previousStatuses = new Map(
        activeSignals.map((signal) => [
          `${signal.company}|${signal.triggerType}|${normalizeJobUrl(signal.sourceUrl)}`,
          signal.status,
        ]),
      );
      const fallbackSignals = buildSignalsFallbackFromJobs(activeJobs, previousStatuses);
      if (fallbackSignals.length > 0) {
        await persistSignalsForClient(activeClient.id, fallbackSignals);
        setSignalsError("Claude временно недоступен, показаны fallback сигналы по активным вакансиям.");
      } else {
        setSignalsError(humanizeClaudeError(error));
      }
    } finally {
      setIsSignalsLoading(false);
    }
  }

  function updateJobStatus(jobId: string, status: OutreachStatus) {
    if (!activeClient || !supabase) return;
    setJobsCacheByClient((prev) => {
      const current = prev[activeClient.id];
      if (!current) return prev;
      return {
        ...prev,
        [activeClient.id]: {
          ...current,
          items: current.items.map((job) => (job.id === jobId ? { ...job, status } : job)),
        },
      };
    });
    void supabase.from("jobs").update({ status }).eq("id", jobId);
  }

  function updateSignalStatus(signalId: string, status: OutreachStatus) {
    if (!activeClient || !supabase) return;
    setSignalsCacheByClient((prev) => {
      const current = prev[activeClient.id];
      if (!current) return prev;
      return {
        ...prev,
        [activeClient.id]: {
          ...current,
          items: current.items.map((signal) =>
            signal.id === signalId ? { ...signal, status } : signal,
          ),
        },
      };
    });
    void supabase.from("signals").update({ status }).eq("id", signalId);
  }

  function generateReport() {
    if (!activeClient) return;
    const topJobs = [...activeJobs].sort((a, b) => b.fitScore - a.fitScore).slice(0, 5);
    const topSignals = [...activeSignals].slice(0, 5);

    const lines = [
      `Еженедельный отчёт по клиенту (${todayRu()})`,
      "",
      `Клиент: ${activeClient.name}`,
      `Целевая роль: ${activeClient.targetRole || "Не указана"}`,
      `Локация: ${activeClient.location || "Не указана"}`,
      `Резюме: ${activeClient.resumeFileName || "текстовая версия"}`,
      "",
      "Операционная сводка:",
      `- Вакансий найдено: ${pipelineSummary.jobsFound}`,
      `- High-fit вакансий (score 80+): ${pipelineSummary.highMatches}`,
      `- Сигналов роста: ${pipelineSummary.signalsFound}`,
      `- Outreach отправлено: ${pipelineSummary.outreachSent}`,
      `- Ответов получено: ${pipelineSummary.responses}`,
      `- Конверсия: ${pipelineSummary.conversion}%`,
      "",
      "Топ-вакансии:",
      ...(topJobs.length
        ? topJobs.map(
            (job, index) =>
              `${index + 1}. ${job.title} — ${job.company} (${job.fitScore}%), статус: ${job.status}.`,
          )
        : ["1. Нет данных: запустите анализ вакансий."]),
      "",
      "Ключевые сигналы роста:",
      ...(topSignals.length
        ? topSignals.map(
            (signal, index) =>
              `${index + 1}. ${signal.company} — ${signal.triggerType}, приоритет: ${signal.priority}, статус: ${signal.status}.`,
          )
        : ["1. Нет данных: запустите сигналы роста."]),
      "",
      "Фокус на следующую неделю:",
      "- Довести outreach по hot/warm сигналам до этапа ответа.",
      "- Приоритизировать вакансии score 80+ и закрыть follow-up циклы.",
      "- Синхронизировать таргет компании и seniority с обновлённым резюме клиента.",
    ];
    setGeneratedReport(lines.join("\n"));
    setIsReportOpen(true);
  }

  async function handleAuthSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) return;
    if (!authEmail.trim() || !authPassword.trim()) {
      setAuthError("Введите email и пароль.");
      return;
    }
    setIsAuthActionLoading(true);
    setAuthError("");
    setAuthInfo("");
    try {
      if (authMode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({
          email: authEmail.trim(),
          password: authPassword,
        });
        if (error) throw error;
      } else {
        const { error } = await supabase.auth.signUp({
          email: authEmail.trim(),
          password: authPassword,
        });
        if (error) throw error;
        setAuthInfo("Аккаунт создан. Если включено подтверждение email, проверьте почту.");
      }
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Ошибка авторизации.");
    } finally {
      setIsAuthActionLoading(false);
    }
  }

  async function handleSignOut() {
    if (!supabase) return;
    await supabase.auth.signOut();
  }

  if (supabaseError) {
    return (
      <main className="min-h-screen bg-slate-100 p-6">
        <div className="mx-auto max-w-2xl rounded-2xl border border-rose-200 bg-white p-6">
          <h1 className="text-xl font-semibold text-rose-700">Ошибка конфигурации Supabase</h1>
          <p className="mt-2 text-sm text-slate-700">{supabaseError}</p>
          <p className="mt-2 text-sm text-slate-700">
            Проверьте переменные окружения: <code>NEXT_PUBLIC_SUPABASE_URL</code> и{" "}
            <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code>.
          </p>
        </div>
      </main>
    );
  }

  if (isAuthLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-100">
        <p className="text-sm text-slate-600">Проверяем сессию...</p>
      </main>
    );
  }

  if (!user) {
    return (
      <main className="min-h-screen bg-gradient-to-b from-slate-100 to-slate-50 p-6">
        <div className="mx-auto max-w-md rounded-3xl border border-slate-200 bg-white p-6 shadow-[0_12px_28px_-18px_rgba(15,23,42,0.4)]">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-600">RoleRadar</p>
          <h1 className="mt-2 text-2xl font-semibold">Вход в workspace</h1>
          <p className="mt-1 text-sm text-slate-500">
            Авторизуйтесь через Supabase Auth, чтобы увидеть клиентов.
          </p>
          <form className="mt-5 space-y-3" onSubmit={(event) => void handleAuthSubmit(event)}>
            <div>
              <label className="mb-1 block text-sm font-medium">Email</label>
              <input
                type="email"
                value={authEmail}
                onChange={(e) => setAuthEmail(e.target.value)}
                className="h-11 w-full rounded-xl border border-slate-300 px-3 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
                placeholder="name@company.com"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Пароль</label>
              <input
                type="password"
                value={authPassword}
                onChange={(e) => setAuthPassword(e.target.value)}
                className="h-11 w-full rounded-xl border border-slate-300 px-3 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
                placeholder="••••••••"
              />
            </div>
            {authError ? <p className="text-xs text-rose-700">{authError}</p> : null}
            {authInfo ? <p className="text-xs text-emerald-700">{authInfo}</p> : null}
            <button
              type="submit"
              disabled={isAuthActionLoading}
              className="inline-flex h-11 w-full items-center justify-center rounded-xl bg-slate-900 px-5 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-70"
            >
              {isAuthActionLoading
                ? "Проверяем..."
                : authMode === "signin"
                  ? "Войти"
                  : "Создать аккаунт"}
            </button>
          </form>
          <button
            type="button"
            onClick={() => setAuthMode((prev) => (prev === "signin" ? "signup" : "signin"))}
            className="mt-3 text-xs font-medium text-blue-700 hover:text-blue-800"
          >
            {authMode === "signin" ? "Нет аккаунта? Создать" : "Уже есть аккаунт? Войти"}
          </button>
        </div>
      </main>
    );
  }

  if (appLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-100">
        <p className="text-sm text-slate-600">Загружаем клиентов и pipeline...</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gradient-to-b from-slate-100 to-slate-50 p-4 text-slate-900 md:p-6">
      <div className="mx-auto grid w-full max-w-[1520px] grid-cols-1 gap-5 lg:grid-cols-[330px_1fr]">
        <aside className="relative overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-[0_8px_32px_-18px_rgba(15,23,42,0.4)]">
          <div className="border-b border-slate-200 px-5 pb-5 pt-6">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-600">
              RoleRadar
            </p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight">Клиентский workspace</h1>
            <p className="mt-1 text-sm text-slate-500">
              {userRole === "admin"
                ? "Роль: admin — доступны все клиенты"
                : "Роль: consultant — доступны только ваши клиенты"}
            </p>
            <p className="mt-1 text-xs text-slate-500">{user.email}</p>
            <div className="mt-4 flex items-center gap-2">
              <button
                type="button"
                onClick={() => void loadAllDataForUser(user)}
                className="inline-flex h-9 items-center justify-center rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-100"
              >
                Обновить данные
              </button>
              <button
                type="button"
                onClick={() => void handleSignOut()}
                className="inline-flex h-9 items-center justify-center rounded-lg border border-rose-200 bg-rose-50 px-3 text-xs font-semibold text-rose-700 hover:bg-rose-100"
              >
                Выйти
              </button>
            </div>
            {userRole === "admin" ? (
              <button
                type="button"
                onClick={() => setIsAdminUsersOpen(true)}
                className="mt-3 inline-flex h-9 items-center justify-center rounded-lg border border-indigo-200 bg-indigo-50 px-3 text-xs font-semibold text-indigo-700 hover:bg-indigo-100"
              >
                Управление пользователями
              </button>
            ) : null}
            <div className="mt-5 space-y-2">
              <input
                value={newClientName}
                onChange={(e) => setNewClientName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void addClient();
                  }
                }}
                placeholder="Добавить клиента"
                className="h-10 w-full rounded-xl border border-slate-300 px-3 text-sm outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
              />
              {userRole === "admin" ? (
                <select
                  value={newClientConsultantId}
                  onChange={(e) => setNewClientConsultantId(e.target.value)}
                  className="h-10 w-full rounded-xl border border-slate-300 px-3 text-sm outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
                >
                  {consultants.length ? (
                    consultants.map((consultant) => (
                      <option key={consultant.id} value={consultant.id}>
                        {consultant.fullName || consultant.email} ({consultant.role})
                      </option>
                    ))
                  ) : (
                    <option value="">Нет пользователей</option>
                  )}
                </select>
              ) : null}
              <button
                type="button"
                onClick={() => void addClient()}
                className="inline-flex h-10 w-full items-center justify-center rounded-xl bg-blue-600 px-4 text-sm font-medium text-white shadow-sm transition hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-200 active:translate-y-px"
              >
                Добавить
              </button>
            </div>
          </div>

          <ul className="max-h-[65vh] space-y-2 overflow-y-auto p-4">
            {clients.map((client) => {
              const active = client.id === activeClientId;
              const jobsCount = jobsCacheByClient[client.id]?.items?.length || 0;
              const owner = consultantById.get(client.consultantId);
              return (
                <li
                  key={client.id}
                  className={`rounded-2xl border p-3 transition ${
                    active
                      ? "border-blue-200 bg-blue-50 shadow-[0_10px_20px_-16px_rgba(37,99,235,0.9)]"
                      : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => {
                      setActiveClientId(client.id);
                      setIsReportOpen(false);
                    }}
                    className="w-full text-left"
                  >
                    <p className="text-sm font-semibold text-slate-900">{client.name}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      {client.targetRole || "Целевая роль не указана"}
                    </p>
                    <p className="mt-1 text-xs text-slate-400">{jobsCount} вакансий в pipeline</p>
                    <p className="mt-1 text-[11px] text-slate-500">
                      Консультант: {owner?.fullName || owner?.email || "не назначен"}
                    </p>
                  </button>
                  {userRole === "admin" ? (
                    <div className="mt-2">
                      <label className="mb-1 block text-[11px] font-medium text-slate-500">
                        Переназначить клиента
                      </label>
                      <select
                        value={client.consultantId}
                        onChange={(e) => void reassignClient(client.id, e.target.value)}
                        className="h-8 w-full rounded-lg border border-slate-300 px-2 text-xs outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                      >
                        {consultants.map((consultant) => (
                          <option key={consultant.id} value={consultant.id}>
                            {consultant.fullName || consultant.email} ({consultant.role})
                          </option>
                        ))}
                      </select>
                    </div>
                  ) : null}
                  <div className="mt-3 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void renameClient(client.id)}
                      className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-200 active:translate-y-px"
                    >
                      Переименовать
                    </button>
                    <button
                      type="button"
                      onClick={() => void deleteClient(client.id)}
                      className="rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-xs font-medium text-rose-700 transition hover:bg-rose-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-200 active:translate-y-px"
                    >
                      Удалить
                    </button>
                  </div>
                </li>
              );
            })}
            {!clients.length ? (
              <li className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-4 text-center text-sm text-slate-500">
                Клиентов пока нет. Добавьте первого клиента.
              </li>
            ) : null}
          </ul>
        </aside>

        <section className="space-y-5">
          {appError ? (
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
              {appError}
            </div>
          ) : null}

          {!activeClient ? (
            <section className="rounded-3xl border border-slate-200 bg-white p-8 text-center">
              <h2 className="text-xl font-semibold">Нет активного клиента</h2>
              <p className="mt-2 text-sm text-slate-500">Добавьте клиента в левом меню, чтобы начать работу.</p>
            </section>
          ) : (
            <>
              <header className="rounded-3xl border border-slate-200 bg-white p-5 shadow-[0_8px_32px_-18px_rgba(15,23,42,0.35)]">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                      Активный клиент
                    </p>
                    <h2 className="mt-1 text-2xl font-semibold">{activeClient.name}</h2>
                    <p className="mt-1 text-sm text-slate-500">
                      {activeClient.targetRole || "Роль не задана"} · {activeClient.location || "Локация не задана"}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void runJobsEngine(false)}
                      disabled={isJobsLoading}
                      className="inline-flex h-11 items-center justify-center rounded-xl bg-slate-900 px-5 text-sm font-medium text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-wait disabled:opacity-70"
                    >
                      {isJobsLoading ? "Ищем вакансии..." : "Запустить анализ"}
                    </button>
                    <button
                      type="button"
                      onClick={() => void runJobsEngine(true)}
                      disabled={isJobsLoading}
                      className="inline-flex h-11 items-center justify-center rounded-xl border border-slate-300 bg-white px-5 text-sm font-medium text-slate-800 shadow-sm transition hover:bg-slate-100 disabled:opacity-70"
                    >
                      Обновить
                    </button>
                    <button
                      type="button"
                      onClick={generateReport}
                      className="inline-flex h-11 items-center justify-center rounded-xl bg-blue-600 px-5 text-sm font-medium text-white shadow-sm transition hover:bg-blue-700"
                    >
                      Сгенерировать отчёт
                    </button>
                  </div>
                </div>
              </header>

              <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-[0_8px_32px_-18px_rgba(15,23,42,0.3)]">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="text-lg font-semibold">Анализ резюме</h3>
                    <button
                      type="button"
                      onClick={() => void runResumeReanalysis()}
                      disabled={isResumeAnalyzing}
                      className="inline-flex h-9 items-center justify-center rounded-lg border border-blue-300 bg-blue-50 px-3 text-xs font-semibold text-blue-800 transition hover:bg-blue-100 disabled:opacity-70"
                    >
                      {isResumeAnalyzing ? "Анализ..." : "Переанализировать"}
                    </button>
                  </div>

                  <div className="mt-4 space-y-4">
                    <div
                      onDragOver={(event) => {
                        event.preventDefault();
                        setDragActive(true);
                      }}
                      onDragLeave={(event) => {
                        event.preventDefault();
                        setDragActive(false);
                      }}
                      onDrop={onDropResume}
                      className={`rounded-2xl border-2 border-dashed p-4 transition ${
                        dragActive ? "border-blue-400 bg-blue-50" : "border-slate-300 bg-slate-50 hover:border-slate-400"
                      }`}
                    >
                      <p className="text-sm font-medium text-slate-700">Перетащите резюме (PDF или текст)</p>
                      <p className="mt-1 text-xs text-slate-500">Можно загрузить файл или вставить текст резюме.</p>
                      <div className="mt-3 flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => fileInputRef.current?.click()}
                          className="inline-flex h-9 items-center justify-center rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
                        >
                          Загрузить файл
                        </button>
                        {activeClient.resumeFileName ? (
                          <span className="rounded-lg bg-emerald-50 px-2.5 py-1.5 text-xs font-medium text-emerald-700">
                            {activeClient.resumeFileName}
                          </span>
                        ) : (
                          <span className="text-xs text-slate-500">Файл пока не загружен</span>
                        )}
                      </div>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept=".pdf,.txt,.md,.doc,.docx"
                        onChange={onSelectResume}
                        className="hidden"
                      />
                    </div>

                    <div>
                      <div className="mb-1 flex items-center justify-between gap-2">
                        <label className="block text-sm font-medium">Текст резюме</label>
                        <button
                          type="button"
                          onClick={pasteResumeFromClipboard}
                          className="inline-flex h-8 items-center justify-center rounded-lg border border-slate-300 bg-white px-2.5 text-xs font-medium text-slate-700 transition hover:bg-slate-100"
                        >
                          Вставить из буфера
                        </button>
                      </div>
                      <textarea
                        value={activeClient.resume}
                        onChange={(e) => updateActiveClient({ resume: e.target.value })}
                        onPaste={onPasteResume}
                        rows={6}
                        placeholder="Вставьте резюме клиента..."
                        className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
                      />
                      {resumeInputError ? <p className="mt-1 text-xs text-rose-700">{resumeInputError}</p> : null}
                    </div>

                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Распаршенный профиль клиента
                      </p>
                      {activeResumeAnalysis ? (
                        <div className="mt-2 grid grid-cols-1 gap-2 text-xs text-slate-700 sm:grid-cols-2">
                          <p>
                            <span className="font-semibold">Current titles:</span>{" "}
                            {activeResumeAnalysis.profile.jobTitlesCurrent.join(", ") || "—"}
                          </p>
                          <p>
                            <span className="font-semibold">Target titles:</span>{" "}
                            {activeResumeAnalysis.profile.jobTitlesTarget.join(", ") || "—"}
                          </p>
                          <p>
                            <span className="font-semibold">Опыт (лет):</span>{" "}
                            {activeResumeAnalysis.profile.totalYearsExperience ?? "—"}
                          </p>
                          <p>
                            <span className="font-semibold">Seniority:</span>{" "}
                            {activeResumeAnalysis.profile.seniorityLevel || "—"}
                          </p>
                          <p className="sm:col-span-2">
                            <span className="font-semibold">Top skills:</span>{" "}
                            {activeResumeAnalysis.profile.topSkills.join(", ") || "—"}
                          </p>
                          <p className="sm:col-span-2">
                            <span className="font-semibold">Industries:</span>{" "}
                            {activeResumeAnalysis.profile.industries.join(", ") || "—"}
                          </p>
                          <p>
                            <span className="font-semibold">Location:</span>{" "}
                            {activeResumeAnalysis.profile.location || "—"}
                          </p>
                          <p>
                            <span className="font-semibold">Preferred size:</span>{" "}
                            {activeResumeAnalysis.profile.preferredCompanySize || "—"}
                          </p>
                          <p className="sm:col-span-2 text-slate-500">
                            Последнее обновление: {relativeCacheAge(activeResumeAnalysis.timestamp)}
                          </p>
                        </div>
                      ) : (
                        <p className="mt-2 text-xs text-slate-500">
                          Профиль появится после загрузки резюме или нажатия «Переанализировать».
                        </p>
                      )}
                    </div>
                  </div>
                </div>

                <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-[0_8px_32px_-18px_rgba(15,23,42,0.3)]">
                  <h3 className="text-lg font-semibold">Параметры поиска</h3>
                  <p className="mt-1 text-sm text-slate-500">
                    Эти данные используются для подбора вакансий и сигналов.
                  </p>
                  <div className="mt-4 space-y-4">
                    <div>
                      <label className="mb-1 block text-sm font-medium">Целевая роль</label>
                      <input
                        value={activeClient.targetRole}
                        onChange={(e) => updateActiveClient({ targetRole: e.target.value })}
                        placeholder="Например, Senior Product Manager"
                        className="h-11 w-full rounded-xl border border-slate-300 px-3 text-sm outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-sm font-medium">Локация</label>
                      <input
                        value={activeClient.location}
                        onChange={(e) => updateActiveClient({ location: e.target.value })}
                        placeholder="Например, Miami, FL"
                        className="h-11 w-full rounded-xl border border-slate-300 px-3 text-sm outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-sm font-medium">Уровень кандидата</label>
                      <select
                        value={activeClient.candidateLevel}
                        onChange={(e) => updateActiveClient({ candidateLevel: e.target.value as CandidateLevel })}
                        className="h-11 w-full rounded-xl border border-slate-300 px-3 text-sm outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
                      >
                        {CANDIDATE_LEVEL_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <p className="mb-2 block text-sm font-medium">Размер компаний</p>
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                        {COMPANY_SIZE_OPTIONS.map((option) => {
                          const checked = activeClient.preferredCompanySizes.includes(option.value);
                          return (
                            <label
                              key={option.value}
                              className={`flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-sm transition ${
                                checked
                                  ? "border-blue-300 bg-blue-50 text-blue-900"
                                  : "border-slate-300 bg-white text-slate-700 hover:border-slate-400"
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(e) => {
                                  const next = e.target.checked
                                    ? [...activeClient.preferredCompanySizes, option.value]
                                    : activeClient.preferredCompanySizes.filter((size) => size !== option.value);
                                  if (!next.length) return;
                                  updateActiveClient({ preferredCompanySizes: next });
                                }}
                                className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-300"
                              />
                              <span>{option.label}</span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
                      Последний запуск вакансий:{" "}
                      <span className="font-medium text-slate-800">
                        {relativeCacheAge(activeJobsCache?.timestamp)}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-[0_8px_32px_-18px_rgba(15,23,42,0.3)]">
                <h3 className="text-xl font-semibold">Сводка по пайплайну</h3>
                <p className="text-sm text-slate-500">KPI по вакансиям, сигналам и outreach-статусам</p>
                <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  {metrics.map((metric, index) => (
                    <article
                      key={metric.label}
                      className={`rounded-2xl border bg-gradient-to-br p-4 ${metricTone(index)}`}
                    >
                      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                        {metric.label}
                      </p>
                      <p className="mt-2 text-3xl font-semibold tracking-tight">{metric.value}</p>
                      <p className="mt-1 text-xs text-slate-500">{metric.hint}</p>
                    </article>
                  ))}
                </div>
              </section>

              <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-[0_8px_32px_-18px_rgba(15,23,42,0.3)]">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                  <div className="inline-flex rounded-xl border border-slate-200 bg-slate-50 p-1">
                    <button
                      type="button"
                      onClick={() => setWorkspaceTab("jobs")}
                      className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
                        workspaceTab === "jobs"
                          ? "bg-white text-slate-900 shadow-sm"
                          : "text-slate-600 hover:text-slate-900"
                      }`}
                    >
                      Движок вакансий
                    </button>
                    <button
                      type="button"
                      onClick={() => setWorkspaceTab("signals")}
                      className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
                        workspaceTab === "signals"
                          ? "bg-white text-slate-900 shadow-sm"
                          : "text-slate-600 hover:text-slate-900"
                      }`}
                    >
                      Сигналы роста
                    </button>
                  </div>
                  <div className="flex items-center gap-2">
                    {workspaceTab === "jobs" ? (
                      <>
                        <button
                          type="button"
                          onClick={() => void runJobsEngine(false)}
                          disabled={isJobsLoading}
                          className="inline-flex h-10 items-center justify-center rounded-xl bg-slate-900 px-4 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-70"
                        >
                          {isJobsLoading ? "Загрузка..." : "Запустить"}
                        </button>
                        <button
                          type="button"
                          onClick={() => void runJobsEngine(true)}
                          disabled={isJobsLoading}
                          className="inline-flex h-10 items-center justify-center rounded-xl border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 transition hover:bg-slate-100 disabled:opacity-70"
                        >
                          Обновить
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => void runSignalsEngine(false)}
                          disabled={isSignalsLoading}
                          className="inline-flex h-10 items-center justify-center rounded-xl bg-slate-900 px-4 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-70"
                        >
                          {isSignalsLoading ? "Загрузка..." : "Запустить сигналы"}
                        </button>
                        <button
                          type="button"
                          onClick={() => void runSignalsEngine(true)}
                          disabled={isSignalsLoading}
                          className="inline-flex h-10 items-center justify-center rounded-xl border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 transition hover:bg-slate-100 disabled:opacity-70"
                        >
                          Обновить
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {workspaceTab === "jobs" ? (
                  <>
                    {jobsError ? (
                      <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
                        {jobsError}
                      </div>
                    ) : null}
                    {!activeJobs.length ? (
                      <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-10 text-center">
                        <p className="text-sm font-medium text-slate-700">Пока нет вакансий для клиента</p>
                        <p className="mt-1 text-sm text-slate-500">
                          Нажмите «Запустить», чтобы собрать актуальные вакансии.
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {activeJobs.map((job) => (
                          <article
                            key={job.id}
                            className="rounded-2xl border border-slate-200 bg-slate-50/60 p-4 transition hover:border-slate-300 hover:bg-white"
                          >
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div>
                                <h4 className="text-base font-semibold text-slate-900">{job.title}</h4>
                                <p className="text-sm text-slate-500">
                                  {job.company} · {job.location}
                                </p>
                                <p className="mt-1 text-xs text-slate-400">
                                  Вариант: {job.sourceVariant} · Размер: {job.companySize}
                                </p>
                              </div>
                              <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${scoreTone(job.fitScore)}`}>
                                Fit {job.fitScore}%
                              </span>
                            </div>

                            <p className="mt-2 text-sm text-slate-700">{job.fitReason}</p>
                            <p className="mt-1 text-xs text-slate-500">{job.evidence}</p>
                            <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-[1fr_auto]">
                              <div className="rounded-xl border border-blue-100 bg-blue-50/60 p-3">
                                <p className="text-xs font-semibold uppercase tracking-wide text-blue-800">
                                  Кому писать
                                </p>
                                <p className="mt-1 text-sm text-slate-700">{job.hiringContactRole}</p>
                                <p className="mt-2 text-sm text-slate-700">{job.outreachMessage}</p>
                                <a
                                  href={job.url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="mt-2 inline-flex text-xs font-semibold text-blue-700 underline decoration-blue-300 underline-offset-2 hover:text-blue-800"
                                >
                                  Открыть вакансию
                                </a>
                              </div>
                              <div className="min-w-[190px] rounded-xl border border-slate-200 bg-white p-3">
                                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                                  Статус outreach
                                </label>
                                <select
                                  value={job.status}
                                  onChange={(e) => updateJobStatus(job.id, parseOutreachStatus(e.target.value))}
                                  className="h-10 w-full rounded-lg border border-slate-300 bg-white px-2 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                                >
                                  {OUTREACH_STATUS_OPTIONS.map((status) => (
                                    <option key={status} value={status}>
                                      {status}
                                    </option>
                                  ))}
                                </select>
                              </div>
                            </div>
                          </article>
                        ))}
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    {signalsError ? (
                      <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
                        {signalsError}
                      </div>
                    ) : null}
                    {!activeSignals.length ? (
                      <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-10 text-center">
                        <p className="text-sm font-medium text-slate-700">Сигналы роста пока не собраны</p>
                        <p className="mt-1 text-sm text-slate-500">
                          Нажмите «Запустить сигналы», чтобы получить funding / expansion / key hire / contract триггеры.
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {activeSignals.map((signal) => {
                          const priorityStyle =
                            signal.priority === "hot"
                              ? "border-rose-200 bg-rose-50"
                              : signal.priority === "warm"
                                ? "border-amber-200 bg-amber-50"
                                : "border-slate-200 bg-slate-50";
                          return (
                            <article key={signal.id} className={`rounded-2xl border p-4 ${priorityStyle}`}>
                              <div className="flex flex-wrap items-start justify-between gap-3">
                                <div>
                                  <h4 className="text-base font-semibold text-slate-900">{signal.company}</h4>
                                  <p className="text-sm text-slate-600">
                                    Trigger: {signal.triggerType} · Priority: {signal.priority.toUpperCase()}
                                  </p>
                                </div>
                                <span
                                  className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                                    signal.priority === "hot"
                                      ? "bg-rose-100 text-rose-700"
                                      : signal.priority === "warm"
                                        ? "bg-amber-100 text-amber-700"
                                        : "bg-slate-100 text-slate-700"
                                  }`}
                                >
                                  {signal.priority}
                                </span>
                              </div>
                              <p className="mt-2 text-sm text-slate-700">{signal.evidence}</p>
                              <p className="mt-1 text-xs text-slate-500">Hiring manager: {signal.hiringManager}</p>
                              <div className="mt-3 rounded-xl border border-blue-100 bg-blue-50/60 p-3">
                                <p className="text-xs font-semibold uppercase tracking-wide text-blue-800">
                                  Outreach message (EN)
                                </p>
                                <p className="mt-1 text-sm text-slate-700">{signal.outreachMessage}</p>
                                <a
                                  href={signal.sourceUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="mt-2 inline-flex text-xs font-semibold text-blue-700 underline decoration-blue-300 underline-offset-2 hover:text-blue-800"
                                >
                                  Источник сигнала
                                </a>
                              </div>
                              <div className="mt-3 max-w-[260px] rounded-xl border border-slate-200 bg-white p-3">
                                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                                  Статус outreach
                                </label>
                                <select
                                  value={signal.status}
                                  onChange={(e) =>
                                    updateSignalStatus(signal.id, parseOutreachStatus(e.target.value))
                                  }
                                  className="h-10 w-full rounded-lg border border-slate-300 bg-white px-2 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                                >
                                  {OUTREACH_STATUS_OPTIONS.map((status) => (
                                    <option key={status} value={status}>
                                      {status}
                                    </option>
                                  ))}
                                </select>
                              </div>
                            </article>
                          );
                        })}
                      </div>
                    )}
                  </>
                )}
              </section>
            </>
          )}
        </section>
      </div>

      {isReportOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-[2px]">
          <div className="max-h-[88vh] w-full max-w-3xl overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl">
            <header className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-600">
                  Weekly Report Generator
                </p>
                <h3 className="mt-1 text-xl font-semibold">Отчёт по клиенту</h3>
              </div>
              <button
                type="button"
                onClick={() => setIsReportOpen(false)}
                className="inline-flex h-9 items-center justify-center rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
              >
                Закрыть
              </button>
            </header>
            <div className="max-h-[72vh] overflow-y-auto px-6 py-5">
              <pre className="whitespace-pre-wrap rounded-2xl border border-slate-200 bg-slate-50 p-5 text-sm leading-relaxed text-slate-700">
                {generatedReport || "Сгенерируйте отчёт, чтобы увидеть содержимое."}
              </pre>
            </div>
          </div>
        </div>
      ) : null}

      {isAdminUsersOpen ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-[2px]">
          <div className="max-h-[88vh] w-full max-w-4xl overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl">
            <header className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-indigo-600">Admin Panel</p>
                <h3 className="mt-1 text-xl font-semibold">Управление пользователями</h3>
              </div>
              <button
                type="button"
                onClick={() => setIsAdminUsersOpen(false)}
                className="inline-flex h-9 items-center justify-center rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
              >
                Закрыть
              </button>
            </header>
            <div className="max-h-[72vh] overflow-y-auto px-6 py-5">
              {adminPanelError ? (
                <div className="mb-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
                  {adminPanelError}
                </div>
              ) : null}
              <div className="space-y-3">
                {consultants.map((consultant) => {
                  const isSelf = consultant.id === user?.id;
                  return (
                    <article
                      key={consultant.id}
                      className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4"
                    >
                      <div className="grid grid-cols-1 gap-3 md:grid-cols-[1.2fr_1fr_auto]">
                        <div>
                          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                            Имя пользователя
                          </label>
                          <input
                            value={consultant.fullName || ""}
                            onChange={(e) =>
                              updateConsultantDraft(consultant.id, {
                                fullName: e.target.value,
                              })
                            }
                            placeholder="Например, Jane Smith"
                            className="h-10 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                            Роль
                          </label>
                          <select
                            value={consultant.role}
                            onChange={(e) =>
                              updateConsultantDraft(consultant.id, {
                                role: e.target.value as UserRole,
                              })
                            }
                            disabled={isSelf}
                            className="h-10 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 disabled:cursor-not-allowed disabled:opacity-70"
                          >
                            <option value="consultant">consultant</option>
                            <option value="admin">admin</option>
                          </select>
                          {isSelf ? (
                            <p className="mt-1 text-[11px] text-slate-500">
                              Ваша роль редактируется только через другого admin.
                            </p>
                          ) : null}
                        </div>
                        <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
                          <p className="font-medium text-slate-700">Email</p>
                          <p className="mt-1 break-all">{consultant.email}</p>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            </div>
            <footer className="flex items-center justify-end gap-2 border-t border-slate-200 px-6 py-4">
              <button
                type="button"
                onClick={() => setIsAdminUsersOpen(false)}
                className="inline-flex h-10 items-center justify-center rounded-xl border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
              >
                Отмена
              </button>
              <button
                type="button"
                onClick={() => void saveUserProfiles()}
                disabled={isSavingUserProfiles}
                className="inline-flex h-10 items-center justify-center rounded-xl bg-indigo-600 px-4 text-sm font-medium text-white transition hover:bg-indigo-700 disabled:opacity-70"
              >
                {isSavingUserProfiles ? "Сохраняем..." : "Сохранить изменения"}
              </button>
            </footer>
          </div>
        </div>
      ) : null}
    </main>
  );
}
