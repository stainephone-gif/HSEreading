import { randomInt } from "node:crypto";
import { AnswerFormat, FragmentKind, Grade, Prisma, TaskMode } from "@prisma/client";
import { z } from "zod";
import { getMembership, requireCourseTeacher } from "./courses";
import { db } from "./db";
import type { FragmentLine, Sentence } from "./pdf-service";
import { requireTextTeacher, UploadError } from "./texts";

export type ChoiceOption = { text: string; correct: boolean };

const prompt = z.string().trim().min(1, "Напишите задание.").max(2000, "Задание длиннее 2000 знаков.");

export const taskInput = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("anchored-choice"),
    fragmentId: z.string(),
    prompt,
    options: z
      .array(z.object({ text: z.string().trim().min(1, "Пустой вариант ответа.").max(500), correct: z.boolean() }))
      .min(2, "Нужно хотя бы два варианта.")
      .max(6, "Не больше шести вариантов.")
      .refine((o) => o.filter((x) => x.correct).length === 1, "Отметьте один верный вариант."),
  }),
  z.object({ kind: z.literal("anchored-selection"), fragmentId: z.string(), prompt, sentenceIndex: z.number().int() }),
  z.object({ kind: z.literal("anchored-short"), fragmentId: z.string(), prompt }),
  z.object({ kind: z.literal("scattered-section"), sectionFragmentId: z.string(), prompt }),
  z.object({ kind: z.literal("scattered-pages"), pageFrom: z.number().int(), pageTo: z.number().int(), prompt }),
]);
export type TaskInput = z.infer<typeof taskInput>;

type FragmentRow = { id: string; position: number; kind: FragmentKind; lines: Prisma.JsonValue };

function firstPage(f: FragmentRow): number {
  return ((f.lines as FragmentLine[])[0]?.page ?? 0) + 1;
}

// Абзацы, по которым раскидывается задание.
export function scatterCandidates(
  task: { sectionFragmentId: string | null; pageFrom: number | null; pageTo: number | null },
  fragments: FragmentRow[],
): string[] {
  const ordered = [...fragments].sort((a, b) => a.position - b.position);
  if (task.sectionFragmentId) {
    const start = ordered.findIndex((f) => f.id === task.sectionFragmentId);
    if (start < 0) return [];
    const result: string[] = [];
    for (const f of ordered.slice(start + 1)) {
      if (f.kind === FragmentKind.HEADING) break;
      if (f.kind === FragmentKind.BODY) result.push(f.id);
    }
    return result;
  }
  const from = task.pageFrom ?? 1;
  const to = task.pageTo ?? from;
  return ordered
    .filter((f) => f.kind === FragmentKind.BODY && firstPage(f) >= from && firstPage(f) <= to)
    .map((f) => f.id);
}

// Засчитывается выделение, которое пересекается с эталоном больше чем наполовину.
export function selectionMatches(selected: Sentence, reference: Sentence): boolean {
  const overlap = Math.min(selected[1], reference[1]) - Math.max(selected[0], reference[0]);
  const longest = Math.max(selected[1] - selected[0], reference[1] - reference[0]);
  return overlap > 0 && overlap * 2 > longest;
}

