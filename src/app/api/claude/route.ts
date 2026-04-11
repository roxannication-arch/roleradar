import { NextRequest, NextResponse } from "next/server";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_MODEL = "claude-sonnet-4-20250514";
const ANTHROPIC_VERSION = "2023-06-01";
const DEFAULT_MAX_TOKENS = 1000;

type ClaudeProxyRequest = {
  messages?: unknown;
  tools?: unknown;
  system?: unknown;
};

export async function POST(request: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { message: "ANTHROPIC_API_KEY не настроен в окружении Vercel." },
      { status: 500 },
    );
  }

  let payload: ClaudeProxyRequest;
  try {
    payload = (await request.json()) as ClaudeProxyRequest;
  } catch {
    return NextResponse.json({ message: "Некорректный JSON в запросе." }, { status: 400 });
  }

  if (!Array.isArray(payload.messages) || payload.messages.length === 0) {
    return NextResponse.json(
      { message: "Поле messages обязательно и должно быть непустым массивом." },
      { status: 400 },
    );
  }

  const upstreamPayload: Record<string, unknown> = {
    model: ANTHROPIC_MODEL,
    max_tokens: DEFAULT_MAX_TOKENS,
    messages: payload.messages,
  };

  if (Array.isArray(payload.tools) && payload.tools.length > 0) {
    upstreamPayload.tools = payload.tools;
  }
  if (typeof payload.system === "string" && payload.system.trim()) {
    upstreamPayload.system = payload.system;
  }

  const upstreamResponse = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
    },
    body: JSON.stringify(upstreamPayload),
    cache: "no-store",
  });

  const responseText = await upstreamResponse.text();
  let responseJson: unknown = null;
  try {
    responseJson = JSON.parse(responseText);
  } catch {
    responseJson = { raw: responseText };
  }

  if (!upstreamResponse.ok) {
    return NextResponse.json(
      {
        message: "Ошибка запроса к Claude API.",
        upstreamStatus: upstreamResponse.status,
        upstream: responseJson,
      },
      { status: upstreamResponse.status },
    );
  }

  return NextResponse.json(responseJson, { status: 200 });
}
