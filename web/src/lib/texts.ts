import { DisplayMode, FragmentKind, Prisma, TextStatus } from "@prisma/client";
import { AccessError, getMembership, requireCourseTeacher } from "./courses";
import { db } from "./db";
import { type FragmentData, mergeFragments, splitFragment } from "./fragments";
import { ExtractFailure, extractPdf, type FragmentLine, type Sentence } from "./pdf-service";
import { loadFile, saveFile } from "./storage";
import { localInputToDate } from "./time";

export const MAX_PDF_BYTES = 30 * 1024 * 1024;

export class UploadError extends Error {}

const KIND_FROM_SERVICE: Record<string, FragmentKind> = {
  body: FragmentKind.BODY,
  heading: FragmentKind.HEADING,
  excluded: FragmentKind.EXCLUDED,
};

export async function createTextFromPdf(params: {
  courseId: string;
  userId: string;
  title: string;
  fileName: string;
  bytes: Uint8Array;
}) {
  await requireCourseTeacher(params.courseId, params.userId);
  if (params.bytes.length === 0) throw new UploadError("Выберите PDF-файл.");
  if (params.bytes.length > MAX_PDF_BYTES) throw new UploadError("Файл больше 30 МБ.");
  if (Buffer.from(params.bytes.subarray(0, 5)).toString("latin1") !== "%PDF-") {
    throw new UploadError("Это не PDF-файл.");
  }
  const title = params.title.trim() || params.fileName.replace(/\.pdf$/i, "") || "Без названия";

  const text = await db.text.create({
    data: {
      courseId: params.courseId,
      title: title.slice(0, 300),
      pdfKey: "",
      pdfName: params.fileName.slice(0, 300),
      uploadedById: params.userId,
    },
  });
  const pdfKey = `texts/${text.id}.pdf`;
  await saveFile(pdfKey, params.bytes);
  await db.text.update({ where: { id: text.id }, data: { pdfKey } });

  await parseText(text.id, params.bytes, params.fileName);
  return text;
}

// Разбирает PDF и записывает фрагменты. Ошибку разбора сохраняет в тексте,
// чтобы преподаватель увидел её и мог повторить попытку.
async function parseText(textId: string, bytes: Uint8Array, fileName: string): Promise<void> {
  try {
    const result = await extractPdf(bytes, fileName);
    await db.$transaction([
      db.fragment.deleteMany({ where: { textId } }),
      db.fragment.createMany({
        data: result.fragments.map((f, i) => ({
          textId,
          position: i,
          kind: KIND_FROM_SERVICE[f.kind] ?? FragmentKind.BODY,
          content: f.text,
          language: f.language,
          wordCount: f.words,
          lines: f.lines,
          sentences: f.sentences,
          excludeReason: f.excludeReason ?? null,
        })),
      }),
      db.text.update({
        where: { id: textId },
        data: {
          status: TextStatus.READY,
          error: null,
          pageCount: result.pageCount,
          pages: result.pages,
          language: result.language,
        },
      }),
    ]);
  } catch (err) {
    const message = err instanceof ExtractFailure ? err.message : "Не удалось разобрать PDF.";
    if (!(err instanceof ExtractFailure)) console.error("[texts] ошибка разбора", err);
    await db.text.update({ where: { id: textId }, data: { status: TextStatus.FAILED, error: message } });
  }
}

export async function reparseText(textId: string, userId: string) {
  const text = await requireTextTeacher(textId, userId);
  if (text.publishedAt) throw new UploadError(PUBLISHED_LOCK);
  if (await db.task.count({ where: { textId } })) {
    throw new UploadError("У текста есть задания. Удалите их, чтобы разобрать текст заново.");
  }
  await db.text.update({ where: { id: textId }, data: { status: TextStatus.PROCESSING, error: null } });
  await parseText(textId, await loadFile(text.pdfKey), text.pdfName);
}

export async function requireTextTeacher(textId: string, userId: string) {
  const text = await db.text.findUnique({ where: { id: textId } });
  if (!text) throw new AccessError("Текст не найден.");
  await requireCourseTeacher(text.courseId, userId);
  return text;
}