export function countSentences(text: string): number {
  return text.split(/[.!?…]+(?:["»”)]*)(?:\s+|$)/).filter((s) => s.trim()).length;
}

// Преподаватель

export async function createTask(textId: string, userId: string, raw: unknown) {
  const text = await requireTextTeacher(textId, userId);
  const parsed = taskInput.safeParse(raw);
  if (!parsed.success) throw new UploadError(parsed.error.issues[0]?.message ?? "Проверьте задание.");
  const input = parsed.data;
  const fragments = await db.fragment.findMany({
    where: { textId },
    select: { id: true, position: true, kind: true, lines: true, sentences: true },
  });
  const byId = new Map(fragments.map((f) => [f.id, f]));

  const base = { textId, prompt: input.prompt };
  if (input.kind === "anchored-choice" || input.kind === "anchored-selection" || input.kind === "anchored-short") {
    const fragment = byId.get(input.fragmentId);
    if (fragment?.kind !== FragmentKind.BODY) throw new UploadError("Выберите абзац текста.");
    const anchored = { ...base, mode: TaskMode.ANCHORED, fragmentId: fragment.id };
    if (input.kind === "anchored-choice") {
      return db.task.create({ data: { ...anchored, format: AnswerFormat.CHOICE, options: input.options } });
    }
    if (input.kind === "anchored-selection") {
      const range = (fragment.sentences as Sentence[])[input.sentenceIndex];
      if (!range) throw new UploadError("Выберите эталонное предложение.");
      return db.task.create({ data: { ...anchored, format: AnswerFormat.SELECTION, answerRange: range } });
    }
    return db.task.create({ data: { ...anchored, format: AnswerFormat.SHORT } });
  }

  // Раскиданное задание работает на любом абзаце диапазона, поэтому только короткий ответ.
  const range =
    input.kind === "scattered-section"
      ? { sectionFragmentId: input.sectionFragmentId, pageFrom: null, pageTo: null }
      : { sectionFragmentId: null, pageFrom: input.pageFrom, pageTo: input.pageTo };
  if (input.kind === "scattered-section" && byId.get(input.sectionFragmentId)?.kind !== FragmentKind.HEADING) {
    throw new UploadError("Выберите раздел.");
  }
  if (
    input.kind === "scattered-pages" &&
    (input.pageFrom < 1 || input.pageTo < input.pageFrom || input.pageTo > text.pageCount)
  ) {
    throw new UploadError(`Страницы: от 1 до ${text.pageCount}, начало не позже конца.`);
  }
  if (scatterCandidates(range, fragments).length === 0)
    throw new UploadError("В выбранном диапазоне нет ни одного абзаца.");
  return db.task.create({ data: { ...base, ...range, mode: TaskMode.SCATTERED, format: AnswerFormat.SHORT } });
}

export async function deleteTask(taskId: string, userId: string) {
  const task = await db.task.findUnique({ where: { id: taskId } });
  if (!task) throw new UploadError("Задание не найдено.");
  await requireTextTeacher(task.textId, userId);
  await db.task.delete({ where: { id: taskId } });
}

export async function gradeAnswer(taskId: string, studentId: string, teacherId: string, grade: Grade | null) {
  const task = await db.task.findUnique({ where: { id: taskId }, include: { text: true } });
  if (!task) throw new UploadError("Задание не найдено.");
  await requireCourseTeacher(task.text.courseId, teacherId);
  if (task.format !== AnswerFormat.SHORT) throw new UploadError("Этот ответ проверяется автоматически.");
  await db.answer.update({
    where: { taskId_userId: { taskId, userId: studentId } },
    data: { grade, gradedAt: grade ? new Date() : null },
  });
}

export type TeacherTask = Awaited<ReturnType<typeof listTasksForTeacher>>[number];

export async function listTasksForTeacher(textId: string, teacherId: string) {
  const text = await requireTextTeacher(textId, teacherId);
  const [tasks, fragments, students] = await Promise.all([
    db.task.findMany({
      where: { textId },
      orderBy: { createdAt: "asc" },
      include: {
        placements: true,
        answers: {
          include: { user: { select: { id: true, name: true, email: true } } },
          orderBy: { submittedAt: "asc" },
        },
      },
    }),
    db.fragment.findMany({
      where: { textId },
      select: { id: true, position: true, kind: true, lines: true, content: true },
    }),
    db.courseMember.findMany({ where: { courseId: text.courseId, role: "STUDENT" }, select: { userId: true } }),
  ]);
  const byId = new Map(fragments.map((f) => [f.id, f]));
  const studentIds = students.map((s) => s.userId);
  const read = await db.dwell.findMany({
    where: { userId: { in: studentIds }, readAt: { not: null }, fragment: { textId } },
    select: { userId: true, fragmentId: true },
  });
  const readSet = new Set(read.map((d) => `${d.userId}:${d.fragmentId}`));

  return tasks.map((t) => {
    const fragment = t.fragmentId ? byId.get(t.fragmentId) : undefined;
    const section = t.sectionFragmentId ? byId.get(t.sectionFragmentId) : undefined;
    const placementOf = new Map(t.placements.map((p) => [p.userId, p.fragmentId]));
    const found = studentIds.filter((u) => {
      const fid = t.fragmentId ?? placementOf.get(u);
      return fid && readSet.has(`${u}:${fid}`);
    }).length;
    return {
      id: t.id,
      mode: t.mode,
      format: t.format,
      prompt: t.prompt,
      options: (t.options as ChoiceOption[] | null) ?? null,
      reference:
        t.format === AnswerFormat.SELECTION && fragment ? fragment.content.slice(...(t.answerRange as Sentence)) : null,
      where: fragment
        ? `стр. ${firstPage(fragment)}: «${fragment.content.slice(0, 60)}…»`
        : section
          ? `раздел «${section.content}»`
          : `стр. ${t.pageFrom}–${t.pageTo}`,
      found,
      students: studentIds.length,
      answers: t.answers.map((a) => ({
        userId: a.userId,
        name: a.user.name ?? a.user.email,
        value: answerText(t, a.value, (fragment ?? byId.get(placementOf.get(a.userId) ?? ""))?.content),
        grade: a.grade,
        updatedAt: a.updatedAt,
      })),
    };
  });
}

function answerText(
  task: { format: AnswerFormat; options: Prisma.JsonValue },
  value: Prisma.JsonValue,
  content: string | undefined,
): string {
  const v = value as { choice?: number; range?: Sentence; text?: string };
  if (task.format === AnswerFormat.CHOICE) return (task.options as ChoiceOption[])[v.choice ?? -1]?.text ?? "—";
  if (task.format === AnswerFormat.SELECTION) return content && v.range ? content.slice(...v.range) : "—";
  return v.text ?? "";
}

// Студент

// Закрепляет за студентом абзацы раскиданных заданий. Вызывается при открытии
// текста; уже закреплённые места не меняются. Два задания стараются не попасть
// в один абзац.
export async function ensurePlacements(textId: string, userId: string): Promise<void> {
  const tasks = await db.task.findMany({
    where: { textId },
    orderBy: { createdAt: "asc" },
    include: { placements: { where: { userId } } },
  });
  const missing = tasks.filter((t) => t.mode === TaskMode.SCATTERED && t.placements.length === 0);
  if (missing.length === 0) return;

  const fragments = await db.fragment.findMany({
    where: { textId },
    select: { id: true, position: true, kind: true, lines: true },
  });
  const used = new Set<string>();
  for (const t of tasks) {
    if (t.fragmentId) used.add(t.fragmentId);
    for (const p of t.placements) used.add(p.fragmentId);
  }
  const rows: { taskId: string; userId: string; fragmentId: string }[] = [];
  for (const t of missing) {
    const candidates = scatterCandidates(t, fragments);
    if (candidates.length === 0) continue;
    const free = candidates.filter((id) => !used.has(id));
    const pool = free.length ? free : candidates;
    const fragmentId = pool[randomInt(pool.length)];
    used.add(fragmentId);
    rows.push({ taskId: t.id, userId, fragmentId });
  }
  // Две вкладки, открытые одновременно: вторая запись тихо пропускается.
  await db.taskPlacement.createMany({ data: rows, skipDuplicates: true });
}

export type StudentTask = {
  id: string;
  fragmentId: string;
  format: AnswerFormat;
  prompt: string;
  options: string[] | null;
  // Для ответа выделением: текст абзаца, его строки и предложения.
  selection: { content: string; lines: FragmentLine[]; sentences: Sentence[] } | null;
  answer: { choice?: number; range?: Sentence; text?: string } | null;
  // Результат виден только после дедлайна.
  grade: Grade | null;
};

export type StudentTasks = { total: number; found: StudentTask[]; deadline: Date | null; closed: boolean };

// Найденные студентом задания: те, чей абзац у него уже дочитан. О ненайденных
// студент знает только их число.
export async function getStudentTasks(textId: string, userId: string, now = new Date()): Promise<StudentTasks> {
  const text = await db.text.findUniqueOrThrow({ where: { id: textId } });
  const tasks = await db.task.findMany({
    where: { textId },
    include: { placements: { where: { userId } }, answers: { where: { userId } } },
  });
  const fragmentOf = new Map(tasks.map((t) => [t.id, t.fragmentId ?? t.placements[0]?.fragmentId ?? null]));
  const fragmentIds = [...new Set([...fragmentOf.values()].filter((x): x is string => Boolean(x)))];
  const [read, fragments] = await Promise.all([
    db.dwell.findMany({
      where: { userId, readAt: { not: null }, fragmentId: { in: fragmentIds } },
      select: { fragmentId: true },
    }),
    db.fragment.findMany({ where: { id: { in: fragmentIds } } }),
  ]);
  const readSet = new Set(read.map((d) => d.fragmentId));
  const fragmentById = new Map(fragments.map((f) => [f.id, f]));
  const closed = Boolean(text.deadline && text.deadline <= now);

  const found = tasks
    .filter((t) => readSet.has(fragmentOf.get(t.id) ?? ""))
    .map((t): StudentTask & { position: number } => {
      const fragment = fragmentById.get(fragmentOf.get(t.id)!)!;
      const answer = t.answers[0];
      return {
        id: t.id,
        position: fragment.position,
        fragmentId: fragment.id,
        format: t.format,
        prompt: t.prompt,
        // Верный вариант студенту не отдаётся.
        options: t.format === AnswerFormat.CHOICE ? (t.options as ChoiceOption[]).map((o) => o.text) : null,
        selection:
          t.format === AnswerFormat.SELECTION
            ? {
                content: fragment.content,
                lines: fragment.lines as FragmentLine[],
                sentences: fragment.sentences as Sentence[],
              }
            : null,
        answer: (answer?.value as StudentTask["answer"]) ?? null,
        grade: closed ? (answer?.grade ?? null) : null,
      };
    })
    .sort((a, b) => a.position - b.position)
    .map(({ position, ...rest }) => {
      void position;
      return rest;
    });

  return { total: tasks.length, found, deadline: text.deadline, closed };
}

const answerValue = z.union([
  z.object({ choice: z.number().int() }),
  z.object({ sentence: z.number().int() }),
  z.object({ text: z.string() }),
]);

export const MAX_SHORT_ANSWER = 1000;

export async function submitAnswer(taskId: string, userId: string, raw: unknown, now = new Date()) {
  const task = await db.task.findUnique({
    where: { id: taskId },
    include: { text: true, placements: { where: { userId } } },
  });
  if (!task?.text.publishedAt) throw new UploadError("Задание не найдено.");
  const membership = await getMembership(task.text.courseId, userId);
  if (membership?.role !== "STUDENT") throw new UploadError("Отвечать могут только студенты курса.");
  if (task.text.deadline && task.text.deadline <= now) throw new UploadError("Дедлайн прошёл, ответы закрыты.");

  const fragmentId = task.fragmentId ?? task.placements[0]?.fragmentId;
  const dwell = fragmentId ? await db.dwell.findUnique({ where: { userId_fragmentId: { userId, fragmentId } } }) : null;
  if (!fragmentId || !dwell?.readAt) throw new UploadError("Задание ещё не найдено.");

  const parsed = answerValue.safeParse(raw);
  if (!parsed.success) throw new UploadError("Неверный формат ответа.");
  const v = parsed.data;

  let value: Prisma.InputJsonValue;
  let grade: Grade | null = null;
  if (task.format === AnswerFormat.CHOICE) {
    const options = task.options as ChoiceOption[];
    if (!("choice" in v) || !options[v.choice]) throw new UploadError("Выберите вариант.");
    value = { choice: v.choice };
    grade = options[v.choice].correct ? Grade.PASS : Grade.FAIL;
  } else if (task.format === AnswerFormat.SELECTION) {
    const fragment = await db.fragment.findUniqueOrThrow({ where: { id: fragmentId } });
    const range = "sentence" in v ? (fragment.sentences as Sentence[])[v.sentence] : undefined;
    if (!range) throw new UploadError("Выберите предложение в абзаце.");
    value = { range };
    grade = selectionMatches(range, task.answerRange as Sentence) ? Grade.PASS : Grade.FAIL;
  } else {
    const text = "text" in v ? v.text.trim() : "";
    if (!text) throw new UploadError("Напишите ответ.");
    if (text.length > MAX_SHORT_ANSWER) throw new UploadError(`Ответ длиннее ${MAX_SHORT_ANSWER} знаков.`);
    if (countSentences(text) > 3) throw new UploadError("Ответ должен уложиться в три предложения.");
    value = { text };
  }

  // Изменённый короткий ответ преподаватель проверяет заново.
  await db.answer.upsert({
    where: { taskId_userId: { taskId, userId } },
    create: { taskId, userId, value, grade, gradedAt: grade ? now : null },
    update: { value, grade, gradedAt: grade ? now : null },
  });
}
