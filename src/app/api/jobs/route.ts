import { NextRequest, NextResponse } from "next/server";

type GreenhouseJob = {
  id: number;
  title: string;
  absolute_url: string;
  location?: { name?: string };
  updated_at?: string;
};

type GreenhouseResponse = {
  jobs?: GreenhouseJob[];
};

type LeverJob = {
  id: string;
  text: string;
  hostedUrl: string;
  createdAt?: number;
  categories?: { location?: string };
};

type SeniorityBand = "junior" | "middle" | "senior";
type CompanySizeBand = "startup" | "scaleup" | "enterprise";

type MatchContext = {
  roleTokens: string[];
  matchedRoleTokens: string[];
  matchedRoleConcepts: string[];
  resumeSkillsMatched: string[];
  locationMatched: boolean;
  seniorityMatched: boolean;
  penalties: string[];
  baseRoleScore: number;
};

type RealJob = {
  id: string;
  title: string;
  company: string;
  location: string;
  source: string;
  applyUrl: string;
  postedAt?: string;
  companySize: CompanySizeBand;
  matchScore: number;
  fitReason: string;
  fitSignals: string[];
  fitRisks: string[];
  linkedinTargetRole: string;
  linkedinSearchUrl: string;
  outreachTip: string;
};

type BoardConfig = {
  slug: string;
  company: string;
  size: CompanySizeBand;
};

const US_GREENHOUSE_BOARDS: BoardConfig[] = [
  { slug: "stripe", company: "Stripe", size: "enterprise" },
  { slug: "airbnb", company: "Airbnb", size: "enterprise" },
  { slug: "lyft", company: "Lyft", size: "enterprise" },
  { slug: "affirm", company: "Affirm", size: "scaleup" },
  { slug: "coinbase", company: "Coinbase", size: "enterprise" },
  { slug: "datadog", company: "Datadog", size: "enterprise" },
  { slug: "reddit", company: "Reddit", size: "scaleup" },
  { slug: "robinhood", company: "Robinhood", size: "scaleup" },
  { slug: "fivetran", company: "Fivetran", size: "scaleup" },
  { slug: "checkr", company: "Checkr", size: "startup" },
  { slug: "khanacademy", company: "Khan Academy", size: "startup" },
  { slug: "webflow", company: "Webflow", size: "scaleup" },
  { slug: "calendly", company: "Calendly", size: "startup" },
  { slug: "figma", company: "Figma", size: "scaleup" },
  { slug: "discord", company: "Discord", size: "scaleup" },
  { slug: "duolingo", company: "Duolingo", size: "scaleup" },
  { slug: "natera", company: "Natera", size: "enterprise" },
  { slug: "brex", company: "Brex", size: "scaleup" },
  { slug: "okta", company: "Okta", size: "enterprise" },
  { slug: "twilio", company: "Twilio", size: "enterprise" },
  { slug: "boxinc", company: "Box", size: "enterprise" },
  { slug: "elastic", company: "Elastic", size: "enterprise" },
  { slug: "gusto", company: "Gusto", size: "scaleup" },
  { slug: "dropbox", company: "Dropbox", size: "enterprise" },
  { slug: "instabase", company: "Instabase", size: "startup" },
  { slug: "opendoor", company: "Opendoor", size: "enterprise" },
  { slug: "tripadvisor", company: "Tripadvisor", size: "enterprise" },
  { slug: "asana", company: "Asana", size: "scaleup" },
  { slug: "gitlab", company: "GitLab", size: "enterprise" },
  { slug: "xai", company: "xAI", size: "startup" },
  { slug: "samsara", company: "Samsara", size: "enterprise" },
  { slug: "databricks", company: "Databricks", size: "enterprise" },
  { slug: "mongodb", company: "MongoDB", size: "enterprise" },
  { slug: "yext", company: "Yext", size: "scaleup" },
  { slug: "braze", company: "Braze", size: "scaleup" },
  { slug: "squarespace", company: "Squarespace", size: "scaleup" },
  { slug: "instacart", company: "Instacart", size: "enterprise" },
  { slug: "coursera", company: "Coursera", size: "scaleup" },
  { slug: "udemy", company: "Udemy", size: "scaleup" },
  { slug: "quip", company: "Quip", size: "startup" },
  { slug: "pinterest", company: "Pinterest", size: "enterprise" },
  { slug: "cloudflare", company: "Cloudflare", size: "enterprise" },
];

