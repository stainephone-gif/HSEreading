import { FragmentKind } from "@prisma/client";
import { getMembership, requireCourseTeacher } from "./courses";
import { db } from "./db";
import { creditAllowance, creditFor, thresholdMs } from "./dwell-rules";
import type { FragmentLine } from "./pdf-service";
import { ensurePlacements, getStudentTasks, type StudentTasks } from "./tasks";

// Сервер засчитывает не больше времени, чем прошло по его часам (dwell-rules.ts).
const MAX_CLAIMS = 200;

export { BEAT_INTERVAL_MS, MAX_CREDIT_MS, thresholdMs } from "./dwell-rules";

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
};

export async function getReaderData(textId: string, userId: string): Promise<ReaderData | null> {
  const text = await db.text.findUnique({
    where: { id: textId },
    include: {
      fragments: { where: { kind: { in: [FragmentKind.BODY, FragmentKind.HEADING] } }, orderBy: { position: "asc" } },
    },
  });
  if (!text || text.status !== "READY") return null;
  const membership = await getMembership(text.courseId, userId);
  if (!membership) return null;
  const preview = membership.role === "TEACHER";
  if (!preview && !text.publishedAt) return null;

  const dwells = preview
    ? []
    : await db.dwell.findMany({
        where: { userId, fragment: { textId } },
        select: { fragmentId: true, ms: true, readAt: true },
      });
  // Места раскиданных заданий закрепляются при первом открытии текста.
  if (!preview) await ensurePlacements(textId, userId);
  const previewTasks = preview
    ? await db.task.findMany({
        where: { textId, mode: "ANCHORED" },
        select: { id: true, fragmentId: true, prompt: true },
        orderBy: { createdAt: "asc" },
      })
    : [];

  return {
    textId: text.id,
    courseId: text.courseId,
    title: text.title,
    displayMode: text.displayMode,
    language: text.language ?? "ru",
    blocks: text.fragments.map((f) => ({ id: f.id, kind: f.kind as ReaderBlock["kind"], content: f.content })),
    pages: text.pages as ReaderData["pages"],
    fragments: text.fragments
      .filter((f) => f.kind === FragmentKind.BODY)
      .map((f) => ({
        id: f.id,
        // Смещения строк читалке не нужны.
        lines: (f.lines as FragmentLine[]).map(({ page, bbox }) => ({ page, bbox })),
        thresholdMs: thresholdMs(f.wordCount, text.wordsPerMinute),
      })),
    preview,
    dwellMs: Object.fromEntries(dwells.map((d) => [d.fragmentId, d.ms])),
    readIds: dwells.filter((d) => d.readAt).map((d) => d.fragmentId),
    tasks: preview ? null : await getStudentTasks(textId, userId),
    previewTasks: previewTasks.map((t) => ({ id: t.id, fragmentId: t.fragmentId!, prompt: t.prompt })),
  };
}

export type DwellResult = { ok: false } | { ok: true; readIds: string[]; tasks: StudentTasks };

