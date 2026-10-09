import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AccessError } from "@/lib/courses";
import { db } from "@/lib/db";
import * as pdfService from "@/lib/pdf-service";
import { getReaderData } from "@/lib/reading";
import {
  countSentences,
  createTask,
  ensurePlacements,
  getStudentTasks,
  gradeAnswer,
  listTasksForTeacher,
  selectionMatches,
  submitAnswer,
} from "@/lib/tasks";
import { mergeWithNext, reparseText, setFragmentKind, setPublished, splitAtSentence, UploadError } from "@/lib/texts";
import { dateToLocalInput, localInputToDate } from "@/lib/time";
import { resetDb } from "./helpers";
import { EXTRACTED, setup, upload } from "./text-fixtures";

async function prepare({ publish = true } = {}) {
  vi.spyOn(pdfService, "extractPdf").mockResolvedValue(EXTRACTED);
  const ctx = await setup();
  const text = await upload(ctx.course.id, ctx.teacher.id);
  const fragments = await db.fragment.findMany({ where: { textId: text.id }, orderBy: { position: "asc" } });
  const [heading, first, footer, second] = fragments;
  if (publish) await setPublished(text.id, ctx.teacher.id, true);
  return { ...ctx, text, heading, first, footer, second };
}

async function markRead(userId: string, fragmentId: string) {
  await db.dwell.upsert({
    where: { userId_fragmentId: { userId, fragmentId } },
    create: { userId, fragmentId, ms: 60_000, readAt: new Date() },
    update: { readAt: new Date() },
  });
}

beforeAll(async () => {
  process.env.STORAGE_DIR = await mkdtemp(path.join(tmpdir(), "polya-storage-"));
});

beforeEach(async () => {
  vi.restoreAllMocks();
  await resetDb();
});

describe("вспомогательные правила", () => {
  it("выделение засчитывается при пересечении больше половины", () => {
    expect(selectionMatches([0, 10], [0, 10])).toBe(true);
    expect(selectionMatches([0, 10], [4, 10])).toBe(true);
    expect(selectionMatches([0, 10], [5, 20])).toBe(false);
    expect(selectionMatches([0, 10], [20, 30])).toBe(false);
  });

  it("считает предложения в коротком ответе", () => {
    expect(countSentences("Одно.")).toBe(1);
    expect(countSentences("Одно. Два! Три? ")).toBe(3);
    expect(countSentences("Без точки в конце")).toBe(1);
    expect(countSentences("Раз. Два. Три. Четыре.")).toBe(4);
  });

  it("переводит дедлайн из местного времени", () => {
    const d = localInputToDate("2026-10-20T23:59", "Europe/Moscow")!;
    expect(d.toISOString()).toBe("2026-10-20T20:59:00.000Z");
    expect(dateToLocalInput(d, "Europe/Moscow")).toBe("2026-10-20T23:59");
    expect(localInputToDate("2026-07-01T12:00", "Europe/Berlin")!.toISOString()).toBe("2026-07-01T10:00:00.000Z");
    expect(localInputToDate("завтра")).toBeNull();
  });
});

describe("создание заданий", () => {
  it("проверяет ввод и права", async () => {
    const { text, teacher, student, first, heading } = await prepare();
    const bad = (input: unknown) => expect(createTask(text.id, teacher.id, input)).rejects.toBeInstanceOf(UploadError);

    await bad({ kind: "anchored-short", fragmentId: heading.id, prompt: "Задание" });
    await bad({ kind: "anchored-short", fragmentId: first.id, prompt: "  " });
    await bad({
      kind: "anchored-choice",
      fragmentId: first.id,
      prompt: "Что?",
      options: [
        { text: "А", correct: true },
        { text: "Б", correct: true },
      ],
    });
    await bad({ kind: "anchored-selection", fragmentId: first.id, prompt: "Где?", sentenceIndex: 9 });
    await bad({ kind: "scattered-section", sectionFragmentId: first.id, prompt: "Перескажите" });
    await bad({ kind: "scattered-pages", pageFrom: 2, pageTo: 5, prompt: "Перескажите" });
    await expect(
      createTask(text.id, student.id, { kind: "anchored-short", fragmentId: first.id, prompt: "Задание" }),
    ).rejects.toBeInstanceOf(AccessError);

    const task = await createTask(text.id, teacher.id, {
      kind: "anchored-selection",
      fragmentId: first.id,
      prompt: "Найдите предложение, где фраза обрывается",
      sentenceIndex: 1,
    });
    expect(task.answerRange).toEqual([14, 34]);
  });
});