const US_LEVER_BOARDS: BoardConfig[] = [{ slug: "mindtickle", company: "Mindtickle", size: "scaleup" }];

const SKILL_KEYWORDS = [
  "product",
  "growth",
  "analytics",
  "sql",
  "python",
  "react",
  "node",
  "typescript",
  "go",
  "java",
  "aws",
  "gcp",
  "azure",
  "kubernetes",
  "devops",
  "ml",
  "ai",
  "data",
  "security",
  "sales",
  "marketing",
  "finance",
  "operations",
  "hr",
  "talent",
  "recruiting",
  "mobility",
];

const ROLE_SYNONYMS: Record<string, string[]> = {
  mobility: ["mobility", "relocation", "immigration"],
  recruiter: ["recruiter", "recruiting", "talent", "sourcer"],
  backend: ["backend", "api", "platform", "server"],
  frontend: ["frontend", "ui", "web", "react"],
  product: ["product", "pm"],
  engineer: ["engineer", "engineering", "developer"],
};

function expandRoleConcepts(tokens: string[]): string[] {
  const expanded: string[] = [];
  for (const token of tokens) {
    expanded.push(token);
    const synonyms = ROLE_SYNONYMS[token];
    if (synonyms?.length) {
      expanded.push(...synonyms);
    }
  }
  return unique(expanded);
}

function normalize(value: string): string {
  return value.toLowerCase().trim();
}

function tokenize(text: string): string[] {
  return normalize(text)
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 2);
}

function unique<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}

function roleIntentTokens(role: string): string[] {
  const stop = new Set([
    "senior",
    "junior",
    "middle",
    "manager",
    "lead",
    "head",
    "principal",
    "specialist",
    "associate",
    "remote",
    "global",
    "the",
    "and",
    "for",
  ]);
  return tokenize(role).filter((token) => !stop.has(token));
}

function strictRoleMatch(title: string, role: string): boolean {
  const t = normalize(title);
  const r = normalize(role);
  if (!r) return true;
  if (t.includes(r)) return true;

  const roleTokens = roleIntentTokens(role);
  if (!roleTokens.length) return true;
  if (!roleTokens.every((token) => t.includes(token))) return false;

  const pairConflicts: Array<[string, string[]]> = [
    ["mobility", ["supply", "logistics", "procurement", "operations"]],
    ["supply", ["mobility", "immigration", "relocation"]],
    ["recruit", ["sales", "account executive"]],
  ];
  for (const [intent, conflicts] of pairConflicts) {
    if (roleTokens.includes(intent) && conflicts.some((word) => t.includes(word))) {
      return false;
    }
  }
  return true;
}

function roleAdjacentMatch(title: string, role: string): boolean {
  const t = normalize(title);
  const roleTokens = roleIntentTokens(role);
  if (!roleTokens.length) return false;

  if (roleTokens.includes("mobility")) {
    const positive = ["mobility", "immigration", "relocation"];
    const negative = ["supply", "procurement", "logistics", "warehouse"];
    return positive.some((word) => t.includes(word)) && !negative.some((word) => t.includes(word));
  }

  return roleTokens.some((token) => t.includes(token));
}

function seniorityFromTitle(title: string): SeniorityBand {
  const t = normalize(title);
  if (
    t.includes("principal") ||
    t.includes("staff") ||
    t.includes("lead") ||
    t.includes("head") ||
    t.includes("director") ||
    t.includes("vp") ||
    t.includes("senior")
  ) {
    return "senior";
  }
  if (t.includes("junior") || t.includes("entry") || t.includes("associate") || t.includes("intern")) {
    return "junior";
  }
  return "middle";
}

