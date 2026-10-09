import { AnswerFormat, FragmentKind, Grade } from "@prisma/client";
import { db } from "./db";
import type { FragmentLine } from "./pdf-service";
import { taskPoints } from "./scoring";
import { requireTextTeacher } from "./texts";

// Состояние задания у студента для таблицы результатов.
export type CellState = "hidden" | "found" | "pending" | "pass" | "fail";

export type ResultRow = {
  userId: string;
  name: string;
  email: string;
  openedAt: Date | null;
  readCount: number;
  cells: CellState[];
  found: number;
  passed: number;
  pending: number;
  points: number;
};

export type HeatRow = { fragmentId: string; page: number; preview: string; readers: number };

export type TextResults = {
  tasks: { id: string; prompt: string; format: AnswerFormat }[];
  rows: ResultRow[];
  heat: HeatRow[];
  students: number;
  bodyCount: number;
  deadline: Date | null;
};

export async function getTextResults(textId: string, teacherId: string): Promise<TextResults> {
  const text = await requireTextTeacher(textId, teacherId);
  const [students, tasks, fragments, cursors] = await Promise.all([
    db.courseMember.findMany({
      where: { courseId: text.courseId, role: "STUDENT" },
      include: { user: true },
      orderBy: { joinedAt: "asc" },
    }),
    db.task.findMany({
      where: { textId },
      orderBy: { createdAt: "asc" },
      include: { placements: true, answers: true },
    }),
    db.fragment.findMany({
      where: { textId, kind: FragmentKind.BODY },
      orderBy: { position: "asc" },
      select: { id: true, content: true, lines: true },
    }),
    db.readingCursor.findMany({ where: { textId } }),
  ]);
  const studentIds = students.map((s) => s.userId);
  const reads = await db.dwell.findMany({
    where: { userId: { in: studentIds }, readAt: { not: null }, fragment: { textId, kind: FragmentKind.BODY } },
    select: { userId: true, fragmentId: true },
  });
  const readSet = new Set(reads.map((r) => `${r.userId}:${r.fragmentId}`));
  const openedAt = new Map(cursors.map((c) => [c.userId, c.firstOpenedAt]));

  const rows: ResultRow[] = students.map(({ user }) => {
    const cells = tasks.map((t): CellState => {
      const fragmentId = t.fragmentId ?? t.placements.find((p) => p.userId === user.id)?.fragmentId;
      const answer = t.answers.find((a) => a.userId === user.id);
      if (answer) return answer.grade === Grade.PASS ? "pass" : answer.grade === Grade.FAIL ? "fail" : "pending";
      return fragmentId && readSet.has(`${user.id}:${fragmentId}`) ? "found" : "hidden";
    });
    const passed = cells.filter((c) => c === "pass").length;
    return {
      userId: user.id,
      name: user.name ?? user.email,
      email: user.email,
      openedAt: openedAt.get(user.id) ?? null,
      readCount: fragments.filter((f) => readSet.has(`${user.id}:${f.id}`)).length,
      cells,
      found: cells.filter((c) => c !== "hidden").length,
      passed,
      pending: cells.filter((c) => c === "pending").length,
      points: taskPoints(passed, tasks.length),
    };
  });

  const heat = fragments.map((f) => ({
    fragmentId: f.id,
    page: ((f.lines as FragmentLine[])[0]?.page ?? 0) + 1,
    preview: f.content.slice(0, 90),
    readers: studentIds.filter((u) => readSet.has(`${u}:${f.id}`)).length,
  }));

  return {
    tasks: tasks.map((t) => ({ id: t.id, prompt: t.prompt, format: t.format })),
    rows,
    heat,
    students: students.length,
    bodyCount: fragments.length,
    deadline: text.deadline,
  };
}

const CELL_CSV: Record<CellState, string> = {
  hidden: "не найдено",
  found: "нет ответа",
  pending: "на проверке",
  pass: "засчитано",
  fail: "не засчитано",
};

function csvField(value: string | number): string {
  const s = String(value);
  return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// CSV для Excel: точка с запятой и BOM, чтобы кириллица открывалась без настройки.
export function resultsToCsv(results: TextResults): string {
  const header = [
    "Студент",
    "Почта",
    "Открыл текст",
    "Дочитано абзацев",
    "Найдено заданий",
    ...results.tasks.map((_, i) => `Задание ${i + 1}`),
    "Баллы за задания",
  ];
  const lines = results.rows.map((r) => [
    r.name,
    r.email,
    r.openedAt ? r.openedAt.toISOString().slice(0, 10) : "",
    `${r.readCount}/${results.bodyCount}`,
    `${r.found}/${results.tasks.length}`,
    ...r.cells.map((c) => CELL_CSV[c]),
    r.points.toString().replace(".", ","),
  ]);
  return "﻿" + [header, ...lines].map((l) => l.map(csvField).join(";")).join("\r\n") + "\r\n";
}
