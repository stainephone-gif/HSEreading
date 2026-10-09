// Данные читалки без зависимостей от базы: их собирает и сервер, и офлайн-читалка.

import type { FragmentLine, Sentence } from "./pdf-service";

export type ReaderFragment = {
  id: string;
  lines: Pick<FragmentLine, "page" | "bbox">[];
  thresholdMs: number;
};

export type ReaderBlock = { id: string; kind: "BODY" | "HEADING"; content: string };

export type ReaderData = {
  textId: string;
  courseId: string;
  title: string;
  // Режим, выбранный преподавателем. Текст в режиме PDF на телефоне всё равно можно читать текстом.
  displayMode: "PDF" | "WEB";
  language: string;
  // Абзацы и заголовки по порядку: из них собирается веб-текст.
  blocks: ReaderBlock[];
  pages: { width: number; height: number }[];
  fragments: ReaderFragment[];
  // Преподаватель смотрит предпросмотр: ничего не записывается.
  preview: boolean;
  dwellMs: Record<string, number>;
  readIds: string[];
  // Студенту: найденные задания и их общее число.
  tasks: StudentTasks | null;
  // Предпросмотр: задания с привязкой к абзацу, маркер появляется по мере чтения.
  previewTasks: { id: string; fragmentId: string; prompt: string }[];
  // Офлайн-читалка: абзацы (страницы), где у студента спрятаны задания. Если он
  // пролистал такое место, не дочитав, читалка предупредит, что задание пропущено.
  taskFragments?: string[];
};

export type StudentTask = {
  id: string;
  fragmentId: string;
  format: "CHOICE" | "SELECTION" | "SHORT";
  prompt: string;
  options: string[] | null;
  // Для ответа выделением: текст абзаца, его строки и предложения.
  selection: { content: string; lines: FragmentLine[]; sentences: Sentence[] } | null;
  answer: { choice?: number; range?: Sentence; text?: string } | null;
  // Результат виден только после дедлайна.
  grade: "PASS" | "FAIL" | null;
};

export type StudentTasks = {
  total: number;
  found: StudentTask[];
  deadline: Date | null;
  closed: boolean;
  // Офлайн-читалка: ответы проверяются после загрузки отчёта, оценок в ней нет.
  gradesPending?: boolean;
};
