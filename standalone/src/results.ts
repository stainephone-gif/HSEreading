// Результаты: расшифровка отчётов студентов ключом преподавателя, слияние
// отчётов одного студента и проверка ответов.

import { selectionMatches } from "@/lib/answer-rules";
import { thresholdMs } from "@/lib/dwell-rules";
import { fromBase64, openReport, parseReportFile, ReportError } from "@/lib/kiosk-crypto";
import { type AnswerValue, normalizeStudent } from "@/lib/kiosk-engine";
import type { Sentence } from "@/lib/pdf-service";
import { taskPoints } from "@/lib/scoring";
import { pageId, type Project, type ProjectTask, scatterCandidates } from "./project";

export type Report = {
  instanceId: string;
  student: { name: string; email: string };
  firstOpenedAt: number;
  savedAt: number;
  activeMs: number;
  dwell: Record<string, number>;
  readAt: Record<string, number>;
  placements: Record<string, string>;
  answers: Record<string, { value: AnswerValue; at: number }>;
};

export type LoadedReport = { file: string; report: Report } | { file: string; error: string };

const isNum = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);

function numbers(x: unknown): Record<string, number> | null {
  if (!isRecord(x)) return null;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(x)) {
    if (!isNum(v) || v < 0) return null;
    out[k] = v;
  }
  return out;
}

function asReport(json: unknown, exportId: string): Report | null {
  if (!isRecord(json) || json.exportId !== exportId || !isRecord(json.student)) return null;
  const student = normalizeStudent({ name: String(json.student.name ?? ""), email: String(json.student.email ?? "") });
  const dwell = numbers(json.dwell);
  const readAt = numbers(json.readAt);
  if (typeof student === "string" || !dwell || !readAt) return null;
  if (!isNum(json.firstOpenedAt) || !isNum(json.savedAt) || !isNum(json.activeMs) || json.activeMs < 0) return null;
  if (!isRecord(json.placements) || !isRecord(json.answers)) return null;
  const placements: Record<string, string> = {};
  for (const [k, v] of Object.entries(json.placements)) if (typeof v === "string") placements[k] = v;
  const answers: Report["answers"] = {};
  for (const [k, v] of Object.entries(json.answers)) {
    if (isRecord(v) && isNum(v.at) && isRecord(v.value)) answers[k] = { value: v.value as AnswerValue, at: v.at };
  }
  return {
    instanceId: String(json.instanceId ?? ""),
    student,
    firstOpenedAt: json.firstOpenedAt,
    savedAt: json.savedAt,
    activeMs: json.activeMs,
    dwell,
    readAt,
    placements,
    answers,
  };
}

export function openReportFile(project: Project, file: string, content: string): LoadedReport {
  const parsed = parseReportFile(content);
  if (!parsed) return { file, error: "Это не отчёт читалки." };
  if (parsed.exportId !== project.exportId) return { file, error: "Отчёт от другой читалки: нужен другой ключ." };
  try {
    const raw = openReport(parsed.sealed, fromBase64(project.keys.secretKey), fromBase64(project.keys.mac));
    const report = asReport(JSON.parse(raw), project.exportId);
    return report ? { file, report } : { file, error: "Файл повреждён." };
  } catch (err) {
    if (err instanceof ReportError) return { file, error: err.message };
    return { file, error: "Файл повреждён." };
  }
}

// Отчёты одного студента (с разных устройств или сохранённые в разное время)
// сливаются: время страницы — максимум, ответ — последний по времени.
export function mergeReports(reports: Report[]): Map<string, { merged: Report; count: number; instances: number }> {
  const byEmail = new Map<string, Report[]>();
  for (const r of reports) byEmail.set(r.student.email, [...(byEmail.get(r.student.email) ?? []), r]);
  const out = new Map<string, { merged: Report; count: number; instances: number }>();
  for (const [email, list] of byEmail) {
    const sorted = [...list].sort((a, b) => a.savedAt - b.savedAt);
    const latest = sorted[sorted.length - 1];
    const merged: Report = {
      instanceId: latest.instanceId,
      student: latest.student,
      firstOpenedAt: Math.min(...sorted.map((r) => r.firstOpenedAt)),
      savedAt: latest.savedAt,
      activeMs: Math.max(...sorted.map((r) => r.activeMs)),
      dwell: {},
      readAt: {},
      placements: {},
      answers: {},
    };
    for (const r of sorted) {
      for (const [id, ms] of Object.entries(r.dwell)) merged.dwell[id] = Math.max(merged.dwell[id] ?? 0, ms);
      for (const [id, at] of Object.entries(r.readAt)) merged.readAt[id] = Math.min(merged.readAt[id] ?? at, at);
      for (const [id, page] of Object.entries(r.placements)) merged.placements[id] ??= page;
      for (const [id, a] of Object.entries(r.answers)) {
        if (!merged.answers[id] || a.at >= merged.answers[id].at) merged.answers[id] = a;
      }
    }
    out.set(email, { merged, count: list.length, instances: new Set(list.map((r) => r.instanceId)).size });
  }
  return out;
}