describe("студент и задания", () => {
  it("задание скрыто, пока абзац не дочитан, и не выдаёт верный ответ", async () => {
    const { text, teacher, student, first } = await prepare();
    await createTask(text.id, teacher.id, {
      kind: "anchored-choice",
      fragmentId: first.id,
      prompt: "Что обрывается?",
      options: [
        { text: "Фраза", correct: true },
        { text: "Строка", correct: false },
      ],
    });

    let tasks = await getStudentTasks(text.id, student.id);
    expect(tasks.total).toBe(1);
    expect(tasks.found).toEqual([]);
    const reader = await getReaderData(text.id, student.id);
    expect(JSON.stringify(reader)).not.toContain("Что обрывается");

    await markRead(student.id, first.id);
    tasks = await getStudentTasks(text.id, student.id);
    expect(tasks.found).toHaveLength(1);
    expect(tasks.found[0].options).toEqual(["Фраза", "Строка"]);
    expect(JSON.stringify(tasks)).not.toContain("correct");
  });

  it("проверяет ответы и прячет результат до дедлайна", async () => {
    const { text, teacher, student, first } = await prepare();
    const choice = await createTask(text.id, teacher.id, {
      kind: "anchored-choice",
      fragmentId: first.id,
      prompt: "Что обрывается?",
      options: [
        { text: "Фраза", correct: true },
        { text: "Строка", correct: false },
      ],
    });
    const selection = await createTask(text.id, teacher.id, {
      kind: "anchored-selection",
      fragmentId: first.id,
      prompt: "Где фраза обрывается?",
      sentenceIndex: 1,
    });
    const short = await createTask(text.id, teacher.id, {
      kind: "anchored-short",
      fragmentId: first.id,
      prompt: "Перескажите",
    });

    await expect(submitAnswer(choice.id, student.id, { choice: 0 })).rejects.toThrow("ещё не найдено");
    await markRead(student.id, first.id);

    await submitAnswer(choice.id, student.id, { choice: 1 });
    await submitAnswer(choice.id, student.id, { choice: 0 });
    await submitAnswer(selection.id, student.id, { sentence: 0 });
    await expect(submitAnswer(short.id, student.id, { text: "Раз. Два. Три. Четыре." })).rejects.toThrow("три");
    await submitAnswer(short.id, student.id, { text: "Фраза обрывается на полуслове." });

    const answers = await db.answer.findMany({ orderBy: { submittedAt: "asc" } });
    const gradeOf = (id: string) => answers.find((a) => a.taskId === id)?.grade;
    expect(gradeOf(choice.id)).toBe("PASS");
    expect(gradeOf(selection.id)).toBe("FAIL");
    expect(gradeOf(short.id)).toBeNull();

    // До дедлайна студент результата не видит.
    let tasks = await getStudentTasks(text.id, student.id);
    expect(tasks.found.every((t) => t.grade === null)).toBe(true);
    expect(tasks.found.find((t) => t.id === selection.id)?.answer).toEqual({ range: [0, 13] });

    // Преподаватель засчитывает короткий ответ; изменённый ответ проверяется заново.
    await expect(gradeAnswer(short.id, student.id, student.id, "PASS")).rejects.toBeInstanceOf(AccessError);
    await expect(gradeAnswer(choice.id, student.id, teacher.id, "FAIL")).rejects.toBeInstanceOf(UploadError);
    await gradeAnswer(short.id, student.id, teacher.id, "PASS");
    await submitAnswer(short.id, student.id, { text: "Другой пересказ." });
    expect(
      (await db.answer.findUniqueOrThrow({ where: { taskId_userId: { taskId: short.id, userId: student.id } } })).grade,
    ).toBeNull();
    await gradeAnswer(short.id, student.id, teacher.id, "PASS");

    // После дедлайна ответы закрыты, результат виден.
    await db.text.update({ where: { id: text.id }, data: { deadline: new Date(Date.now() - 1000) } });
    await expect(submitAnswer(choice.id, student.id, { choice: 1 })).rejects.toThrow("Дедлайн");
    tasks = await getStudentTasks(text.id, student.id);
    expect(tasks.closed).toBe(true);
    expect(tasks.found.map((t) => t.grade)).toEqual(["PASS", "FAIL", "PASS"]);

    const list = await listTasksForTeacher(text.id, teacher.id);
    expect(list.map((t) => [t.found, t.answers[0]?.value])).toEqual([
      [1, "Фраза"],
      [1, "Первая фраза."],
      [1, "Другой пересказ."],
    ]);
  });

  it("раскиданное задание закрепляется за студентом и не меняется", async () => {
    const { text, teacher, student, first, second, heading, course } = await prepare();
    await createTask(text.id, teacher.id, { kind: "scattered-section", sectionFragmentId: heading.id, prompt: "А" });
    await createTask(text.id, teacher.id, { kind: "scattered-section", sectionFragmentId: heading.id, prompt: "Б" });
    await createTask(text.id, teacher.id, { kind: "scattered-pages", pageFrom: 2, pageTo: 2, prompt: "В" });

    await getReaderData(text.id, student.id);
    const placements = await db.taskPlacement.findMany({ where: { userId: student.id }, include: { task: true } });
    const where = Object.fromEntries(placements.map((p) => [p.task.prompt, p.fragmentId]));
    // Два задания раздела попали в разные абзацы; задание страницы 2 — во второй абзац.
    expect(new Set([where["А"], where["Б"]])).toEqual(new Set([first.id, second.id]));
    expect(where["В"]).toBe(second.id);

    await ensurePlacements(text.id, student.id);
    await getReaderData(text.id, student.id);
    const again = await db.taskPlacement.findMany({ where: { userId: student.id } });
    expect(again).toHaveLength(3);
    expect(Object.fromEntries(again.map((p) => [p.taskId, p.fragmentId]))).toEqual(
      Object.fromEntries(placements.map((p) => [p.taskId, p.fragmentId])),
    );

    await markRead(student.id, second.id);
    const found = (await getStudentTasks(text.id, student.id)).found.map((t) => t.prompt).sort();
    expect(found).toEqual(["В", where["А"] === second.id ? "А" : "Б"].sort());
    void course;
  });
});

