import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AccessError, acceptInvite, createCourse, getCourseForMember } from "@/lib/courses";
import { db } from "@/lib/db";
import * as pdfService from "@/lib/pdf-service";
import { ExtractFailure, type ExtractResult } from "@/lib/pdf-service";
import {
  createTextFromPdf,
  getTextForTeacher,
  getTextPdfForMember,
  listTexts,
  mergeWithNext,
  reparseText,
  setFragmentKind,
  splitAtSentence,
  updateTextSettings,
  UploadError,
} from "@/lib/texts";
import { resetDb } from "./helpers";

const PDF = new TextEncoder().encode("%PDF-1.7 fake");

// Абзац, разорванный страницей: между половинами стоят колонтитул и номер страницы.
const EXTRACTED: ExtractResult = {
  pageCount: 2,
  pages: [
    { width: 595, height: 842 },
    { width: 595, height: 842 },
  ],
  language: "ru",
  fragments: [
    { kind: "heading", text: "Введение", language: "ru", words: 1, lines: [line(0, 0, 8)], sentences: [[0, 8]] },
    {
      kind: "body",
      text: "Первая фраза. Вторая обрывается на",
      language: "ru",
      words: 6,
      lines: [line(0, 0, 34)],
      sentences: [
        [0, 13],
        [14, 34],
      ],
    },
    {
      kind: "excluded",
      text: "1",
      language: "ru",
      words: 1,
      lines: [line(0, 0, 1)],
      sentences: [[0, 1]],
      excludeReason: "колонтитул или номер страницы",
    },
    {
      kind: "body",
      text: "Середина кавычки. Конец абзаца.",
      language: "ru",
      words: 4,
      lines: [line(1, 0, 31)],
      sentences: [
        [0, 17],
        [18, 31],
      ],
    },
  ],
};

function line(page: number, start: number, end: number) {
  return { page, bbox: [60, 60, 535, 72] as [number, number, number, number], start, end };
}

async function setup() {
  const teacher = await db.user.create({ data: { email: "t@example.com", isTeacher: true } });
  const student = await db.user.create({ data: { email: "s@example.com" } });
  const course = await createCourse(teacher.id, "Курс");
  const code = (await getCourseForMember(course.id, teacher.id))!.course.invites[0].code;
  await acceptInvite(code, student.id);
  return { teacher, student, course };
}

async function upload(courseId: string, userId: string) {
  return createTextFromPdf({ courseId, userId, title: "", fileName: "Статья Инниса.pdf", bytes: PDF });
}

async function contents(textId: string, userId: string) {
  const text = await getTextForTeacher(textId, userId);
  return text!.fragments.map((f) => `${f.kind}:${f.content}`);
}

beforeAll(async () => {
  process.env.STORAGE_DIR = await mkdtemp(path.join(tmpdir(), "polya-storage-"));
});

beforeEach(async () => {
  vi.restoreAllMocks();
  await resetDb();
});