function estimateCandidateBand(
  experienceYears: number | null,
  resumeText: string,
  requestedBand?: string,
): SeniorityBand {
  const explicit = normalize(requestedBand || "");
  if (explicit === "junior" || explicit === "middle" || explicit === "senior") {
    return explicit;
  }

  const text = normalize(resumeText || "");
  if (experienceYears !== null) {
    if (experienceYears <= 2) return "junior";
    if (experienceYears <= 5) return "middle";
    return "senior";
  }

  if (text.includes("intern") || text.includes("стаж") || text.includes("entry level") || text.includes("junior")) {
    return "junior";
  }
  if (text.includes("senior") || text.includes("lead") || text.includes("руковод") || text.includes("staff")) {
    return "senior";
  }
  return "middle";
}

function parseCompanySizes(value: string | null): CompanySizeBand[] {
  if (!value) return ["startup", "scaleup", "enterprise"];
  const allowed: CompanySizeBand[] = ["startup", "scaleup", "enterprise"];
  const parsed = value
    .split(",")
    .map((item) => normalize(item))
    .filter((item): item is CompanySizeBand => allowed.includes(item as CompanySizeBand));
  return parsed.length ? parsed : ["startup", "scaleup", "enterprise"];
}

function deriveLinkedinTargetRole(title: string): string {
  const t = normalize(title);
  if (t.includes("product")) return "Senior Product Recruiter";
  if (t.includes("mobility")) return "Global Mobility Recruiter";
  if (t.includes("engineering") || t.includes("software") || t.includes("backend") || t.includes("frontend")) {
    return "Engineering Recruiter";
  }
  if (t.includes("data")) return "Data Recruiting Manager";
  if (t.includes("design")) return "Design Recruiting Lead";
  if (t.includes("sales")) return "Sales Recruiter";
  return "Talent Acquisition Partner";
}

function linkedinSearchUrl(company: string, role: string, location: string): string {
  const query = encodeURIComponent(`${role} ${company} ${location} site:linkedin.com/in`);
  return `https://www.google.com/search?q=${query}`;
}

function extractResumeSkills(resumeText: string): string[] {
  const lower = normalize(resumeText);
  return SKILL_KEYWORDS.filter((skill) => lower.includes(skill));
}

function buildMatchContext(
  title: string,
  role: string,
  location: string,
  jobLocation: string,
  candidateBand: SeniorityBand,
  resumeSkills: string[],
): MatchContext {
  const normalizedTitle = normalize(title);
  const normalizedRole = normalize(role);
  const normalizedLocation = normalize(location);
  const normalizedJobLocation = normalize(jobLocation);

  const roleTokens = roleIntentTokens(role);
  const roleConcepts = expandRoleConcepts(roleTokens);
  const matchedRoleTokens = roleTokens.filter((token) => normalizedTitle.includes(token));
  const matchedRoleConcepts = roleConcepts.filter((concept) => normalizedTitle.includes(concept));

  let baseRoleScore = 0;
  if (normalizedRole && normalizedTitle.includes(normalizedRole)) {
    baseRoleScore += 42;
  } else if (roleTokens.length) {
    baseRoleScore += Math.min(30, matchedRoleTokens.length * 10);
    if (matchedRoleTokens.length === roleTokens.length) baseRoleScore += 10;
    baseRoleScore += Math.min(8, matchedRoleConcepts.length * 2);
  } else {
    baseRoleScore += 12;
  }

  const resumeSkillsMatched = resumeSkills.filter((skill) => normalizedTitle.includes(skill));
  const locationMatched =
    !normalizedLocation ||
    normalizedJobLocation.includes(normalizedLocation) ||
    normalizedJobLocation.includes("remote") ||
    normalizedJobLocation.includes("united states") ||
    normalizedJobLocation.includes("us");
  const seniorityMatched = seniorityFromTitle(title) === candidateBand;

  const penalties: string[] = [];
  if (roleTokens.length >= 2 && matchedRoleTokens.length < Math.ceil(roleTokens.length / 2)) {
    penalties.push("low-role-token-overlap");
  }
  if (!locationMatched) penalties.push("location-mismatch");
  if (!seniorityMatched && candidateBand === "junior" && seniorityFromTitle(title) === "senior") {
    penalties.push("seniority-gap");
  }

  return {
    roleTokens,
    matchedRoleConcepts: unique(matchedRoleConcepts),
    matchedRoleTokens,
    resumeSkillsMatched: unique(resumeSkillsMatched),
    locationMatched,
    seniorityMatched,
    penalties,
    baseRoleScore,
  };
}

