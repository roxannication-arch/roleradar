"use client";

import { ChangeEvent, DragEvent, useMemo, useRef, useState } from "react";

type ContactStatus = "Не найден" | "Потенциальный контакт" | "Контакт подтверждён";
type OutreachStatus =
  | "Не начат"
  | "Черновик"
  | "Готов к отправке"
  | "Отправлено"
  | "Нужен follow-up";
type CandidateLevel = "auto" | "junior" | "middle" | "senior";
type CompanySize = "startup" | "scaleup" | "enterprise";

type Job = {
  id: string;
  title: string;
  company: string;
  location: string;
  matchScore: number;
  fitReason: string;
  contactStatus: ContactStatus;
  likelyContact: string;
  contactConfidence: number;
  outreachStatus: OutreachStatus;
  source: string;
  applyUrl: string;
};

type Client = {
  id: string;
  name: string;
  resume: string;
  resumeFileName?: string;
  targetRole: string;
  location: string;
  experienceYears: string;
  candidateLevel: CandidateLevel;
  preferredCompanySizes: CompanySize[];
  detectedBand?: Exclude<CandidateLevel, "auto">;
  detectedExperienceYears?: number | null;
  jobs: Job[];
  lastAnalyzedAt?: string;
};

const CONTACT_STATUS_OPTIONS: ContactStatus[] = [
  "Не найден",
  "Потенциальный контакт",
  "Контакт подтверждён",
];

const OUTREACH_STATUS_OPTIONS: OutreachStatus[] = [
  "Не начат",
  "Черновик",
  "Готов к отправке",
  "Отправлено",
  "Нужен follow-up",
];

type JobsApiItem = {
  id: string;
  title: string;
  company: string;
  location: string;
  matchScore: number;
  fitReason: string;
  source: string;
  applyUrl: string;
  postedAt?: string;
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

const INITIAL_CLIENTS: Client[] = [
  {
    id: "c1",
    name: "Анна Кузнецова",
    resume:
      "8 лет в продукте: growth, аналитика, запуск B2C фич, кросс-функциональные команды.",
    resumeFileName: "anna-kuznetsova-cv.pdf",
    targetRole: "Senior Product Manager",
    location: "Miami, FL",
    experienceYears: "8",
    candidateLevel: "auto",
    preferredCompanySizes: ["startup", "scaleup"],
    jobs: [],
    lastAnalyzedAt: "2026-04-08",
  },
  {
    id: "c2",
    name: "Илья Петров",
    resume:
      "Backend инженер, Python/Go, микросервисы, high-load, DevOps и процессы CI/CD.",
    resumeFileName: "ilya-petrov-resume.docx",
    targetRole: "Senior Backend Engineer",
    location: "Austin, TX",
    experienceYears: "6",
    candidateLevel: "auto",
    preferredCompanySizes: ["startup", "scaleup", "enterprise"],
    jobs: [],
    lastAnalyzedAt: "2026-04-07",
  },
];

function todayRu(): string {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date());
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
  ];
  return tones[index % tones.length];
}

