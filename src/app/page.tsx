"use client";

import { useMemo, useState } from "react";

type ContactStatus = "Не найден" | "Потенциальный контакт" | "Контакт подтверждён";
type OutreachStatus =
  | "Не начат"
  | "Черновик"
  | "Готов к отправке"
  | "Отправлено"
  | "Нужен follow-up";

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
};

type Client = {
  id: string;
  name: string;
  resume: string;
  targetRole: string;
  location: string;
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

const MOCK_COMPANIES = [
  "Yandex",
  "Tinkoff",
  "Avito",
  "VK",
  "Miro",
  "Ozon",
  "Skyeng",
  "Cian",
  "Sber",
  "Lamoda",
];

const FIT_REASONS = [
  "Сильный опыт в похожем домене и релевантный стек.",
  "Профиль резюме совпадает с ключевыми требованиями роли.",
  "Есть подтверждённый опыт запуска и ведения похожих проектов.",
  "Подходит по уровню seniority и ожидаемому объёму задач.",
  "Навыки коммуникации и лидерства подходят под hiring brief.",
];

function createMockJobs(targetRole: string, location: string): Job[] {
  const cleanRole = targetRole.trim() || "Product Manager";
  const cleanLocation = location.trim() || "Москва";

  return Array.from({ length: 8 }, (_, index) => {
    const company = MOCK_COMPANIES[index % MOCK_COMPANIES.length];
    const score = Math.max(56, 92 - index * 4);
    const contactReady = index < 4;
    const hasContact = index < 6;

    return {
      id: `${company}-${index}`,
      title: `${cleanRole} (${index < 2 ? "Core Team" : "Growth"})`,
      company,
      location: cleanLocation,
      matchScore: score,
      fitReason: FIT_REASONS[index % FIT_REASONS.length],
      contactStatus: hasContact ? "Потенциальный контакт" : "Не найден",
      likelyContact: hasContact
        ? `${index % 2 === 0 ? "Senior Recruiter" : "Hiring Manager"} ${company}`
        : "",
      contactConfidence: hasContact ? 60 + (index % 4) * 10 : 0,
      outreachStatus: contactReady ? "Готов к отправке" : "Черновик",
    };
  });
}

const INITIAL_CLIENTS: Client[] = [
  {
    id: "c1",
    name: "Анна Кузнецова",
    resume:
      "8 лет в продукте: growth, аналитика, запуск B2C фич, кросс-функциональные команды.",
    targetRole: "Senior Product Manager",
    location: "Москва",
    jobs: createMockJobs("Senior Product Manager", "Москва"),
    lastAnalyzedAt: "2026-04-08",
  },
  {
    id: "c2",
    name: "Илья Петров",
    resume:
      "Backend инженер, Python/Go, микросервисы, high-load, DevOps и процессы CI/CD.",
    targetRole: "Senior Backend Engineer",
    location: "Санкт-Петербург",
    jobs: createMockJobs("Senior Backend Engineer", "Санкт-Петербург"),
    lastAnalyzedAt: "2026-04-07",
  },
];

function getScoreTone(score: number): string {
  if (score >= 85) return "bg-emerald-100 text-emerald-800";
  if (score >= 70) return "bg-amber-100 text-amber-800";
  return "bg-zinc-100 text-zinc-700";
}

function todayRu(): string {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date());
}

