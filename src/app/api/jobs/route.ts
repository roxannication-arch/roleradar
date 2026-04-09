import { NextRequest, NextResponse } from "next/server";

type GreenhouseJob = {
  id: number;
  title: string;
  absolute_url: string;
  location?: { name?: string };
  metadata?: Array<{ name?: string; value?: string }>;
  updated_at?: string;
};

type GreenhouseResponse = {
  jobs?: GreenhouseJob[];
};

type RealJob = {
  id: string;
  title: string;
  company: string;
  location: string;
  source: string;
  applyUrl: string;
  postedAt?: string;
  matchScore: number;
  fitReason: string;
};

const US_GREENHOUSE_BOARDS = [
  "stripe",
  "airbnb",
  "lyft",
  "affirm",
  "coinbase",
  "datadog",
  "reddit",
  "robinhood",
];

const COMPANY_BY_BOARD: Record<string, string> = {
  stripe: "Stripe",
  airbnb: "Airbnb",
  lyft: "Lyft",
  affirm: "Affirm",
  coinbase: "Coinbase",
  datadog: "Datadog",
  reddit: "Reddit",
  robinhood: "Robinhood",
};

function scoreJobMatch(title: string, role: string, location: string, jobLocation: string): number {
  const normalizedTitle = title.toLowerCase();
  const normalizedRole = role.toLowerCase();
  const normalizedLocation = location.toLowerCase();
  const normalizedJobLocation = jobLocation.toLowerCase();

  let score = 55;
  if (normalizedRole && normalizedTitle.includes(normalizedRole)) score += 25;
  else {
    const roleWords = normalizedRole.split(/\s+/).filter(Boolean);
    const overlaps = roleWords.filter((word) => normalizedTitle.includes(word)).length;
    score += Math.min(20, overlaps * 6);
  }

  if (!normalizedLocation) score += 8;
  if (
    normalizedLocation &&
    (normalizedJobLocation.includes(normalizedLocation) ||
      normalizedJobLocation.includes("remote") ||
      normalizedJobLocation.includes("united states") ||
      normalizedJobLocation.includes("us"))
  ) {
    score += 12;
  }

  if (normalizedTitle.includes("senior") || normalizedTitle.includes("lead")) score += 4;

  return Math.max(50, Math.min(97, score));
}

function buildFitReason(title: string, role: string, location: string): string {
  const roleHint = role ? `по роли "${role}"` : "по заданной роли";
  const locationHint = location
    ? `и соответствует фокусу по локации (${location})`
    : "и подходит по географии/remote формату";
  return `Вакансия релевантна ${roleHint} ${locationHint}; тайтл "${title}" совпадает с поисковым профилем.`;
}

function isLikelyUSLocation(raw: string): boolean {
  const location = raw.toLowerCase();
  const usPattern = /\b(u\.s\.|u\.s|usa|united states)\b/;
  const tokens = [
    "united states",
    "remote us",
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
  return usPattern.test(location) || tokens.some((token) => location.includes(token));
}

async function fetchBoardJobs(board: string): Promise<RealJob[]> {
  const url = `https://boards-api.greenhouse.io/v1/boards/${board}/jobs?content=false`;
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
  const company = COMPANY_BY_BOARD[board] ?? board;

  return jobs.map((job) => {
    const location = job.location?.name?.trim() || "United States";
    return {
      id: `${board}-${job.id}`,
      title: job.title,
      company,
      location,
      source: `Greenhouse (${company})`,
      applyUrl: job.absolute_url,
      postedAt: job.updated_at,
      matchScore: 0,
      fitReason: "",
    };
  });
}

export async function GET(request: NextRequest) {
  const role = request.nextUrl.searchParams.get("role")?.trim() || "";
  const location = request.nextUrl.searchParams.get("location")?.trim() || "";
  const limit = Number(request.nextUrl.searchParams.get("limit") || "12");

  try {
    const allSettled = await Promise.allSettled(
      US_GREENHOUSE_BOARDS.map((board) => fetchBoardJobs(board)),
    );

    const fetched = allSettled
      .filter((item): item is PromiseFulfilledResult<RealJob[]> => item.status === "fulfilled")
      .flatMap((item) => item.value);

    const usOnly = fetched.filter((job) => isLikelyUSLocation(job.location));

    const byRole = role
      ? usOnly.filter((job) => {
          const title = job.title.toLowerCase();
          const roleLower = role.toLowerCase();
          if (title.includes(roleLower)) return true;
          return roleLower
            .split(/\s+/)
            .filter(Boolean)
            .some((word) => word.length > 2 && title.includes(word));
        })
      : usOnly;

    const roleMatched = byRole
      .map((job) => {
        const score = scoreJobMatch(job.title, role, location, job.location);
        return {
          ...job,
          matchScore: score,
          fitReason: buildFitReason(job.title, role, location),
        };
      })
      .sort((a, b) => b.matchScore - a.matchScore);

    const fallbackScored = usOnly
      .map((job) => {
        const score = scoreJobMatch(job.title, role, location, job.location) - 6;
        return {
          ...job,
          matchScore: Math.max(50, score),
          fitReason: buildFitReason(job.title, role, location, job.location),
        };
      })
      .sort((a, b) => b.matchScore - a.matchScore);

    const finalJobs = (roleMatched.length ? roleMatched : fallbackScored)
      .slice(0, Math.max(1, Math.min(30, limit)));

    return NextResponse.json({
      source: "US job sites (Greenhouse company boards)",
      role,
      location,
      totalFetched: fetched.length,
      totalUS: usOnly.length,
      totalMatched: byRole.length,
      jobs: finalJobs,
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
