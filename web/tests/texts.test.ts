import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AccessError } from "@/lib/courses";
import { db } from "@/lib/db";
import * as pdfService from "@/lib/pdf-service";
import { ExtractFailure } from "@/lib/pdf-service";
import {
  createTextFromPdf,
  getTextForTeacher,
  getTextPdfForMember,
  listTexts,
  mergeWithNext,
  reparseText,
  setFragmentKind,
  setPublished,
  splitAtSentence,
  updateTextSettings,
  UploadError,
} from "@/lib/texts";
import { resetDb } from "./helpers";
import { EXTRACTED, setup, upload } from "./text-fixtures";

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

    // Исходник видит преподаватель; студент — только после публикации. Разбивку студент не видит.
    expect((await getTextPdfForMember(created.id, teacher.id))?.data.toString()).toBe("%PDF-1.7 fake");
    expect(await getTextPdfForMember(created.id, student.id)).toBeNull();
    expect(await getTextForTeacher(created.id, student.id)).toBeNull();
    expect(await listTexts(course.id, student.id)).toEqual([]);
    expect(await listTexts(course.id, teacher.id)).toHaveLength(1);
  });

  it("не пускает студента и чужие файлы", async () => {
    const { student, course } = await setup();
    await expect(upload(course.id, student.id)).rejects.toBeInstanceOf(AccessError);
    const teacher = await db.user.findUniqueOrThrow({ where: { email: "t@example.com" } });
    await expect(
      createTextFromPdf({
        courseId: course.id,
        userId: teacher.id,
        title: "",
        fileName: "a.txt",
        bytes: new Uint8Array([1, 2, 3]),
      }),
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

describe("публикация", () => {
  it("открывает текст студенту и запрещает править разбивку", async () => {
    vi.spyOn(pdfService, "extractPdf").mockResolvedValue(EXTRACTED);
    const { teacher, student, course } = await setup();
    const created = await upload(course.id, teacher.id);
    expect(await getTextPdfForMember(created.id, student.id)).toBeNull();

    await expect(setPublished(created.id, student.id, true)).rejects.toBeInstanceOf(AccessError);
    await setPublished(created.id, teacher.id, true);
    expect((await listTexts(course.id, student.id)).map((t) => t.id)).toEqual([created.id]);
    expect(await getTextPdfForMember(created.id, student.id)).not.toBeNull();

    const [, first] = (await getTextForTeacher(created.id, teacher.id))!.fragments;
    await expect(mergeWithNext(first.id, teacher.id)).rejects.toBeInstanceOf(UploadError);
    await expect(splitAtSentence(first.id, teacher.id, 1)).rejects.toBeInstanceOf(UploadError);
    await expect(reparseText(created.id, teacher.id)).rejects.toBeInstanceOf(UploadError);

    await setPublished(created.id, teacher.id, false);
    expect(await listTexts(course.id, student.id)).toEqual([]);
    await splitAtSentence(first.id, teacher.id, 1);
  });

  it("не публикует текст с ошибкой разбора", async () => {
    vi.spyOn(pdfService, "extractPdf").mockRejectedValue(new ExtractFailure("no_text_layer", "Нет слоя."));
    const { teacher, course } = await setup();
    const created = await upload(course.id, teacher.id);
    await expect(setPublished(created.id, teacher.id, true)).rejects.toBeInstanceOf(UploadError);
  });
});