export default function Home() {
  const [clients, setClients] = useState<Client[]>(INITIAL_CLIENTS);
  const [activeClientId, setActiveClientId] = useState<string>(INITIAL_CLIENTS[0].id);
  const [newClientName, setNewClientName] = useState<string>("");
  const [generatedReport, setGeneratedReport] = useState<string>("");

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
      jobs: [],
    };

    setClients((prev) => [client, ...prev]);
    setActiveClientId(client.id);
    setNewClientName("");
    setGeneratedReport("");
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
    }
  }

  function runAnalysis() {
    if (!activeClient) return;
    const jobs = createMockJobs(activeClient.targetRole, activeClient.location);
    updateActiveClient({
      jobs,
      lastAnalyzedAt: new Date().toISOString().slice(0, 10),
    });
    setGeneratedReport("");
  }

  function generateReport() {
    if (!activeClient) return;

    const topJobs = [...activeClient.jobs]
      .sort((a, b) => b.matchScore - a.matchScore)
      .slice(0, 3);

    const lines = [
      `Еженедельный отчёт по клиенту (${todayRu()})`,
      "",
      `Клиент: ${activeClient.name}`,
      `Целевая роль: ${activeClient.targetRole || "Не указана"}`,
      `Локация: ${activeClient.location || "Не указана"}`,
      "",
      `Итоги по pipeline:`,
      `- Вакансий найдено: ${pipelineSummary.jobsFound}`,
      `- High-fit вакансий (score 80+): ${pipelineSummary.highMatches}`,
      `- Контактов найдено: ${pipelineSummary.contactsFound}`,
      `- Outreach ready: ${pipelineSummary.outreachReady}`,
      "",
      "Топ вакансии:",
      ...(topJobs.length
        ? topJobs.map(
            (job, idx) =>
              `${idx + 1}. ${job.title} — ${job.company} (${job.matchScore}%). Контакт: ${
                job.contactStatus
              }, Outreach: ${job.outreachStatus}.`,
          )
        : ["1. Пока нет данных — запустите анализ клиента."]),
      "",
      "Фокус на следующую неделю:",
      "- Закрыть 2-3 high-fit вакансии прицельным outreach.",
      "- Подтвердить контакты hiring manager/recruiter по приоритетным компаниям.",
      "- Отправить персонализированные сообщения и запланировать follow-up через 3-4 дня.",
    ];

    setGeneratedReport(lines.join("\n"));
  }

  if (!activeClient) {
    return <main className="p-8">Нет активного клиента.</main>;
  }

  return (
    <main className="min-h-screen bg-slate-50 p-6 text-slate-900">
      <div className="mx-auto grid w-full max-w-[1440px] grid-cols-1 gap-6 lg:grid-cols-[300px_1fr]">
        <aside className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h1 className="text-2xl font-semibold">RoleRadar</h1>
          <p className="mt-1 text-sm text-slate-500">
            Операционная система job search для карьерных консультантов
          </p>

          <div className="mt-6">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
              Клиенты
            </h2>
            <div className="mt-3 flex gap-2">
              <input
                value={newClientName}
                onChange={(e) => setNewClientName(e.target.value)}
                placeholder="Имя нового клиента"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none ring-blue-100 focus:ring-2"
              />
              <button
                type="button"
                onClick={addClient}
                className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
              >
                +
              </button>
            </div>
          </div>

          <ul className="mt-4 space-y-2">
            {clients.map((client) => {
              const active = client.id === activeClientId;
              return (
                <li
                  key={client.id}
                  className={`rounded-xl border p-3 ${
                    active
                      ? "border-blue-300 bg-blue-50"
                      : "border-slate-200 bg-white hover:border-slate-300"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => setActiveClientId(client.id)}
                    className="w-full text-left"
                  >
                    <p className="text-sm font-semibold">{client.name}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      {client.targetRole || "Роль не указана"}
                    </p>
                  </button>
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      onClick={() => renameClient(client.id)}
                      className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-100"
                    >
                      Переим.
                    </button>
                    <button
                      type="button"
                      disabled={clients.length === 1}
                      onClick={() => deleteClient(client.id)}
                      className="rounded-md border border-rose-200 px-2 py-1 text-xs text-rose-700 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Удалить
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </aside>

        <section className="space-y-6">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-xl font-semibold">Анализ клиента</h2>
              <button
                type="button"
                onClick={runAnalysis}
                className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
              >
                Запустить анализ
              </button>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
              <div>
                  <label className="mb-1 block text-sm font-medium">Резюме</label>
                <textarea
                  value={activeClient.resume}
                  onChange={(e) => updateActiveClient({ resume: e.target.value })}
                  rows={6}
                  placeholder="Вставьте резюме клиента..."
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none ring-blue-100 focus:ring-2"
                />
              </div>

              <div className="space-y-3">
                <div>
                  <label className="mb-1 block text-sm font-medium">Целевая роль</label>
                  <input
                    value={activeClient.targetRole}
                    onChange={(e) => updateActiveClient({ targetRole: e.target.value })}
                    placeholder="Например, Senior Product Manager"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none ring-blue-100 focus:ring-2"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium">Локация</label>
                  <input
                    value={activeClient.location}
                    onChange={(e) => updateActiveClient({ location: e.target.value })}
                    placeholder="Например, Москва"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none ring-blue-100 focus:ring-2"
                  />
                </div>
                <div className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
                  Последний анализ: {activeClient.lastAnalyzedAt || "ещё не запускался"}
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-6 2xl:grid-cols-[1fr_380px]">
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-xl font-semibold">Движок вакансий</h2>
                <button
                  type="button"
                  onClick={generateReport}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
                >
                  Сгенерировать отчёт
                </button>
              </div>

              {!activeClient.jobs.length ? (
                <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">
                  Пока нет вакансий. Запустите анализ клиента, чтобы собрать результаты.
                </div>
              ) : (
                <div className="space-y-3">
                  {activeClient.jobs.map((job) => (
                    <article key={job.id} className="rounded-xl border border-slate-200 p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <h3 className="text-base font-semibold">{job.title}</h3>
                          <p className="text-sm text-slate-500">
                            {job.company} · {job.location}
                          </p>
                        </div>
                        <span
                          className={`rounded-full px-3 py-1 text-xs font-semibold ${getScoreTone(
                            job.matchScore,
                          )}`}
                        >
                          Match score {job.matchScore}%
                        </span>
                      </div>

                      <p className="mt-3 text-sm text-slate-700">{job.fitReason}</p>

                      <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
                        <div>
                          <label className="mb-1 block text-xs font-medium text-slate-500">
                            Статус контакта
                          </label>
                          <select
                            value={job.contactStatus}
                            onChange={(e) =>
                              updateJob(job.id, {
                                contactStatus: e.target.value as ContactStatus,
                              })
                            }
                            className="w-full rounded-lg border border-slate-300 px-2 py-2 text-sm"
                          >
                            {CONTACT_STATUS_OPTIONS.map((status) => (
                              <option key={status} value={status}>
                                {status}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="mb-1 block text-xs font-medium text-slate-500">
                            Вероятный контакт
                          </label>
                          <input
                            value={job.likelyContact}
                            onChange={(e) =>
                              updateJob(job.id, { likelyContact: e.target.value })
                            }
                            placeholder="Recruiter / Hiring Manager"
                            className="w-full rounded-lg border border-slate-300 px-2 py-2 text-sm"
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-xs font-medium text-slate-500">
                            Уверенность в контакте
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
                            className="w-full rounded-lg border border-slate-300 px-2 py-2 text-sm"
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-xs font-medium text-slate-500">
                            Статус outreach
                          </label>
                          <select
                            value={job.outreachStatus}
                            onChange={(e) =>
                              updateJob(job.id, {
                                outreachStatus: e.target.value as OutreachStatus,
                              })
                            }
                            className="w-full rounded-lg border border-slate-300 px-2 py-2 text-sm"
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
            </div>

            <aside className="space-y-6">
              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <h2 className="text-xl font-semibold">Сводка по пайплайну</h2>
                <div className="mt-4 grid grid-cols-2 gap-3">
                  <div className="rounded-lg bg-slate-50 p-3">
                    <p className="text-xs text-slate-500">Найдено вакансий</p>
                    <p className="text-2xl font-semibold">{pipelineSummary.jobsFound}</p>
                  </div>
                  <div className="rounded-lg bg-slate-50 p-3">
                    <p className="text-xs text-slate-500">High-fit вакансий</p>
                    <p className="text-2xl font-semibold">{pipelineSummary.highMatches}</p>
                  </div>
                  <div className="rounded-lg bg-slate-50 p-3">
                    <p className="text-xs text-slate-500">Найдено контактов</p>
                    <p className="text-2xl font-semibold">{pipelineSummary.contactsFound}</p>
                  </div>
                  <div className="rounded-lg bg-slate-50 p-3">
                    <p className="text-xs text-slate-500">Готово к outreach</p>
                    <p className="text-2xl font-semibold">{pipelineSummary.outreachReady}</p>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <h2 className="text-xl font-semibold">Генератор недельного отчёта</h2>
                {!generatedReport ? (
                  <p className="mt-3 rounded-lg bg-slate-50 p-4 text-sm text-slate-600">
                    Нажмите «Сгенерировать отчёт» в блоке Jobs Engine, чтобы получить краткий
                    операционный отчёт по текущим данным клиента.
                  </p>
                ) : (
                  <pre className="mt-3 whitespace-pre-wrap rounded-lg bg-slate-50 p-4 text-sm leading-relaxed text-slate-700">
                    {generatedReport}
                  </pre>
                )}
              </div>
            </aside>
          </div>
        </section>
      </div>
    </main>
  );
}