export type CellState = "hidden" | "found" | "late" | "pending" | "pass" | "fail";
export type Grades = Record<string, "PASS" | "FAIL">;

export type Cell = { state: CellState; answer: string | null; gradeKey: string | null };

export type ResultRow = {
  email: string;
  name: string;
  reports: number;
  instances: number;
  firstOpenedAt: number;
  savedAt: number;
  minutes: number;
  readPages: number;
  found: number;
  cells: Cell[];
  passed: number;
  points: number;
};

// Оценка короткого ответа привязана к его тексту: изменённый ответ проверяется заново.
export function gradeKey(email: string, taskId: string, text: string): string {
  let h = 0;
  for (const c of text) h = (Math.imul(h, 31) + c.codePointAt(0)!) | 0;
  return `${email}|${taskId}|${(h >>> 0).toString(36)}`;
}

function answerCell(task: ProjectTask, email: string, value: AnswerValue, grades: Grades): Cell {
  const v = value as { choice?: unknown; range?: unknown; text?: unknown };
  if (task.format === "CHOICE") {
    const option = typeof v.choice === "number" ? task.options?.[v.choice] : undefined;
    if (!option) return { state: "found", answer: null, gradeKey: null };
    return { state: option.correct ? "pass" : "fail", answer: option.text, gradeKey: null };
  }
  if (task.format === "SELECTION") {
    const r = v.range;
    if (!Array.isArray(r) || r.length !== 2 || !r.every(isNum) || !task.answerRange) {
      return { state: "found", answer: null, gradeKey: null };
    }
    const range = r as Sentence;
    return {
      state: selectionMatches(range, task.answerRange) ? "pass" : "fail",
      answer: task.pageContent?.slice(range[0], range[1]) ?? null,
      gradeKey: null,
    };
  }
  const text = typeof v.text === "string" ? v.text : "";
  if (!text) return { state: "found", answer: null, gradeKey: null };
  const key = gradeKey(email, task.id, text);
  const grade = grades[key];
  return { state: grade === "PASS" ? "pass" : grade === "FAIL" ? "fail" : "pending", answer: text, gradeKey: key };
}

export function buildResults(project: Project, reports: Report[], grades: Grades): ResultRow[] {
  const deadline = project.deadline ? Date.parse(project.deadline) : null;
  const rows: ResultRow[] = [];
  for (const [email, { merged, count, instances }] of mergeReports(reports)) {
    // Время страницы не больше общего времени в читалке.
    const read = new Set<string>();
    project.pages.forEach((p, i) => {
      const id = pageId(i);
      const ms = Math.min(merged.dwell[id] ?? 0, merged.activeMs);
      if (ms >= thresholdMs(p.words, project.wordsPerMinute)) read.add(id);
    });
    const cells = project.tasks.map((t): Cell => {
      const placed = merged.placements[t.id];
      const page = t.page !== null ? pageId(t.page) : scatterCandidates(project, t).includes(placed) ? placed : null;
      if (!page || !read.has(page)) return { state: "hidden", answer: null, gradeKey: null };
      const answer = merged.answers[t.id];
      if (!answer) return { state: "found", answer: null, gradeKey: null };
      const cell = answerCell(t, email, answer.value, grades);
      return deadline !== null && answer.at > deadline && cell.answer !== null ? { ...cell, state: "late" } : cell;
    });
    const passed = cells.filter((c) => c.state === "pass").length;
    rows.push({
      email,
      name: merged.student.name,
      reports: count,
      instances,
      firstOpenedAt: merged.firstOpenedAt,
      savedAt: merged.savedAt,
      minutes: Math.round(merged.activeMs / 60_000),
      readPages: read.size,
      found: cells.filter((c) => c.state !== "hidden").length,
      cells,
      passed,
      points: taskPoints(passed, project.tasks.length),
    });
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name, "ru"));
}

const CELL_CSV: Record<CellState, string> = {
  pass: "засчитано",
  fail: "не засчитано",
  pending: "ждёт проверки",
  late: "после дедлайна",
  found: "найдено, нет ответа",
  hidden: "не найдено",
};

function csvField(value: string | number): string {
  const s = String(value);
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// CSV для Excel: точка с запятой и BOM, чтобы кириллица открывалась без настройки.
export function resultsToCsv(project: Project, rows: ResultRow[]): string {
  const header = [
    "Студент",
    "Почта",
    "Дочитано страниц",
    "Минут в читалке",
    "Найдено заданий",
    ...project.tasks.flatMap((_, i) => [`Задание ${i + 1}`, `Ответ ${i + 1}`]),
    "Баллы за задания",
  ];
  const lines = rows.map((r) => [
    r.name,
    r.email,
    `${r.readPages}/${project.pages.length}`,
    r.minutes,
    `${r.found}/${project.tasks.length}`,
    ...r.cells.flatMap((c) => [CELL_CSV[c.state], c.answer ?? ""]),
    r.points.toString().replace(".", ","),
  ]);
  return "﻿" + [header, ...lines].map((l) => l.map(csvField).join(";")).join("\r\n") + "\r\n";
}