describe("задания и правка разбивки", () => {
  it("переезжают при склейке и разрезании", async () => {
    const { text, teacher, first, second } = await prepare({ publish: false });
    // Эталон «Конец абзаца.» во втором абзаце.
    const task = await createTask(text.id, teacher.id, {
      kind: "anchored-selection",
      fragmentId: second.id,
      prompt: "Где конец?",
      sentenceIndex: 1,
    });
    await mergeWithNext(first.id, teacher.id);
    let t = await db.task.findUniqueOrThrow({ where: { id: task.id } });
    let f = await db.fragment.findUniqueOrThrow({ where: { id: t.fragmentId! } });
    expect(t.fragmentId).toBe(first.id);
    expect(f.content.slice(...(t.answerRange as [number, number]))).toBe("Конец абзаца.");

    await splitAtSentence(first.id, teacher.id, 2);
    t = await db.task.findUniqueOrThrow({ where: { id: task.id } });
    f = await db.fragment.findUniqueOrThrow({ where: { id: t.fragmentId! } });
    expect(t.fragmentId).not.toBe(first.id);
    expect(f.content.slice(...(t.answerRange as [number, number]))).toBe("Конец абзаца.");

    await expect(setFragmentKind(f.id, teacher.id, "EXCLUDED")).rejects.toThrow("привязано задание");
    await expect(reparseText(text.id, teacher.id)).rejects.toThrow("задания");
  });
});