const PUBLISHED_LOCK = "Текст опубликован. Чтобы править разбивку, снимите его с публикации.";

export async function setPublished(textId: string, userId: string, published: boolean) {
  const text = await requireTextTeacher(textId, userId);
  if (published) {
    if (text.status !== TextStatus.READY) throw new UploadError("Опубликовать можно только разобранный текст.");
    const body = await db.fragment.count({ where: { textId, kind: FragmentKind.BODY } });
    if (body === 0) throw new UploadError("В тексте нет ни одного абзаца.");
  }
  await db.text.update({
    where: { id: textId },
    data: { publishedAt: published ? (text.publishedAt ?? new Date()) : null },
  });
}

export async function listTexts(courseId: string, userId: string) {
  const membership = await getMembership(courseId, userId);
  if (!membership) return [];
  const isTeacher = membership.role === "TEACHER";
  return db.text.findMany({
    // Студент видит только опубликованные тексты.
    where: isTeacher ? { courseId } : { courseId, status: TextStatus.READY, publishedAt: { not: null } },
    orderBy: { createdAt: "asc" },
    include: { _count: { select: { fragments: { where: { kind: FragmentKind.BODY } } } } },
  });
}

export async function getTextForTeacher(textId: string, userId: string) {
  const text = await db.text.findUnique({
    where: { id: textId },
    include: { fragments: { orderBy: { position: "asc" } }, course: true },
  });
  if (!text) return null;
  const membership = await getMembership(text.courseId, userId);
  if (membership?.role !== "TEACHER") return null;
  return text;
}

// Исходный PDF: преподавателю всегда, студенту — после публикации.
export async function getTextPdfForMember(textId: string, userId: string) {
  const text = await db.text.findUnique({ where: { id: textId } });
  if (!text?.pdfKey) return null;
  const membership = await getMembership(text.courseId, userId);
  if (!membership || (membership.role !== "TEACHER" && !text.publishedAt)) return null;
  return { name: text.pdfName, data: await loadFile(text.pdfKey) };
}

export async function updateTextSettings(
  textId: string,
  userId: string,
  settings: { title: string; wordsPerMinute: number; displayMode: string; deadline?: string },
) {
  await requireTextTeacher(textId, userId);
  const title = settings.title.trim();
  if (!title) throw new UploadError("Название не может быть пустым.");
  const wpm = Math.round(settings.wordsPerMinute);
  if (!Number.isFinite(wpm) || wpm < 50 || wpm > 600)
    throw new UploadError("Норма чтения: от 50 до 600 слов в минуту.");
  const displayMode = settings.displayMode === "WEB" ? DisplayMode.WEB : DisplayMode.PDF;
  let deadline: Date | null = null;
  if (settings.deadline) {
    deadline = localInputToDate(settings.deadline);
    if (!deadline) throw new UploadError("Проверьте дату дедлайна.");
  }
  await db.text.update({
    where: { id: textId },
    data: { title: title.slice(0, 300), wordsPerMinute: wpm, displayMode, deadline },
  });
}

// Правка разбивки

type FragmentRow = Prisma.FragmentGetPayload<object>;

function toData(f: FragmentRow): FragmentData {
  return {
    content: f.content,
    wordCount: f.wordCount,
    lines: f.lines as FragmentLine[],
    sentences: f.sentences as Sentence[],
  };
}

async function requireFragmentTeacher(fragmentId: string, userId: string) {
  const fragment = await db.fragment.findUnique({ where: { id: fragmentId }, include: { text: true } });
  if (!fragment) throw new AccessError("Фрагмент не найден.");
  await requireCourseTeacher(fragment.text.courseId, userId);
  // Правка разбивки сбила бы накопленное студентами время на абзацах.
  if (fragment.text.publishedAt) throw new UploadError(PUBLISHED_LOCK);
  return fragment;
}