function scoreJobMatch(context: MatchContext, candidateBand: SeniorityBand): number {
  let score = 35 + context.baseRoleScore;

  score += Math.min(10, context.matchedRoleConcepts.length * 3);
  score += Math.min(18, context.resumeSkillsMatched.length * 6);
  if (context.locationMatched) score += 8;
  if (context.seniorityMatched) score += 8;

  if (candidateBand === "junior" && !context.seniorityMatched) score -= 16;
  if (context.penalties.includes("low-role-token-overlap")) score -= 14;
  if (context.penalties.includes("location-mismatch")) score -= 6;
  if (context.penalties.includes("seniority-gap")) score -= 12;

  return Math.max(30, Math.min(99, score));
}

function buildFitReason(
  role: string,
  location: string,
  candidateBand: SeniorityBand,
  context: MatchContext,
): string {
  const rolePart =
    context.matchedRoleTokens.length > 0
      ? `Совпали ключевые сигналы роли: ${context.matchedRoleTokens.join(", ")}.`
      : context.matchedRoleConcepts.length > 0
        ? `Точных токенов роли нет, но совпали смысловые маркеры: ${context.matchedRoleConcepts.join(", ")}.`
        : `Точное совпадение роли не найдено, матч построен по смежным признакам.`;

  const skillsPart = context.resumeSkillsMatched.length
    ? `Из резюме совпали навыки/домены: ${context.resumeSkillsMatched.join(", ")}.`
    : `Явных совпадений навыков из резюме в тайтле вакансии нет.`;

  const geoPart = context.locationMatched
    ? `Локация релевантна запросу (${location || "US/remote"}).`
    : `Локация не полностью совпадает с запросом (${location || "US/remote"}).`;

  const seniorityPart = context.seniorityMatched
    ? `Уровень вакансии совпадает с профилем клиента (${candidateBand}).`
    : `Уровень вакансии частично расходится с профилем клиента (${candidateBand}).`;

  const roleHint = role ? `Запрос: "${role}".` : "Роль не указана явно.";
  return `${roleHint} ${rolePart} ${skillsPart} ${geoPart} ${seniorityPart}`;
}

function isLikelyUSLocation(raw: string): boolean {
  const location = normalize(raw);
  const tokens = [
    "united states",
    "usa",
    "u.s.",
    "remote us",
    "us remote",
    "new york",
    "san francisco",
    "los angeles",
    "chicago",
    "seattle",
    "austin",
    "boston",
    "miami",
    "atlanta",
    "philadelphia",
    ", ca",
    ", ny",
    ", tx",
    ", fl",
    ", wa",
    ", il",
    ", ma",
    ", ga",
    ", pa",
  ];
  if (tokens.some((token) => location.includes(token))) return true;
  return /\b[A-Z]{2}\b/.test(raw) && /,\s?[A-Z]{2}\b/.test(raw);
}

