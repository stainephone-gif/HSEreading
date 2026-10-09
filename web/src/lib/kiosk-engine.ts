// Офлайн-читалка (киоск): учёт дочитывания и ответы без сервера. Чистые
// функции над состоянием, которое киоск хранит в браузере и отправляет
// преподавателю в отчёте. Верных ответов в киоске нет: ответы проверяет сервер
// при загрузке отчёта.

import nacl from "tweetnacl";
import { shortAnswerError } from "./answer-rules";
import { creditAllowance, creditFor } from "./dwell-rules";
import type { FragmentLine, Sentence } from "./pdf-service";
import type { ReaderBlock, ReaderFragment, StudentTask, StudentTasks } from "./reader-types";

export const KIOSK_VERSION = 1;

export type KioskTask = {
  id: string;
  format: "CHOICE" | "SELECTION" | "SHORT";
  prompt: string;
  // CHOICE: тексты вариантов, без отметки верного.
  options: string[] | null;
  // Привязанное задание: абзац. Раскиданное: абзацы, из которых выбирается свой.
  fragmentId: string | null;
  candidates: string[] | null;
};

// Всё, что киоск знает о тексте. Лежит в HTML-файле открыто.
export type KioskData = {
  v: number;
  exportId: string;
  textId: string;
  title: string;
  displayMode: "PDF" | "WEB";
  language: string;
  blocks: ReaderBlock[];
  pages: { width: number; height: number }[];
  fragments: ReaderFragment[];
  // В порядке создания: так же, как сервер раскидывает задания.
  tasks: KioskTask[];
  // Абзацы заданий на выбор предложения: текст, строки и предложения.
  selections: Record<string, { content: string; lines: FragmentLine[]; sentences: Sentence[] }>;
  deadline: string | null;
  deadlineLabel: string | null;
  publicKey: string;
  keys: string;
  exportedAt: string;
};

export type AnswerValue = { choice: number } | { range: Sentence } | { text: string };

export type KioskStudent = { name: string; email: string };