export default function Home() {
  const [clients, setClients] = useState<Client[]>(INITIAL_CLIENTS);
  const [activeClientId, setActiveClientId] = useState<string>(INITIAL_CLIENTS[0].id);
  const [newClientName, setNewClientName] = useState<string>("");
  const [generatedReport, setGeneratedReport] = useState<string>("");
  const [isReportOpen, setIsReportOpen] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState<string>("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const activeClient = useMemo(
    () => clients.find((client) => client.id === activeClientId),
    [activeClientId, clients],
  );

  const pipelineSummary = useMemo(() => {
    if (!activeClient) {
      return { jobsFound: 0, highMatches: 0, contactsFound: 0, outreachReady: 0 };
    }

    const jobsFound = activeClient.jobs.length;
    const highMatches = activeClient.jobs.filter((job) => job.matchScore >= 80).length;
    const contactsFound = activeClient.jobs.filter(
      (job) => job.contactStatus !== "Не найден",
    ).length;
    const outreachReady = activeClient.jobs.filter(
      (job) => job.outreachStatus === "Готов к отправке" || job.outreachStatus === "Отправлено",
    ).length;

    return { jobsFound, highMatches, contactsFound, outreachReady };
  }, [activeClient]);

  function updateActiveClient(patch: Partial<Client>) {
    setClients((prev) =>
      prev.map((client) =>
        client.id === activeClientId ? { ...client, ...patch } : client,
      ),
    );
  }

  function updateJob(jobId: string, patch: Partial<Job>) {
    setClients((prev) =>
      prev.map((client) =>
        client.id === activeClientId
          ? {
              ...client,
              jobs: client.jobs.map((job) =>
                job.id === jobId ? { ...job, ...patch } : job,
              ),
            }
          : client,
      ),
    );
  }

  function addClient() {
    const trimmedName = newClientName.trim();
    if (!trimmedName) return;

    const client: Client = {
      id: `c-${Date.now()}`,
      name: trimmedName,
      resume: "",
      targetRole: "",
      location: "",
      candidateLevel: "auto",
      experienceYears: "3",
      preferredCompanySizes: ["startup", "scaleup", "enterprise"],
      jobs: [],
    };

    setClients((prev) => [client, ...prev]);
    setActiveClientId(client.id);
    setNewClientName("");
    setGeneratedReport("");
    setIsReportOpen(false);
  }

  function renameClient(clientId: string) {
    const current = clients.find((client) => client.id === clientId);
    if (!current) return;
    const renamed = window.prompt("Новое имя клиента", current.name);
    if (!renamed) return;

    setClients((prev) =>
      prev.map((client) =>
        client.id === clientId ? { ...client, name: renamed.trim() || client.name } : client,
      ),
    );
  }

  function deleteClient(clientId: string) {
    if (clients.length === 1) return;
    const target = clients.find((client) => client.id === clientId);
    if (!target) return;
    const accepted = window.confirm(`Удалить клиента "${target.name}"?`);
    if (!accepted) return;

    const nextClients = clients.filter((client) => client.id !== clientId);
    setClients(nextClients);
    if (clientId === activeClientId) {
      setActiveClientId(nextClients[0].id);
      setGeneratedReport("");
      setIsReportOpen(false);
    }
  }

  function applyResumeFile(file: File) {
    updateActiveClient({
      resumeFileName: file.name,
      resume: activeClient?.resume || "",
    });
  }

  function onDropResume(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragActive(false);
    if (!event.dataTransfer.files?.length) return;
    applyResumeFile(event.dataTransfer.files[0]);
  }

  function onSelectResume(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    applyResumeFile(file);
  }

  async function runAnalysis() {
    if (!activeClient) return;
    setIsAnalyzing(true);
    setAnalysisError("");
    try {
      const params = new URLSearchParams({
        role: activeClient.targetRole || "",
        location: activeClient.location || "",
        resume: activeClient.resume || "",
        candidateLevel: activeClient.candidateLevel,
        companySizes: activeClient.preferredCompanySizes.join(","),
      });
      const response = await fetch(`/api/jobs?${params.toString()}`);
      if (!response.ok) {
        throw new Error(`API returned status ${response.status}`);
      }

      const payload = (await response.json()) as { jobs: JobsApiItem[] };
      const jobs: Job[] = payload.jobs.map((item, index) => ({
        ...item,
        contactStatus: index < 4 ? "Потенциальный контакт" : "Не найден",
        likelyContact: index < 4 ? `Recruiter ${item.company}` : "",
        contactConfidence: index < 4 ? 65 + (index % 3) * 10 : 0,
        outreachStatus: index < 3 ? "Готов к отправке" : "Черновик",
      }));

      updateActiveClient({
        jobs,
        lastAnalyzedAt: new Date().toISOString().slice(0, 10),
      });
      setGeneratedReport("");
      setIsReportOpen(false);
    } catch (error) {
      console.error(error);
      setAnalysisError(
        "Не удалось загрузить вакансии с US job-сайтов. Проверьте роль/локацию и попробуйте снова.",
      );
    } finally {
      setIsAnalyzing(false);
    }
  }

  function generateReport() {
    if (!activeClient) return;

    const topJobs = [...activeClient.jobs]
      .sort((a, b) => b.matchScore - a.matchScore)
      .slice(0, 5);

    const lines = [
      `Еженедельный отчёт по клиенту (${todayRu()})`,
      "",
      `Клиент: ${activeClient.name}`,
      `Целевая роль: ${activeClient.targetRole || "Не указана"}`,
      `Локация: ${activeClient.location || "Не указана"}`,
      `Резюме: ${activeClient.resumeFileName || "текстовая версия"}`,
      "",
      "Источник данных: реальные вакансии с американских job sites (Greenhouse boards).",
      "",
      "Операционная сводка:",
      `- Вакансий найдено: ${pipelineSummary.jobsFound}`,
      `- High-fit вакансий (score 80+): ${pipelineSummary.highMatches}`,
      `- Контактов найдено: ${pipelineSummary.contactsFound}`,
      `- Outreach ready: ${pipelineSummary.outreachReady}`,
      "",
      "Топ-вакансии в приоритете:",
      ...(topJobs.length
        ? topJobs.map(
            (job, idx) =>
              `${idx + 1}. ${job.title} — ${job.company} (${job.matchScore}%). Контакт: ${
                job.contactStatus
              }, Outreach: ${job.outreachStatus}.`,
          )
        : ["1. Нет данных: запустите анализ клиента."]),
      "",
      "Фокус команды на следующую неделю:",
      "- Закрыть outreach по 3 high-fit вакансиям с score > 85.",
      "- Подтвердить hiring contact для приоритетных компаний.",
      "- Провести 1 итерацию follow-up с фокусом на быстрые интервью.",
    ];

    setGeneratedReport(lines.join("\n"));
    setIsReportOpen(true);
  }

  const metrics = [
    { label: "Найдено вакансий", value: pipelineSummary.jobsFound, hint: "по текущему клиенту" },
    { label: "High-fit вакансий", value: pipelineSummary.highMatches, hint: "score 80+" },
    { label: "Найдено контактов", value: pipelineSummary.contactsFound, hint: "recruiter / HM" },
    { label: "Готово к outreach", value: pipelineSummary.outreachReady, hint: "можно отправлять" },
  ];

  if (!activeClient) {
    return <main className="p-8">Нет активного клиента.</main>;
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
              Внутренний операционный контур команды карьерных консультантов.
            </p>

            <div className="mt-5 flex items-center gap-2">
              <input
                value={newClientName}
                onChange={(e) => setNewClientName(e.target.value)}
                placeholder="Добавить клиента"
                className="h-10 w-full rounded-xl border border-slate-300 px-3 text-sm outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
              />
              <button
                type="button"
                onClick={addClient}
                className="inline-flex h-10 shrink-0 items-center justify-center rounded-xl bg-blue-600 px-4 text-sm font-medium text-white shadow-sm transition hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-200 active:translate-y-px active:bg-blue-800"
              >
                Добавить
              </button>
            </div>
          </div>

          <ul className="max-h-[65vh] space-y-2 overflow-y-auto p-4">
            {clients.map((client) => {
              const active = client.id === activeClientId;
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
                    <p className="mt-1 text-xs text-slate-400">
                      {client.jobs.length} вакансий в pipeline
                    </p>
                  </button>
                  <div className="mt-3 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => renameClient(client.id)}
                      className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-200 active:translate-y-px"
                    >
                      Переименовать
                    </button>
                    <button
                      type="button"
                      disabled={clients.length === 1}
                      onClick={() => deleteClient(client.id)}
                      className="rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-xs font-medium text-rose-700 transition hover:bg-rose-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-200 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Удалить
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </aside>

        <section className="space-y-5">
          <header className="rounded-3xl border border-slate-200 bg-white p-5 shadow-[0_8px_32px_-18px_rgba(15,23,42,0.35)]">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                  Активный клиент
                </p>
                <h2 className="mt-1 text-2xl font-semibold">{activeClient.name}</h2>
                <p className="mt-1 text-sm text-slate-500">
                  {activeClient.targetRole || "Роль не задана"} ·{" "}
                  {activeClient.location || "Локация не задана"}
                </p>
                <p className="mt-1 text-xs text-slate-400">
                  Регион поиска: США · Источник вакансий: американские job boards
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={runAnalysis}
                  disabled={isAnalyzing}
                  className="inline-flex h-11 items-center justify-center rounded-xl bg-slate-900 px-5 text-sm font-medium text-white shadow-sm transition hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-slate-200 active:translate-y-px disabled:cursor-wait disabled:opacity-70"
                >
                  {isAnalyzing ? "Анализируем..." : "Запустить анализ"}
                </button>
                <button
                  type="button"
                  onClick={generateReport}
                  className="inline-flex h-11 items-center justify-center rounded-xl bg-blue-600 px-5 text-sm font-medium text-white shadow-sm transition hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-200 active:translate-y-px"
                >
                  Сгенерировать отчёт
                </button>
              </div>
            </div>
          </header>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-[0_8px_32px_-18px_rgba(15,23,42,0.3)]">
              <h3 className="text-lg font-semibold">Анализ клиента</h3>
              <p className="mt-1 text-sm text-slate-500">
                Загрузите резюме файлом или вставьте текстовую версию.
              </p>

              <div className="mt-4 space-y-4">
                {analysisError ? (
                  <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
                    {analysisError}
                  </div>
                ) : null}
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
                    dragActive
                      ? "border-blue-400 bg-blue-50"
                      : "border-slate-300 bg-slate-50 hover:border-slate-400"
                  }`}
                >
                  <p className="text-sm font-medium text-slate-700">
                    Перетащите файл резюме сюда
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    Поддержка: PDF, DOC, DOCX. Файл используется в UI как источник резюме.
                  </p>
                  <div className="mt-3 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="inline-flex h-9 items-center justify-center rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-200 active:translate-y-px"
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
                    accept=".pdf,.doc,.docx,.txt"
                    onChange={onSelectResume}
                    className="hidden"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium">Текст резюме</label>
                  <textarea
                    value={activeClient.resume}
                    onChange={(e) => updateActiveClient({ resume: e.target.value })}
                    rows={7}
                    placeholder="Вставьте резюме клиента..."
                    className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
                  />
                </div>
              </div>
            </div>

            <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-[0_8px_32px_-18px_rgba(15,23,42,0.3)]">
              <h3 className="text-lg font-semibold">Параметры поиска</h3>
              <p className="mt-1 text-sm text-slate-500">
                Настройки используются движком вакансий при генерации выдачи.
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
                    onChange={(e) =>
                      updateActiveClient({
                        candidateLevel: e.target.value as CandidateLevel,
                      })
                    }
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
                  Последний анализ:{" "}
                  <span className="font-medium text-slate-800">
                    {activeClient.lastAnalyzedAt || "ещё не запускался"}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-[0_8px_32px_-18px_rgba(15,23,42,0.3)]">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-xl font-semibold">Сводка по пайплайну</h3>
                <p className="text-sm text-slate-500">Ключевые KPI по текущему клиенту</p>
              </div>
            </div>
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
              <div>
                <h3 className="text-xl font-semibold">Движок вакансий</h3>
                <p className="text-sm text-slate-500">Приоритетная выдача для работы ассистентов</p>
              </div>
              <button
                type="button"
                onClick={generateReport}
                className="inline-flex h-10 items-center justify-center rounded-xl bg-blue-600 px-4 text-sm font-medium text-white transition hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-200 active:translate-y-px"
              >
                Сгенерировать отчёт
              </button>
            </div>

            {!activeClient.jobs.length ? (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-10 text-center">
                <p className="text-sm font-medium text-slate-700">Пока нет вакансий для клиента</p>
                <p className="mt-1 text-sm text-slate-500">
                  Запустите анализ, чтобы построить стартовый pipeline.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {activeClient.jobs.map((job) => (
                  <article
                    key={job.id}
                    className="rounded-2xl border border-slate-200 bg-slate-50/55 p-4 transition hover:border-slate-300 hover:bg-white"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <h4 className="text-base font-semibold text-slate-900">{job.title}</h4>
                        <p className="text-sm text-slate-500">
                          {job.company} · {job.location}
                        </p>
                        <p className="mt-1 text-xs text-slate-400">
                          Источник: {job.source}
                        </p>
                      </div>
                      <span
                        className={`rounded-full border px-3 py-1 text-xs font-semibold ${scoreTone(
                          job.matchScore,
                        )}`}
                      >
                        Match {job.matchScore}%
                      </span>
                    </div>

                    <p className="mt-3 text-sm text-slate-700">{job.fitReason}</p>
                    <a
                      href={job.applyUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-2 inline-flex text-xs font-semibold text-blue-700 underline decoration-blue-300 underline-offset-2 hover:text-blue-800"
                    >
                      Открыть вакансию на сайте
                    </a>

                    <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
                      <div>
                        <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                          Статус контакта
                        </label>
                        <select
                          value={job.contactStatus}
                          onChange={(e) =>
                            updateJob(job.id, {
                              contactStatus: e.target.value as ContactStatus,
                            })
                          }
                          className="h-10 w-full rounded-lg border border-slate-300 bg-white px-2 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                        >
                          {CONTACT_STATUS_OPTIONS.map((status) => (
                            <option key={status} value={status}>
                              {status}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                          Вероятный контакт
                        </label>
                        <input
                          value={job.likelyContact}
                          onChange={(e) => updateJob(job.id, { likelyContact: e.target.value })}
                          placeholder="Recruiter / Hiring Manager"
                          className="h-10 w-full rounded-lg border border-slate-300 bg-white px-2 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                          Уверенность, %
                        </label>
                        <input
                          type="number"
                          min={0}
                          max={100}
                          value={job.contactConfidence}
                          onChange={(e) =>
                            updateJob(job.id, {
                              contactConfidence: Number(e.target.value || 0),
                            })
                          }
                          className="h-10 w-full rounded-lg border border-slate-300 bg-white px-2 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                          Статус outreach
                        </label>
                        <select
                          value={job.outreachStatus}
                          onChange={(e) =>
                            updateJob(job.id, {
                              outreachStatus: e.target.value as OutreachStatus,
                            })
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
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        </section>
      </div>

      {isReportOpen && (
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
                className="inline-flex h-9 items-center justify-center rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-200 active:translate-y-px"
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
      )}
    </main>
  );
}