async function fetchGreenhouseBoardJobs(board: BoardConfig): Promise<RealJob[]> {
  const url = `https://boards-api.greenhouse.io/v1/boards/${board.slug}/jobs?content=false`;
  const response = await fetch(url, {
    headers: {
      "User-Agent": "RoleRadar/1.0 (+internal-tool)",
      Accept: "application/json",
    },
    cache: "no-store",
  });

  if (!response.ok) return [];
  const payload = (await response.json()) as GreenhouseResponse;
  const jobs = payload.jobs ?? [];

  return jobs.map((job) => {
    const location = job.location?.name?.trim() || "United States";
    const targetRole = deriveLinkedinTargetRole(job.title);
    return {
      id: `${board.slug}-${job.id}`,
      title: job.title,
      company: board.company,
      location,
      source: `Greenhouse (${board.company})`,
      applyUrl: job.absolute_url,
      postedAt: job.updated_at,
      companySize: board.size,
      matchScore: 0,
      fitReason: "",
      fitSignals: [],
      fitRisks: [],
      linkedinTargetRole: targetRole,
      linkedinSearchUrl: linkedinSearchUrl(board.company, targetRole, location),
      outreachTip: `Найдите в LinkedIn: ${targetRole} в ${board.company}. Сфокусируйтесь на Talent Acquisition / Recruiting Team.`,
    };
  });
}

async function fetchLeverBoardJobs(board: BoardConfig): Promise<RealJob[]> {
  const url = `https://api.lever.co/v0/postings/${board.slug}?mode=json`;
  const response = await fetch(url, {
    headers: {
      "User-Agent": "RoleRadar/1.0 (+internal-tool)",
      Accept: "application/json",
    },
    cache: "no-store",
  });
  if (!response.ok) return [];

  const jobs = (await response.json()) as LeverJob[];
  return jobs.map((job) => {
    const title = job.text || "Untitled role";
    const location = job.categories?.location || "United States";
    const targetRole = deriveLinkedinTargetRole(title);
    return {
      id: `${board.slug}-${job.id}`,
      title,
      company: board.company,
      location,
      source: `Lever (${board.company})`,
      applyUrl: job.hostedUrl,
      postedAt: job.createdAt ? new Date(job.createdAt).toISOString() : undefined,
      companySize: board.size,
      matchScore: 0,
      fitReason: "",
      fitSignals: [],
      fitRisks: [],
      linkedinTargetRole: targetRole,
      linkedinSearchUrl: linkedinSearchUrl(board.company, targetRole, location),
      outreachTip: `Напишите ${targetRole} в ${board.company} с коротким value pitch и ссылкой на релевантный кейс.`,
    };
  });
}

function parseExperienceYears(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number(value);
  if (Number.isNaN(parsed) || parsed < 0 || parsed > 60) return null;
  return parsed;
}