export type KioskState = {
  v: number;
  exportId: string;
  // Копия киоска: у каждого браузера своя. По ней видно, что отчёты пришли с разных устройств.
  instanceId: string;
  student: KioskStudent;
  firstOpenedAt: number;
  savedAt: number;
  activeMs: number;
  dwell: Record<string, number>;
  readAt: Record<string, number>;
  placements: Record<string, string>;
  answers: Record<string, { value: AnswerValue; at: number }>;
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeStudent(raw: { name: string; email: string }): KioskStudent | string {
  const name = raw.name.trim().replace(/\s+/g, " ").slice(0, 120);
  const email = raw.email.trim().toLowerCase();
  if (!name) return "Введите фамилию и имя.";
  if (!EMAIL.test(email) || email.length > 200) return "Введите адрес почты, например ivanov@edu.hse.ru.";
  return { name, email };
}

function seededIndex(seed: string, length: number): number {
  const h = nacl.hash(new TextEncoder().encode(seed));
  return (((h[0] << 24) | (h[1] << 16) | (h[2] << 8) | h[3]) >>> 0) % length;
}

// Раскиданные задания закрепляются за абзацами. Выбор зависит от почты
// студента, а не от случая: в двух копиях киоска у него одни и те же места.
// Как и на сервере, два задания стараются не попасть в один абзац.
export function placeTasks(data: KioskData, email: string): Record<string, string> {
  const used = new Set(data.tasks.flatMap((t) => (t.fragmentId ? [t.fragmentId] : [])));
  const placements: Record<string, string> = {};
  for (const t of data.tasks) {
    if (!t.candidates?.length) continue;
    const free = t.candidates.filter((id) => !used.has(id));
    const pool = free.length ? free : t.candidates;
    const fragmentId = pool[seededIndex(`${email}:${t.id}`, pool.length)];
    used.add(fragmentId);
    placements[t.id] = fragmentId;
  }
  return placements;
}

// Задания, добавленные после того, как студент начал читать (преподаватель
// разослал новый файл): места для них выбираются так же, по почте.
export function fillPlacements(state: KioskState, data: KioskData): void {
  const placements = placeTasks(data, state.student.email);
  for (const [taskId, fragmentId] of Object.entries(placements)) state.placements[taskId] ??= fragmentId;
}

export function newState(data: KioskData, student: KioskStudent, now: number): KioskState {
  const id = nacl.randomBytes(12);
  return {
    v: KIOSK_VERSION,
    exportId: data.exportId,
    instanceId: Array.from(id, (b) => b.toString(16).padStart(2, "0")).join(""),
    student,
    firstOpenedAt: now,
    savedAt: now,
    activeMs: 0,
    dwell: {},
    readAt: {},
    placements: placeTasks(data, student.email),
    answers: {},
  };
}

// Отчёт читалки: claims — сколько миллисекунд абзацы были в зоне чтения,
// elapsedMs — сколько прошло с прошлого отчёта по монотонным часам страницы.
// Засчитывается не больше прошедшего времени, как на сервере.
export function applyBeat(
  state: KioskState,
  data: KioskData,
  claims: Record<string, number>,
  elapsedMs: number,
  now: number,
): void {
  const allowance = creditAllowance(elapsedMs);
  const thresholds = new Map(data.fragments.map((f) => [f.id, f.thresholdMs]));
  let active = 0;
  for (const [id, claim] of Object.entries(claims)) {
    const threshold = thresholds.get(id);
    if (threshold === undefined) continue;
    const credit = creditFor(claim, allowance);
    if (credit === 0) continue;
    active = Math.max(active, credit);
    state.dwell[id] = (state.dwell[id] ?? 0) + credit;
    if (!state.readAt[id] && state.dwell[id] >= threshold) state.readAt[id] = now;
  }
  state.activeMs += active;
  state.savedAt = now;
}

export function readIds(state: KioskState): string[] {
  return Object.keys(state.readAt);
}

export function deadlinePassed(data: KioskData, now: number): boolean {
  return Boolean(data.deadline && Date.parse(data.deadline) <= now);
}

function taskFragment(state: KioskState, t: KioskTask): string | null {
  return t.fragmentId ?? state.placements[t.id] ?? null;
}

// Найденные задания в том виде, в каком их показывает читалка. Оценок в
// киоске нет: их видно после загрузки отчёта преподавателем.
export function studentTasks(state: KioskState, data: KioskData, now: number): StudentTasks {
  const order = new Map(data.fragments.map((f, i) => [f.id, i]));
  const found = data.tasks
    .map((t) => ({ t, fragmentId: taskFragment(state, t) }))
    .filter((x): x is { t: KioskTask; fragmentId: string } => Boolean(x.fragmentId && state.readAt[x.fragmentId]))
    .sort((a, b) => (order.get(a.fragmentId) ?? 0) - (order.get(b.fragmentId) ?? 0))
    .map(({ t, fragmentId }): StudentTask => {
      const answer = state.answers[t.id]?.value;
      return {
        id: t.id,
        fragmentId,
        format: t.format,
        prompt: t.prompt,
        options: t.options,
        selection: t.format === "SELECTION" ? (data.selections[fragmentId] ?? null) : null,
        answer: answer ? { ...answer } : null,
        grade: null,
      };
    });
  return {
    total: data.tasks.length,
    found,
    deadline: data.deadline ? new Date(data.deadline) : null,
    closed: deadlinePassed(data, now),
    gradesPending: true,
  };
}

// Ответ студента. Возвращает текст ошибки или null.
export function submitAnswer(state: KioskState, data: KioskData, taskId: string, raw: unknown, now: number) {
  const task = data.tasks.find((t) => t.id === taskId);
  const fragmentId = task ? taskFragment(state, task) : null;
  if (!task || !fragmentId || !state.readAt[fragmentId]) return "Задание ещё не найдено.";
  if (deadlinePassed(data, now)) return "Дедлайн прошёл, ответы закрыты.";
  const v = (raw ?? {}) as { choice?: unknown; sentence?: unknown; text?: unknown };

  let value: AnswerValue;
  if (task.format === "CHOICE") {
    const choice = Number(v.choice);
    if (!Number.isInteger(choice) || !task.options?.[choice]) return "Выберите вариант.";
    value = { choice };
  } else if (task.format === "SELECTION") {
    const sentence = Number(v.sentence);
    const range = Number.isInteger(sentence) ? data.selections[fragmentId]?.sentences[sentence] : undefined;
    if (!range) return "Выберите предложение в абзаце.";
    value = { range: [range[0], range[1]] };
  } else {
    const text = typeof v.text === "string" ? v.text.trim() : "";
    const error = shortAnswerError(text);
    if (error) return error;
    value = { text };
  }
  state.answers[taskId] = { value, at: now };
  state.savedAt = now;
  return null;
}