// Принимает отчёт читалки: сколько миллисекунд каждый фрагмент был в зоне чтения.
export async function recordDwell(
  textId: string,
  userId: string,
  claims: Record<string, number>,
  now = new Date(),
): Promise<DwellResult> {
  const text = await db.text.findUnique({ where: { id: textId } });
  if (!text?.publishedAt) return { ok: false };
  const membership = await getMembership(text.courseId, userId);
  if (membership?.role !== "STUDENT") return { ok: false };

  const claimedIds = Object.keys(claims).slice(0, MAX_CLAIMS);
  const fragments = claimedIds.length
    ? await db.fragment.findMany({
        where: { textId, kind: FragmentKind.BODY, id: { in: claimedIds } },
        select: { id: true, wordCount: true },
      })
    : [];

  await db.$transaction(async (tx) => {
    // Курсор блокируется на время транзакции: два одновременных отчёта (две
    // вкладки) не получат одно и то же время дважды.
    const created = await tx.$executeRaw`
      INSERT INTO "ReadingCursor" ("userId", "textId", "firstOpenedAt", "lastBeatAt")
      VALUES (${userId}, ${textId}, ${now}, ${now})
      ON CONFLICT DO NOTHING`;
    const [cursor] = await tx.$queryRaw<{ lastBeatAt: Date }[]>`
      SELECT "lastBeatAt" FROM "ReadingCursor"
      WHERE "userId" = ${userId} AND "textId" = ${textId}
      FOR UPDATE`;

    const elapsed = created ? 0 : Math.max(0, now.getTime() - cursor.lastBeatAt.getTime());
    const allowance = created ? 0 : creditAllowance(elapsed);
    if (!created) {
      await tx.readingCursor.update({ where: { userId_textId: { userId, textId } }, data: { lastBeatAt: now } });
    }
    if (allowance === 0) return;

    let active = 0;
    for (const f of fragments) {
      const credit = creditFor(claims[f.id], allowance);
      if (credit === 0) continue;
      active = Math.max(active, credit);
      const dwell = await tx.dwell.upsert({
        where: { userId_fragmentId: { userId, fragmentId: f.id } },
        create: { userId, fragmentId: f.id, ms: credit },
        update: { ms: { increment: credit } },
      });
      if (!dwell.readAt && dwell.ms >= thresholdMs(f.wordCount, text.wordsPerMinute)) {
        await tx.dwell.update({
          where: { userId_fragmentId: { userId, fragmentId: f.id } },
          data: { readAt: now },
        });
      }
    }
    // Абзацы в зоне одновременно, поэтому время чтения — максимум, а не сумма.
    if (active > 0) {
      await tx.readingCursor.update({
        where: { userId_textId: { userId, textId } },
        data: { activeMs: { increment: active } },
      });
    }
  });

  const read = await db.dwell.findMany({
    where: { userId, readAt: { not: null }, fragment: { textId } },
    select: { fragmentId: true },
  });
  return { ok: true, readIds: read.map((d) => d.fragmentId), tasks: await getStudentTasks(textId, userId, now) };
}

export type ReadingSummaryRow = {
  userId: string;
  name: string | null;
  email: string;
  openedAt: Date | null;
  readCount: number;
  minutes: number;
};

// Сводка для преподавателя: сколько абзацев дочитал каждый студент.
export async function getReadingSummary(textId: string, teacherId: string) {
  const text = await db.text.findUniqueOrThrow({ where: { id: textId } });
  await requireCourseTeacher(text.courseId, teacherId);

  const [students, cursors, totals, bodyCount] = await Promise.all([
    db.courseMember.findMany({
      where: { courseId: text.courseId, role: "STUDENT" },
      include: { user: true },
      orderBy: { joinedAt: "asc" },
    }),
    db.readingCursor.findMany({ where: { textId } }),
    db.$queryRaw<{ userId: string; read: bigint }[]>`
      SELECT d."userId", COUNT(d."readAt") AS read
      FROM "Dwell" d JOIN "Fragment" f ON f.id = d."fragmentId"
      WHERE f."textId" = ${textId} AND f.kind = ${FragmentKind.BODY}::"FragmentKind"
      GROUP BY d."userId"`,
    db.fragment.count({ where: { textId, kind: FragmentKind.BODY } }),
  ]);

  const byCursor = new Map(cursors.map((c) => [c.userId, c]));
  const byUser = new Map(totals.map((t) => [t.userId, t]));
  const rows: ReadingSummaryRow[] = students.map(({ user }) => ({
    userId: user.id,
    name: user.name,
    email: user.email,
    openedAt: byCursor.get(user.id)?.firstOpenedAt ?? null,
    readCount: Number(byUser.get(user.id)?.read ?? 0),
    minutes: Math.round((byCursor.get(user.id)?.activeMs ?? 0) / 60_000),
  }));
  return { bodyCount, rows };
}