function parsePostedAt(value: string | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

export async function GET(request: NextRequest) {
  const role = request.nextUrl.searchParams.get("role")?.trim() || "";
  const location = request.nextUrl.searchParams.get("location")?.trim() || "";
  const limit = Number(request.nextUrl.searchParams.get("limit") || "36");
  const companySizes = parseCompanySizes(request.nextUrl.searchParams.get("companySizes"));
  const daysWindowRaw = Number(request.nextUrl.searchParams.get("daysWindow") || "7");
  const daysWindow = Math.max(1, Math.min(30, Number.isNaN(daysWindowRaw) ? 7 : daysWindowRaw));
  const cutoffDate = new Date(Date.now() - daysWindow * 24 * 60 * 60 * 1000);
  const experienceYears = parseExperienceYears(request.nextUrl.searchParams.get("experienceYears"));
  const resumeText = request.nextUrl.searchParams.get("resumeText")?.slice(0, 4000) || "";
  const candidateBand = estimateCandidateBand(
    experienceYears,
    resumeText,
    request.nextUrl.searchParams.get("candidateBand") || undefined,
  );
  const resumeSkills = extractResumeSkills(resumeText);

  try {
    const [greenhouseSettled, leverSettled] = await Promise.all([
      Promise.allSettled(US_GREENHOUSE_BOARDS.map((board) => fetchGreenhouseBoardJobs(board))),
      Promise.allSettled(US_LEVER_BOARDS.map((board) => fetchLeverBoardJobs(board))),
    ]);

    const greenhouseJobs = greenhouseSettled
      .filter((item): item is PromiseFulfilledResult<RealJob[]> => item.status === "fulfilled")
      .flatMap((item) => item.value);
    const leverJobs = leverSettled
      .filter((item): item is PromiseFulfilledResult<RealJob[]> => item.status === "fulfilled")
      .flatMap((item) => item.value);

    const fetched = [...greenhouseJobs, ...leverJobs];
    const usOnly = fetched.filter((job) => isLikelyUSLocation(job.location));
    const recentOnly = usOnly.filter((job) => {
      const postedAt = parsePostedAt(job.postedAt);
      if (!postedAt) return false;
      return postedAt >= cutoffDate;
    });
    const byCompanySize = recentOnly.filter((job) => companySizes.includes(job.companySize));
    const byRole = role ? byCompanySize.filter((job) => strictRoleMatch(job.title, role)) : byCompanySize;
    const byRoleAdjacent = role
      ? byCompanySize.filter((job) => roleAdjacentMatch(job.title, role))
      : byCompanySize;
    const strictRoleRequested = Boolean(roleIntentTokens(role).length);
    const byBand = byRole.filter((job) => {
      const band = seniorityFromTitle(job.title);
      if (candidateBand === "junior") return band === "junior" || band === "middle";
      if (candidateBand === "middle") return band === "middle";
      return true;
    });

    const pool = strictRoleRequested
      ? byBand.length
        ? byBand
        : byRoleAdjacent.length
          ? byRoleAdjacent
          : byRole
      : byBand.length >= 8
        ? byBand
        : byRole.length >= 8
          ? byRole
          : byCompanySize.length >= 8
            ? byCompanySize
            : recentOnly;

    const scored = pool
      .map((job) => {
        const context = buildMatchContext(
          job.title,
          role,
          location,
          job.location,
          candidateBand,
          resumeSkills,
        );
        const score = scoreJobMatch(context, candidateBand);
        return {
          ...job,
          matchScore: score,
          fitReason: buildFitReason(role, location, candidateBand, context),
          fitSignals: [
            context.matchedRoleTokens.length
              ? `Роль: ${context.matchedRoleTokens.join(", ")}`
              : context.matchedRoleConcepts.length
                ? `Семантика роли: ${context.matchedRoleConcepts.join(", ")}`
                : "Роль: слабое совпадение",
            context.resumeSkillsMatched.length
              ? `Навыки из резюме: ${context.resumeSkillsMatched.join(", ")}`
              : "Навыки из резюме: прямых совпадений нет",
            context.locationMatched ? "Локация: совпадает" : "Локация: частичное совпадение",
            context.seniorityMatched
              ? `Уровень: совпадает (${candidateBand})`
              : `Уровень: частичное расхождение (${candidateBand})`,
          ],
          fitRisks: context.penalties,
        };
      })
      .sort((a, b) => b.matchScore - a.matchScore);

    const minScore = role ? 58 : 45;
    const precisionFiltered = scored.filter((job) => job.matchScore >= minScore);
    const sorted = (role ? precisionFiltered : precisionFiltered.length ? precisionFiltered : scored).slice(
      0,
      Math.max(1, Math.min(80, limit)),
    );

    return NextResponse.json({
      source: "US job sites (Greenhouse + Lever)",
      role,
      location,
      candidateBand,
      companySizes,
      daysWindow,
      extractedResumeSkills: resumeSkills,
      totalFetched: fetched.length,
      totalUS: usOnly.length,
      totalRecent: recentOnly.length,
      totalRecentAfterSize: byCompanySize.length,
      totalRoleMatched: byRole.length,
      totalRoleAdjacent: byRoleAdjacent.length,
      totalBandMatched: byBand.length,
      minScoreApplied: minScore,
      totalAfterPrecisionFilter: precisionFiltered.length,
      jobs: sorted,
    });
  } catch (error) {
    return NextResponse.json(
      {
        message: "Не удалось получить реальные вакансии с US job boards.",
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 502 },
    );
  }
}
