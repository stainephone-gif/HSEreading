// Проект преподавателя: настройки читалки, задания с верными ответами и ключи.
// Хранится в файле «ключ преподавателя» (JSON) и никогда не попадает к
// студентам: в файл читалки идут только открытый ключ и задания без ответов.

import nacl from "tweetnacl";
import { thresholdMs } from "@/lib/dwell-rules";
import { fromBase64, packKeys, toBase64 } from "@/lib/kiosk-crypto";
import { KIOSK_VERSION, type KioskData, type KioskTask } from "@/lib/kiosk-engine";
import type { Sentence } from "@/lib/pdf-service";
import type { ReaderBlock } from "@/lib/reader-types";
import { latinSlug } from "@/kiosk/session";
import type { PageText } from "./pages";

export const KEY_KIND = "polya-key";
export const KEY_VERSION = 1;

export type ChoiceOption = { text: string; correct: boolean };

export type ProjectTask = {
  id: string;
  format: "CHOICE" | "SELECTION" | "SHORT";
  prompt: string;
  // Задание на странице (номер с 0)…
  page: number | null;
  // …или раскиданное по страницам с pageFrom по pageTo (с 1): у каждого студента своя.
  pageFrom: number | null;
  pageTo: number | null;
  options: ChoiceOption[] | null;
  // Выделение: эталонное предложение и текст страницы (чтобы показать ответы).
  answerRange: Sentence | null;
  pageContent: string | null;
};

export type Project = {
  kind: typeof KEY_KIND;
  v: number;
  exportId: string;
  createdAt: string;
  title: string;
  language: string;
  wordsPerMinute: number;
  displayMode: "PDF" | "WEB";
  deadline: string | null;
  pdf: { name: string; size: number; digest: string };
  // Число слов на странице: от него считается время дочитывания.
  pages: { words: number }[];
  tasks: ProjectTask[];
  keys: { publicKey: string; secretKey: string; mac: string; local: string };
};