describe("загрузка текста", () => {
  it("сохраняет PDF и фрагменты", async () => {
    const extract = vi.spyOn(pdfService, "extractPdf").mockResolvedValue(EXTRACTED);
    const { teacher, student, course } = await setup();

    const created = await upload(course.id, teacher.id);
    expect(extract).toHaveBeenCalledOnce();

    const text = await getTextForTeacher(created.id, teacher.id);
    expect(text?.title).toBe("Статья Инниса");
    expect(text?.status).toBe("READY");
    expect(text?.pageCount).toBe(2);
    expect(text?.fragments.map((f) => f.kind)).toEqual(["HEADING", "BODY", "EXCLUDED", "BODY"]);

    // Студент открывает исходник, но не видит разбивку и список текстов.
    expect((await getTextPdfForMember(created.id, student.id))?.data.toString()).toBe("%PDF-1.7 fake");
    expect(await getTextForTeacher(created.id, student.id)).toBeNull();
    expect(await listTexts(course.id, student.id)).toEqual([]);
    expect(await listTexts(course.id, teacher.id)).toHaveLength(1);
  });

  it("не пускает студента и чужие файлы", async () => {
    const { student, course } = await setup();
    await expect(upload(course.id, student.id)).rejects.toBeInstanceOf(AccessError);
    const teacher = await db.user.findUniqueOrThrow({ where: { email: "t@example.com" } });
    await expect(
      createTextFromPdf({ courseId: course.id, userId: teacher.id, title: "", fileName: "a.txt", bytes: new Uint8Array([1, 2, 3]) }),
    ).rejects.toBeInstanceOf(UploadError);
  });

  it("сохраняет понятную ошибку и даёт повторить разбор", async () => {
    vi.spyOn(pdfService, "extractPdf").mockRejectedValueOnce(
      new ExtractFailure("no_text_layer", "В PDF нет текстового слоя."),
    );
    const { teacher, course } = await setup();
    const created = await upload(course.id, teacher.id);
    let text = await getTextForTeacher(created.id, teacher.id);
    expect(text?.status).toBe("FAILED");
    expect(text?.error).toBe("В PDF нет текстового слоя.");

    vi.spyOn(pdfService, "extractPdf").mockResolvedValue(EXTRACTED);
    await reparseText(created.id, teacher.id);
    text = await getTextForTeacher(created.id, teacher.id);
    expect(text?.status).toBe("READY");
    expect(text?.fragments).toHaveLength(4);
  });
});

describe("правка разбивки", () => {
  it("склеивает абзац через колонтитул и разрезает обратно", async () => {
    vi.spyOn(pdfService, "extractPdf").mockResolvedValue(EXTRACTED);
    const { teacher, course } = await setup();
    const created = await upload(course.id, teacher.id);
    const [, first] = (await getTextForTeacher(created.id, teacher.id))!.fragments;

    await mergeWithNext(first.id, teacher.id);
    expect(await contents(created.id, teacher.id)).toEqual([
      "HEADING:Введение",
      "BODY:Первая фраза. Вторая обрывается на Середина кавычки. Конец абзаца.",
      "EXCLUDED:1",
    ]);
    const merged = (await getTextForTeacher(created.id, teacher.id))!.fragments[1];
    expect(merged.wordCount).toBe(10);
    expect((merged.lines as unknown[]).length).toBe(2);

    // Склеенное предложение «Вторая … кавычки.» — второе, режем перед третьим.
    await splitAtSentence(merged.id, teacher.id, 2);
    expect(await contents(created.id, teacher.id)).toEqual([
      "HEADING:Введение",
      "BODY:Первая фраза. Вторая обрывается на Середина кавычки.",
      "BODY:Конец абзаца.",
      "EXCLUDED:1",
    ]);
  });

  it("меняет тип фрагмента и настройки, студенту нельзя", async () => {
    vi.spyOn(pdfService, "extractPdf").mockResolvedValue(EXTRACTED);
    const { teacher, student, course } = await setup();
    const created = await upload(course.id, teacher.id);
    const fragments = (await getTextForTeacher(created.id, teacher.id))!.fragments;

    await setFragmentKind(fragments[2].id, teacher.id, "BODY");
    const restored = (await getTextForTeacher(created.id, teacher.id))!.fragments[2];
    expect(restored.kind).toBe("BODY");
    expect(restored.excludeReason).toBeNull();

    await expect(setFragmentKind(fragments[1].id, student.id, "EXCLUDED")).rejects.toBeInstanceOf(AccessError);
    await expect(mergeWithNext(fragments[1].id, student.id)).rejects.toBeInstanceOf(AccessError);
    await expect(setFragmentKind(fragments[1].id, teacher.id, "WHATEVER")).rejects.toBeInstanceOf(UploadError);

    await updateTextSettings(created.id, teacher.id, { title: "Иннис", wordsPerMinute: 150, displayMode: "WEB" });
    const text = await getTextForTeacher(created.id, teacher.id);
    expect([text?.title, text?.wordsPerMinute, text?.displayMode]).toEqual(["Иннис", 150, "WEB"]);
    await expect(
      updateTextSettings(created.id, teacher.id, { title: "Иннис", wordsPerMinute: 5, displayMode: "PDF" }),
    ).rejects.toBeInstanceOf(UploadError);
  });
});
