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

type SeniorityBand = "junior" | "middle" | "senior";
type CompanySizeBand = "startup" | "scaleup" | "enterprise" | "all";

type RealJob = {
  id: string;
  title: string;
  company: string;
  location: string;
  source: string;
  applyUrl: string;
  postedAt?: string;
  companySize: Exclude<CompanySizeBand, "all">;
  matchScore: number;
  fitReason: string;
};

type BoardConfig = {
  slug: string;
  company: string;
  size: Exclude<CompanySizeBand, "all">;
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
];

function normalize(value: string): string {
  return value.toLowerCase().trim();
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
  if (
    t.includes("junior") ||
    t.includes("entry") ||
    t.includes("associate") ||
    t.includes("intern")
  ) {
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

  if (
    text.includes("intern") ||
    text.includes("стаж") ||
    text.includes("entry level") ||
    text.includes("junior")
  ) {
    return "junior";
  }
  if (
    text.includes("senior") ||
    text.includes("lead") ||
    text.includes("руковод") ||
    text.includes("staff")
  ) {
    return "senior";
  }
  return "middle";
}

function parseCompanySizes(value: string | null): Exclude<CompanySizeBand, "all">[] {
  if (!value) return ["startup", "scaleup", "enterprise"];
  const allowed: Exclude<CompanySizeBand, "all">[] = ["startup", "scaleup", "enterprise"];
  const parsed = value
    .split(",")
    .map((item) => normalize(item))
    .filter((item): item is Exclude<CompanySizeBand, "all"> =>
      allowed.includes(item as Exclude<CompanySizeBand, "all">),
    );
  return parsed.length ? parsed : ["startup", "scaleup", "enterprise"];
}

function scoreJobMatch(
  title: string,
  role: string,
  location: string,
  jobLocation: string,
  candidateBand: SeniorityBand,
): number {
  const normalizedTitle = normalize(title);
  const normalizedRole = normalize(role);
  const normalizedLocation = normalize(location);
  const normalizedJobLocation = normalize(jobLocation);

  let score = 55;
  if (normalizedRole && normalizedTitle.includes(normalizedRole)) score += 24;
  else {
    const roleWords = normalizedRole.split(/\s+/).filter(Boolean);
    const overlaps = roleWords.filter((word) => normalizedTitle.includes(word)).length;
    score += Math.min(18, overlaps * 6);
  }

  if (!normalizedLocation) score += 8;
  if (
    normalizedLocation &&
    (normalizedJobLocation.includes(normalizedLocation) ||
      normalizedJobLocation.includes("remote") ||
      normalizedJobLocation.includes("united states") ||
      normalizedJobLocation.includes("us"))
  ) {
    score += 10;
  }

  const band = seniorityFromTitle(title);
  if (band === candidateBand) score += 10;
  if (candidateBand === "junior" && band === "middle") score += 2;
  if (candidateBand === "middle" && band === "junior") score += 1;
  if (candidateBand === "middle" && band === "senior") score -= 8;
  if (candidateBand === "junior" && band === "senior") score -= 18;

  return Math.max(40, Math.min(97, score));
}

function buildFitReason(
  title: string,
  role: string,
  location: string,
  candidateBand: SeniorityBand,
): string {
  const roleHint = role ? `по роли "${role}"` : "по заданной роли";
  const locationHint = location ? `локации (${location})` : "географии/remote формату";
  const bandHint =
    candidateBand === "junior"
      ? "junior-профилю"
      : candidateBand === "middle"
        ? "middle-профилю"
        : "senior-профилю";
  return `Роль "${title}" релевантна ${roleHint}, ${locationHint} и соответствует ${bandHint} клиента.`;
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

async function fetchBoardJobs(board: BoardConfig): Promise<RealJob[]> {
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
  const limit = Number(request.nextUrl.searchParams.get("limit") || "12");
  const companySizes = parseCompanySizes(request.nextUrl.searchParams.get("companySizes"));
  const daysWindowRaw = Number(request.nextUrl.searchParams.get("daysWindow") || "7");
  const daysWindow = Math.max(1, Math.min(30, Number.isNaN(daysWindowRaw) ? 7 : daysWindowRaw));
  const cutoffDate = new Date(Date.now() - daysWindow * 24 * 60 * 60 * 1000);
  const experienceYears = parseExperienceYears(request.nextUrl.searchParams.get("experienceYears"));
  const resumeText = request.nextUrl.searchParams.get("resumeText")?.slice(0, 2500) || "";
  const candidateBand = estimateCandidateBand(
    experienceYears,
    resumeText,
    request.nextUrl.searchParams.get("candidateBand") || undefined,
  );

  try {
    const allSettled = await Promise.allSettled(US_GREENHOUSE_BOARDS.map((board) => fetchBoardJobs(board)));

    const fetched = allSettled
      .filter((item): item is PromiseFulfilledResult<RealJob[]> => item.status === "fulfilled")
      .flatMap((item) => item.value);

    const usOnly = fetched.filter((job) => isLikelyUSLocation(job.location));
    const recentOnly = usOnly.filter((job) => {
      const postedAt = parsePostedAt(job.postedAt);
      if (!postedAt) return false;
      return postedAt >= cutoffDate;
    });

    const byCompanySize = recentOnly.filter((job) => companySizes.includes(job.companySize));

    const byRole = role
      ? byCompanySize.filter((job) => {
          const title = normalize(job.title);
          const roleLower = normalize(role);
          if (title.includes(roleLower)) return true;
          return roleLower
            .split(/\s+/)
            .filter(Boolean)
            .some((word) => word.length > 2 && title.includes(word));
        })
      : byCompanySize;

    const byBand = byRole.filter((job) => {
      const band = seniorityFromTitle(job.title);
      if (candidateBand === "junior") return band === "junior" || band === "middle";
      if (candidateBand === "middle") return band === "middle";
      return true;
    });

    const fallbackPool = byBand.length ? byBand : byCompanySize;

    const sorted = fallbackPool
      .map((job) => {
        const score = scoreJobMatch(job.title, role, location, job.location, candidateBand);
        return {
          ...job,
          matchScore: Math.max(40, score),
          fitReason: buildFitReason(job.title, role, location, candidateBand),
        };
      })
      .sort((a, b) => b.matchScore - a.matchScore)
      .slice(0, Math.max(1, Math.min(30, limit)));

    return NextResponse.json({
      source: "US job sites (Greenhouse company boards)",
      role,
      location,
      candidateBand,
      companySizes,
      daysWindow,
      totalFetched: fetched.length,
      totalUS: usOnly.length,
      totalRecent: recentOnly.length,
      totalRecentAfterSize: byCompanySize.length,
      totalRoleMatched: byRole.length,
      totalBandMatched: byBand.length,
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