// Склеивает фрагмент со следующим. Исключённые фрагменты между ними (колонтитул,
// номер страницы) пропускаются: так склеивается абзац, разорванный страницей.
export async function mergeWithNext(fragmentId: string, userId: string) {
  const fragment = await requireFragmentTeacher(fragmentId, userId);
  const next = await db.fragment.findFirst({
    where: {
      textId: fragment.textId,
      position: { gt: fragment.position },
      ...(fragment.kind === FragmentKind.EXCLUDED ? {} : { kind: { not: FragmentKind.EXCLUDED } }),
    },
    orderBy: { position: "asc" },
  });
  if (!next) throw new UploadError("Это последний фрагмент.");

  const merged = mergeFragments(toData(fragment), toData(next));
  const offset = fragment.content.length + 1;
  await db.$transaction(async (tx) => {
    await tx.fragment.update({
      where: { id: fragment.id },
      data: { content: merged.content, wordCount: merged.wordCount, lines: merged.lines, sentences: merged.sentences },
    });
    // Задания второго фрагмента переезжают в склеенный; эталон выделения сдвигается.
    const moved = await tx.task.findMany({ where: { fragmentId: next.id } });
    for (const task of moved) {
      const range = task.answerRange as Sentence | null;
      await tx.task.update({
        where: { id: task.id },
        data: {
          fragmentId: fragment.id,
          ...(range ? { answerRange: [range[0] + offset, range[1] + offset] } : {}),
        },
      });
    }
    await tx.task.updateMany({ where: { sectionFragmentId: next.id }, data: { sectionFragmentId: fragment.id } });
    await tx.fragment.delete({ where: { id: next.id } });
  });
}

export async function splitAtSentence(fragmentId: string, userId: string, sentenceIndex: number) {
  const fragment = await requireFragmentTeacher(fragmentId, userId);
  const [first, second] = splitFragment(toData(fragment), sentenceIndex);
  const cut = (fragment.sentences as Sentence[])[sentenceIndex][0];

  await db.$transaction(async (tx) => {
    // Позиции идут с пропусками, поэтому сдвигаем только хвост.
    await tx.fragment.updateMany({
      where: { textId: fragment.textId, position: { gt: fragment.position } },
      data: { position: { increment: 1 } },
    });
    await tx.fragment.update({
      where: { id: fragment.id },
      data: { content: first.content, wordCount: first.wordCount, lines: first.lines, sentences: first.sentences },
    });
    const created = await tx.fragment.create({
      data: {
        textId: fragment.textId,
        position: fragment.position + 1,
        kind: fragment.kind,
        language: fragment.language,
        excludeReason: fragment.excludeReason,
        content: second.content,
        wordCount: second.wordCount,
        lines: second.lines,
        sentences: second.sentences,
      },
    });
    // Задание с эталоном во второй части уходит вместе с ним.
    const tasks = await tx.task.findMany({ where: { fragmentId: fragment.id } });
    for (const task of tasks) {
      const range = task.answerRange as Sentence | null;
      if (range && range[0] >= cut) {
        await tx.task.update({
          where: { id: task.id },
          data: { fragmentId: created.id, answerRange: [range[0] - cut, range[1] - cut] },
        });
      }
    }
  });
}

export async function setFragmentKind(fragmentId: string, userId: string, kind: string) {
  if (!(kind in FragmentKind)) throw new UploadError("Неизвестный тип фрагмента.");
  await requireFragmentTeacher(fragmentId, userId);
  if (kind !== FragmentKind.BODY && (await db.task.count({ where: { fragmentId } }))) {
    throw new UploadError("К абзацу привязано задание: сначала удалите его.");
  }
  if (kind !== FragmentKind.HEADING && (await db.task.count({ where: { sectionFragmentId: fragmentId } }))) {
    throw new UploadError("По этому разделу раскидано задание: сначала удалите его.");
  }
  await db.fragment.update({
    where: { id: fragmentId },
    data: { kind: kind as FragmentKind, ...(kind === FragmentKind.EXCLUDED ? {} : { excludeReason: null }) },
  });
}
