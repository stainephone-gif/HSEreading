// Офлайн-читалка (киоск): выгрузка текста в один HTML-файл и загрузка отчётов
// студентов обратно в курс.

import { createHash, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { AnswerFormat, FragmentKind, Grade, Prisma, TaskMode } from "@prisma/client";
import nacl from "tweetnacl";
import { z } from "zod";
import { selectionMatches, shortAnswerError } from "./answer-rules";
import { AccessError } from "./courses";
import { db } from "./db";
import { thresholdMs } from "./dwell-rules";
import { KIOSK_VERSION, type KioskData, type KioskTask, normalizeStudent } from "./kiosk-engine";
import { openReport, packKeys, parseReportFile, ReportError, toBase64 } from "./kiosk-crypto";
import type { FragmentLine, Sentence } from "./pdf-service";
import type { ReaderBlock } from "./reading";
import { loadFile } from "./storage";
import { type ChoiceOption, scatterCandidates } from "./tasks";
import { requireTextTeacher, UploadError } from "./texts";
import { formatDateTime } from "./time";

// Выгрузка

export async function createKioskExport(textId: string, teacherId: string): Promise<{ data: KioskData; pdf: Buffer }> {
  const text = await requireTextTeacher(textId, teacherId);
  if (text.status !== "READY" || !text.publishedAt) {
    throw new UploadError("Офлайн-читалку можно скачать только для опубликованного текста.");
  }
  const [fragments, tasks] = await Promise.all([
    db.fragment.findMany({ where: { textId }, orderBy: { position: "asc" } }),
    db.task.findMany({ where: { textId }, orderBy: { createdAt: "asc" } }),
  ]);
  const byId = new Map(fragments.map((f) => [f.id, f]));

  const keys = { mac: new Uint8Array(randomBytes(32)), local: new Uint8Array(randomBytes(32)) };
  const pair = nacl.box.keyPair();
  const exp = await db.kioskExport.create({
    data: {
      textId,
      createdById: teacherId,
      publicKey: Buffer.from(pair.publicKey),
      secretKey: Buffer.from(pair.secretKey),
      macKey: Buffer.from(keys.mac),
      localKey: Buffer.from(keys.local),
    },
  });

  const selections: KioskData["selections"] = {};
  const kioskTasks = tasks.map((t): KioskTask => {
    if (t.format === AnswerFormat.SELECTION && t.fragmentId) {
      const f = byId.get(t.fragmentId)!;
      selections[f.id] = { content: f.content, lines: f.lines as FragmentLine[], sentences: f.sentences as Sentence[] };
    }
    return {
      id: t.id,
      format: t.format,
      prompt: t.prompt,
      // Верный вариант в файл не попадает.
      options: t.format === AnswerFormat.CHOICE ? (t.options as ChoiceOption[]).map((o) => o.text) : null,
      fragmentId: t.fragmentId,
      candidates: t.mode === TaskMode.SCATTERED ? scatterCandidates(t, fragments) : null,
    };
  });

  const readable = fragments.filter((f) => f.kind !== FragmentKind.EXCLUDED);
  const data: KioskData = {
    v: KIOSK_VERSION,
    exportId: exp.id,
    textId,
    title: text.title,
    displayMode: text.displayMode,
    language: text.language ?? "ru",
    blocks: readable.map((f) => ({ id: f.id, kind: f.kind as ReaderBlock["kind"], content: f.content })),
    pages: text.pages as KioskData["pages"],
    fragments: readable
      .filter((f) => f.kind === FragmentKind.BODY)
      .map((f) => ({
        id: f.id,
        lines: (f.lines as FragmentLine[]).map(({ page, bbox }) => ({ page, bbox })),
        thresholdMs: thresholdMs(f.wordCount, text.wordsPerMinute),
      })),
    tasks: kioskTasks,
    selections,
    deadline: text.deadline?.toISOString() ?? null,
    deadlineLabel: text.deadline ? `Ответы до ${formatDateTime(text.deadline)}` : null,
    publicKey: toBase64(pair.publicKey),
    keys: packKeys(exp.id, keys),
    exportedAt: exp.createdAt.toISOString(),
  };
  return { data, pdf: await loadFile(text.pdfKey) };
}

// Собранная читалка (npm run build:kiosk). turbopackIgnore: путь известен только
// при запуске, как у хранилища файлов.
export async function loadKioskBundle(): Promise<{ js: string; css: string }> {
  const dir = path.resolve(/* turbopackIgnore: true */ process.env.KIOSK_DIST ?? "./kiosk-dist");
  try {
    const [js, css] = await Promise.all([
      readFile(path.join(dir, "kiosk.js"), "utf8"),
      readFile(path.join(dir, "kiosk.css"), "utf8"),
    ]);
    return { js, css };
  } catch {
    throw new UploadError("Офлайн-читалка не собрана: выполните npm run build:kiosk.");
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

// Один самодостаточный HTML: данные, PDF, скрипт и стили внутри, сеть не нужна.
export function renderKioskHtml(params: { data: KioskData; pdf: Uint8Array; js: string; css: string }): string {
  const json = JSON.stringify(params.data).replace(/</g, "\\u003c");
  const js = params.js.replace(/<\/(script)/gi, "<\\/$1");
  const css = params.css.replace(/<\/(style)/gi, "<\\/$1");
  return `<!doctype html>
<html lang="${escapeHtml(params.data.language)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(params.data.title)} — Поля</title>
<style>${css}</style>
</head>
<body>
<div id="root"><p style="padding:24px">Читалка загружается… Если это сообщение не исчезает, откройте файл в Chrome, Firefox, Edge или Safari.</p></div>
<script type="application/json" id="polya-data">${json}</script>
<script type="application/octet-stream" id="polya-pdf">${Buffer.from(params.pdf).toString("base64")}</script>
<script>${js}</script>
</body>
</html>
`;
}

export function kioskFileName(title: string): string {
  return `${
    title
      .replace(/[\\/:*?"<>|\n\r]+/g, " ")
      .trim()
      .slice(0, 100) || "Текст"
  } — офлайн-читалка.html`;
}

// Загрузка отчётов

const id = z.string().max(40);
const payloadSchema = z.object({
  v: z.literal(KIOSK_VERSION),
  exportId: id,
  instanceId: z.string().max(64),
  student: z.object({ name: z.string().max(500), email: z.string().max(500) }),
  firstOpenedAt: z.number().finite(),
  savedAt: z.number().finite(),
  activeMs: z.number().finite().nonnegative(),
  dwell: z.record(id, z.number().finite().nonnegative()),
  readAt: z.record(id, z.number().finite()),
  placements: z.record(id, id),
  answers: z.record(id, z.object({ value: z.unknown(), at: z.number().finite() })),
});

export type ImportResult = {
  file: string;
  ok: boolean;
  // Ошибка или «уже загружен».
  message?: string;
  student?: { name: string; email: string };
  readCount?: number;
  answers?: number;
  // Ответы, сохранённые после дедлайна по часам студента: не засчитаны.
  late?: number;
};

const MAX_REPORT_BYTES = 2 * 1024 * 1024;

export async function importKioskReports(
  textId: string,
  teacherId: string,
  files: { name: string; content: string }[],
  now = new Date(),
): Promise<ImportResult[]> {
  await requireTextTeacher(textId, teacherId);
  const results: ImportResult[] = [];
  for (const file of files) {
    try {
      results.push({ file: file.name, ok: true, ...(await importOne(textId, file.content, now)) });
    } catch (err) {
      if (!(err instanceof ReportError || err instanceof UploadError || err instanceof AccessError)) throw err;
      results.push({ file: file.name, ok: false, message: err.message });
    }
  }
  return results;
}

async function importOne(textId: string, content: string, now: Date): Promise<Omit<ImportResult, "file" | "ok">> {
  if (content.length > MAX_REPORT_BYTES) throw new ReportError("Файл слишком большой для отчёта.");
  const parsed = parseReportFile(content);
  if (!parsed) throw new ReportError("Это не отчёт офлайн-читалки.");
  const exp = await db.kioskExport.findUnique({ where: { id: parsed.exportId } });
  if (!exp) throw new ReportError("Отчёт от неизвестной выгрузки: возможно, читалку скачивали на другом сервере.");
  if (exp.textId !== textId) throw new ReportError("Отчёт относится к другому тексту.");

  const raw = openReport(parsed.sealed, new Uint8Array(exp.secretKey), new Uint8Array(exp.macKey));
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new ReportError("Файл повреждён.");
  }
  const result = payloadSchema.safeParse(json);
  if (!result.success || result.data.exportId !== exp.id) throw new ReportError("Файл повреждён.");
  const report = result.data;
  const student = normalizeStudent(report.student);
  if (typeof student === "string") throw new ReportError(`В отчёте неверные данные студента: ${student}`);

  const digest = createHash("sha256").update(content).digest("hex");
  if (await db.kioskReport.findUnique({ where: { digest } })) {
    return { message: "Этот файл уже загружен.", student };
  }

  return db.$transaction((tx) => mergeReport(tx, { textId, exportId: exp.id, digest, report, student, now }), {
    timeout: 60_000,
  });
}

type Payload = z.infer<typeof payloadSchema>;

async function mergeReport(
  tx: Prisma.TransactionClient,
  p: {
    textId: string;
    exportId: string;
    digest: string;
    report: Payload;
    student: { name: string; email: string };
    now: Date;
  },
) {
  const { textId, report, student, now } = p;
  const text = await tx.text.findUniqueOrThrow({ where: { id: textId } });

  // Студент находится по почте; новый становится участником курса.
  let user = await tx.user.findUnique({ where: { email: student.email } });
  user ??= await tx.user.create({ data: { email: student.email, name: student.name } });
  if (!user.name) user = await tx.user.update({ where: { id: user.id }, data: { name: student.name } });
  const userId = user.id;
  const membership = await tx.courseMember.findUnique({
    where: { courseId_userId: { courseId: text.courseId, userId } },
  });
  if (membership?.role === "TEACHER") throw new ReportError(`${student.email} — преподаватель курса, а не студент.`);
  if (!membership) await tx.courseMember.create({ data: { courseId: text.courseId, userId, role: "STUDENT" } });

  // Время по часам студента не может быть позже загрузки.
  const clamp = (ms: number) => new Date(Math.min(ms, now.getTime()));
  const savedAt = clamp(report.savedAt);

  const fragments = await tx.fragment.findMany({
    where: { textId },
    select: { id: true, position: true, kind: true, lines: true, sentences: true, wordCount: true },
  });
  const byId = new Map(fragments.map((f) => [f.id, f]));
  const existing = new Map(
    (await tx.dwell.findMany({ where: { userId, fragment: { textId } } })).map((d) => [d.fragmentId, d]),
  );

  // Время абзаца не больше общего времени в читалке. Отчёты сливаются по
  // максимуму: старый отчёт, загруженный после нового, ничего не убавит.
  const readSet = new Set([...existing.values()].filter((d) => d.readAt).map((d) => d.fragmentId));
  const creates: Prisma.DwellCreateManyInput[] = [];
  for (const [fragmentId, claimed] of Object.entries(report.dwell)) {
    const f = byId.get(fragmentId);
    if (f?.kind !== FragmentKind.BODY) continue;
    const ms = Math.round(Math.min(claimed, report.activeMs));
    const prev = existing.get(fragmentId);
    const total = Math.max(prev?.ms ?? 0, ms);
    const readAt =
      prev?.readAt ??
      (total >= thresholdMs(f.wordCount, text.wordsPerMinute)
        ? clamp(report.readAt[fragmentId] ?? report.savedAt)
        : null);
    if (readAt) readSet.add(fragmentId);
    if (!prev) {
      if (total > 0) creates.push({ userId, fragmentId, ms: total, readAt });
    } else if (total !== prev.ms || readAt !== prev.readAt) {
      await tx.dwell.update({ where: { userId_fragmentId: { userId, fragmentId } }, data: { ms: total, readAt } });
    }
  }
  if (creates.length) await tx.dwell.createMany({ data: creates });

  const cursor = await tx.readingCursor.findUnique({ where: { userId_textId: { userId, textId } } });
  const firstOpenedAt = clamp(report.firstOpenedAt);
  if (!cursor) {
    await tx.readingCursor.create({
      data: { userId, textId, firstOpenedAt, lastBeatAt: savedAt, activeMs: Math.round(report.activeMs) },
    });
  } else {
    await tx.readingCursor.update({
      where: { userId_textId: { userId, textId } },
      data: {
        firstOpenedAt: firstOpenedAt < cursor.firstOpenedAt ? firstOpenedAt : cursor.firstOpenedAt,
        activeMs: Math.max(cursor.activeMs, Math.round(report.activeMs)),
      },
    });
  }

  // Места раскиданных заданий: из отчёта, если студент ещё не открывал текст в
  // приложении. Место проверяется: оно должно быть внутри раздела задания.
  const tasks = await tx.task.findMany({
    where: { textId },
    include: { placements: { where: { userId } }, answers: { where: { userId } } },
  });
  const placementOf = new Map<string, string>();
  for (const t of tasks) {
    if (t.mode !== TaskMode.SCATTERED) continue;
    const reported = report.placements[t.id];
    const valid = reported && scatterCandidates(t, fragments).includes(reported) ? reported : null;
    const kept = t.placements[0]?.fragmentId ?? valid;
    if (!kept) continue;
    if (!t.placements[0]) await tx.taskPlacement.create({ data: { taskId: t.id, userId, fragmentId: kept } });
    placementOf.set(t.id, kept);
  }

  let answers = 0;
  let late = 0;
  for (const t of tasks) {
    const sent = report.answers[t.id];
    if (!sent) continue;
    const fragmentId = t.fragmentId ?? placementOf.get(t.id);
    if (!fragmentId || !readSet.has(fragmentId)) continue;
    const at = clamp(sent.at);
    if (text.deadline && at > text.deadline) {
      late++;
      continue;
    }
    const graded = gradeKioskAnswer(t, byId.get(fragmentId)?.sentences as Sentence[] | undefined, sent.value);
    if (!graded) continue;
    answers++;
    const prev = t.answers[0];
    // Ответ тот же: оценка преподавателя за короткий ответ сохраняется.
    if (prev && JSON.stringify(prev.value) === JSON.stringify(graded.value)) continue;
    // Более поздний ответ (в приложении или в другом отчёте) не перезаписывается.
    if (prev && prev.updatedAt >= at) continue;
    const data = { value: graded.value, grade: graded.grade, gradedAt: graded.grade ? now : null, updatedAt: at };
    await tx.answer.upsert({
      where: { taskId_userId: { taskId: t.id, userId } },
      create: { taskId: t.id, userId, submittedAt: at, ...data },
      update: data,
    });
  }

  const readCount = Object.keys(report.dwell).filter((fid) => readSet.has(fid)).length;
  await tx.kioskReport.create({
    data: {
      exportId: p.exportId,
      userId,
      instanceId: report.instanceId,
      savedAt,
      readCount,
      answerCount: answers,
      digest: p.digest,
    },
  });
  return { student, readCount, answers, late };
}

// Ответ из киоска в том же виде, что сохраняет приложение, и его оценка.
function gradeKioskAnswer(
  task: { format: AnswerFormat; options: Prisma.JsonValue; answerRange: Prisma.JsonValue },
  sentences: Sentence[] | undefined,
  raw: unknown,
): { value: Prisma.InputJsonValue; grade: Grade | null } | null {
  const v = (raw ?? {}) as { choice?: unknown; range?: unknown; text?: unknown };
  if (task.format === AnswerFormat.CHOICE) {
    const options = task.options as ChoiceOption[];
    const choice = Number(v.choice);
    if (!Number.isInteger(choice) || !options[choice]) return null;
    return { value: { choice }, grade: options[choice].correct ? Grade.PASS : Grade.FAIL };
  }
  if (task.format === AnswerFormat.SELECTION) {
    const r = v.range;
    // Выделять можно только целое предложение абзаца.
    const range = Array.isArray(r) ? sentences?.find(([s, e]) => s === r[0] && e === r[1]) : undefined;
    if (!range) return null;
    return { value: { range }, grade: selectionMatches(range, task.answerRange as Sentence) ? Grade.PASS : Grade.FAIL };
  }
  const text = typeof v.text === "string" ? v.text.trim() : "";
  if (shortAnswerError(text)) return null;
  return { value: { text }, grade: null };
}

export async function listKioskImports(textId: string, teacherId: string) {
  await requireTextTeacher(textId, teacherId);
  const [exports, reports] = await Promise.all([
    db.kioskExport.count({ where: { textId } }),
    db.kioskReport.findMany({
      where: { export: { textId } },
      include: { user: { select: { name: true, email: true } } },
      orderBy: { importedAt: "desc" },
      take: 50,
    }),
  ]);
  return { exports, reports };
}