function randomId(bytes = 10): string {
  return Array.from(nacl.randomBytes(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function pdfDigest(pdf: Uint8Array): string {
  return Array.from(nacl.hash(pdf).subarray(0, 16), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function pageId(index: number): string {
  return `p${index + 1}`;
}

function detectLanguage(pages: PageText[]): string {
  const text = pages.map((p) => p.content).join(" ");
  const cyr = text.match(/\p{Script=Cyrillic}/gu)?.length ?? 0;
  const lat = text.match(/\p{Script=Latin}/gu)?.length ?? 0;
  return lat > cyr ? "en" : "ru";
}

export function newProject(fileName: string, pdf: Uint8Array, pages: PageText[]): Project {
  const pair = nacl.box.keyPair();
  return {
    kind: KEY_KIND,
    v: KEY_VERSION,
    exportId: randomId(),
    createdAt: new Date().toISOString(),
    title: fileName.replace(/\.pdf$/i, "").trim() || "Текст",
    language: detectLanguage(pages),
    wordsPerMinute: 200,
    displayMode: "PDF",
    deadline: null,
    pdf: { name: fileName, size: pdf.length, digest: pdfDigest(pdf) },
    pages: pages.map((p) => ({ words: p.words })),
    tasks: [],
    keys: {
      publicKey: toBase64(pair.publicKey),
      secretKey: toBase64(pair.secretKey),
      mac: toBase64(nacl.randomBytes(32)),
      local: toBase64(nacl.randomBytes(32)),
    },
  };
}

// Задания

export type TaskInput =
  | { kind: "page-choice"; page: number; prompt: string; options: ChoiceOption[] }
  | { kind: "page-selection"; page: number; prompt: string; sentenceIndex: number }
  | { kind: "page-short"; page: number; prompt: string }
  | { kind: "scattered"; pageFrom: number; pageTo: number; prompt: string };

// Страницы, по которым раскидывается задание: только с текстом.
export function scatterCandidates(project: Project, task: Pick<ProjectTask, "pageFrom" | "pageTo">): string[] {
  const ids: string[] = [];
  for (let n = task.pageFrom ?? 1; n <= (task.pageTo ?? 0); n++) {
    if ((project.pages[n - 1]?.words ?? 0) > 0) ids.push(pageId(n - 1));
  }
  return ids;
}

export function createTask(project: Project, pages: PageText[], input: TaskInput): ProjectTask | string {
  const prompt = input.prompt.trim();
  if (!prompt) return "Напишите задание.";
  if (prompt.length > 2000) return "Задание длиннее 2000 знаков.";
  const base = { id: randomId(8), prompt, pageFrom: null, pageTo: null, options: null, answerRange: null };

  if (input.kind === "scattered") {
    const { pageFrom, pageTo } = input;
    if (!Number.isInteger(pageFrom) || !Number.isInteger(pageTo) || pageFrom < 1 || pageTo < pageFrom) {
      return `Страницы: от 1 до ${pages.length}, начало не позже конца.`;
    }
    if (pageTo > pages.length) return `В тексте ${pages.length} стр.`;
    const task: ProjectTask = { ...base, format: "SHORT", page: null, pageFrom, pageTo, pageContent: null };
    if (scatterCandidates(project, task).length === 0) return "В этих страницах нет текста.";
    return task;
  }

  const page = pages[input.page];
  if (!page) return "Выберите страницу.";
  if (page.words === 0) return "На этой странице нет текстового слоя: задание не к чему привязать.";
  const onPage = { ...base, page: input.page, pageContent: null };
  if (input.kind === "page-choice") {
    const options = input.options.map((o) => ({ text: o.text.trim(), correct: o.correct }));
    if (options.length < 2) return "Нужно хотя бы два варианта.";
    if (options.length > 6) return "Не больше шести вариантов.";
    if (options.some((o) => !o.text)) return "Пустой вариант ответа.";
    if (options.filter((o) => o.correct).length !== 1) return "Отметьте один верный вариант.";
    return { ...onPage, format: "CHOICE", options };
  }
  if (input.kind === "page-selection") {
    const range = page.sentences[input.sentenceIndex];
    if (!range) return "Выберите эталонное предложение.";
    return { ...onPage, format: "SELECTION", answerRange: range, pageContent: page.content };
  }
  return { ...onPage, format: "SHORT" };
}

export function describeTask(t: ProjectTask): string {
  if (t.page !== null) return `стр. ${t.page + 1}`;
  return `раскидано по стр. ${t.pageFrom}–${t.pageTo}`;
}

// Файл для студентов

export function deadlineLabel(deadline: string | null): string | null {
  if (!deadline) return null;
  return `Ответы до ${new Date(deadline).toLocaleString("ru-RU", { dateStyle: "long", timeStyle: "short" })}`;
}

export function buildKioskData(project: Project, pages: PageText[]): KioskData {
  const blocks: ReaderBlock[] = [];
  pages.forEach((p, i) => {
    if (!p.content) return;
    blocks.push({ id: `h${i + 1}`, kind: "HEADING", content: `Страница ${i + 1}` });
    blocks.push({ id: pageId(i), kind: "BODY", content: p.content });
  });
  const selections: KioskData["selections"] = {};
  const tasks = project.tasks.map((t): KioskTask => {
    if (t.format === "SELECTION" && t.page !== null) {
      const p = pages[t.page];
      selections[pageId(t.page)] = { content: p.content, lines: p.lines, sentences: p.sentences };
    }
    return {
      id: t.id,
      format: t.format,
      prompt: t.prompt,
      // Верный вариант в файл не попадает.
      options: t.options?.map((o) => o.text) ?? null,
      fragmentId: t.page !== null ? pageId(t.page) : null,
      candidates: t.page === null ? scatterCandidates(project, t) : null,
    };
  });
  return {
    v: KIOSK_VERSION,
    exportId: project.exportId,
    textId: project.exportId,
    title: project.title,
    displayMode: project.displayMode,
    language: project.language,
    blocks,
    pages: pages.map((p) => ({ width: p.width, height: p.height })),
    // Учёт дочитывания по страницам: зона чтения — вся страница.
    fragments: pages.map((p, i) => ({
      id: pageId(i),
      lines: [{ page: i, bbox: [0, 0, p.width, p.height] }],
      thresholdMs: thresholdMs(p.words, project.wordsPerMinute),
    })),
    tasks,
    selections,
    deadline: project.deadline,
    deadlineLabel: deadlineLabel(project.deadline),
    publicKey: project.keys.publicKey,
    keys: packKeys(project.exportId, { mac: fromBase64(project.keys.mac), local: fromBase64(project.keys.local) }),
    exportedAt: new Date().toISOString(),
  };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

// HTML-файл читалки: тот же скрипт, что у конструктора, плюс данные и PDF.
// Скрипт сам понимает по данным, что он читалка.
export function renderStudentHtml(params: { data: KioskData; pdf: Uint8Array; js: string; css: string }): string {
  const json = JSON.stringify(params.data).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="${escapeHtml(params.data.language)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(params.data.title)} — Поля</title>
<style id="polya-style">${params.css.replace(/<\/(style)/gi, "<\\/$1")}</style>
</head>
<body>
<div id="root"><p style="padding:24px">Читалка загружается… Если это сообщение не исчезает, откройте файл в Chrome, Firefox, Edge или Safari.</p></div>
<script type="application/json" id="polya-data">${json}</script>
<script type="application/octet-stream" id="polya-pdf">${toBase64(params.pdf)}</script>
<script id="polya-app">${params.js.replace(/<\/(script)/gi, "<\\/$1")}</script>
</body>
</html>
`;
}

// Имена файлов только латиницей: с кириллицей часть браузеров сохраняет «download».
export function studentFileName(title: string): string {
  return `polya-chitalka-${latinSlug(title, 40) || "text"}.html`;
}

export function keyFileName(title: string): string {
  return `polya-klyuch-${latinSlug(title, 40) || "text"}.json`;
}

// Файл ключа

export function serializeProject(project: Project): string {
  return JSON.stringify(project, null, 1);
}

export function parseProject(text: string): Project | string {
  let p: Partial<Project>;
  try {
    p = JSON.parse(text);
  } catch {
    return "Это не файл ключа.";
  }
  if (p?.kind !== KEY_KIND) return "Это не файл ключа преподавателя.";
  if (p.v !== KEY_VERSION) return "Ключ сделан другой версией конструктора.";
  if (!p.exportId || !p.keys?.secretKey || !Array.isArray(p.tasks) || !Array.isArray(p.pages)) {
    return "Файл ключа повреждён.";
  }
  return p as Project;
}
