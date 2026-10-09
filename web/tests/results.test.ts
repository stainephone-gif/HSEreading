import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AccessError } from "@/lib/courses";
import { db } from "@/lib/db";
import * as pdfService from "@/lib/pdf-service";
import { getTextResults, resultsToCsv } from "@/lib/results";
import { taskPoints } from "@/lib/scoring";
import { createTask, gradeAnswer, submitAnswer } from "@/lib/tasks";
import { setPublished } from "@/lib/texts";
import { resetDb } from "./helpers";
import { EXTRACTED, setup, upload } from "./text-fixtures";

beforeAll(async () => {
  process.env.STORAGE_DIR = await mkdtemp(path.join(tmpdir(), "polya-storage-"));
});

beforeEach(async () => {
  vi.restoreAllMocks();
  await resetDb();
});

async function markRead(userId: string, fragmentId: string) {
  await db.dwell.create({ data: { userId, fragmentId, ms: 60_000, readAt: new Date() } });
}

describe("оценка", () => {
  it("8 баллов поровну между заданиями", () => {
    expect(taskPoints(4, 4)).toBe(8);
    expect(taskPoints(1, 4)).toBe(2);
    expect(taskPoints(1, 3)).toBe(2.67);
    expect(taskPoints(0, 0)).toBe(0);
  });
});

describe("результаты текста", () => {
  it("собирает таблицу, карту дочитывания и CSV", async () => {
    vi.spyOn(pdfService, "extractPdf").mockResolvedValue(EXTRACTED);
    const { teacher, student, course } = await setup();
    const lazy = await db.user.create({ data: { email: "lazy@example.com", name: "Не открывал" } });
    await db.courseMember.create({ data: { courseId: course.id, userId: lazy.id, role: "STUDENT" } });
    const text = await upload(course.id, teacher.id);
    await setPublished(text.id, teacher.id, true);
    const [, first, , second] = await db.fragment.findMany({
      where: { textId: text.id },
      orderBy: { position: "asc" },
    });

    const choice = await createTask(text.id, teacher.id, {
      kind: "anchored-choice",
      fragmentId: first.id,
      prompt: "Что обрывается?",
      options: [
        { text: "Фраза", correct: true },
        { text: "Строка", correct: false },
      ],
    });
    const short = await createTask(text.id, teacher.id, {
      kind: "anchored-short",
      fragmentId: first.id,
      prompt: "Перескажите",
    });
    await createTask(text.id, teacher.id, {
      kind: "anchored-short",
      fragmentId: second.id,
      prompt: "Второй; с «кавычками»",
    });

    await db.readingCursor.create({ data: { userId: student.id, textId: text.id } });
    await markRead(student.id, first.id);
    await submitAnswer(choice.id, student.id, { choice: 0 });
    await submitAnswer(short.id, student.id, { text: "Пересказ." });

    let results = await getTextResults(text.id, teacher.id);
    expect(results.students).toBe(2);
    const [s, l] = results.rows;
    expect(s.cells).toEqual(["pass", "pending", "hidden"]);
    expect([s.found, s.passed, s.pending, s.points, s.readCount]).toEqual([2, 1, 1, 2.67, 1]);
    expect(l.cells).toEqual(["hidden", "hidden", "hidden"]);
    expect(l.openedAt).toBeNull();
    expect(results.heat.map((h) => h.readers)).toEqual([1, 0]);

    await gradeAnswer(short.id, student.id, teacher.id, "PASS");
    results = await getTextResults(text.id, teacher.id);
    expect(results.rows[0].points).toBe(5.33);

    const csv = resultsToCsv(results);
    expect(csv.startsWith("﻿Студент;Почта")).toBe(true);
    expect(csv).toContain('"Задание 3"'.replace(/"/g, ""));
    expect(csv).toContain("Студент;s@example.com;");
    expect(csv).toContain(";засчитано;засчитано;не найдено;5,33");
    expect(csv).toContain("Не открывал;lazy@example.com;;0/2;0/3;не найдено;не найдено;не найдено;0");

    await expect(getTextResults(text.id, student.id)).rejects.toBeInstanceOf(AccessError);
  });
});
