import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import * as pdfService from "@/lib/pdf-service";
import { getReaderData, getReadingSummary, MAX_CREDIT_MS, recordDwell, thresholdMs } from "@/lib/reading";
import { setPublished } from "@/lib/texts";
import { resetDb } from "./helpers";
import { EXTRACTED, setup, upload } from "./text-fixtures";

const T0 = new Date("2026-10-01T10:00:00Z");
const at = (ms: number) => new Date(T0.getTime() + ms);

async function published() {
  vi.spyOn(pdfService, "extractPdf").mockResolvedValue(EXTRACTED);
  const ctx = await setup();
  const text = await upload(ctx.course.id, ctx.teacher.id);
  await setPublished(text.id, ctx.teacher.id, true);
  const reader = (await getReaderData(text.id, ctx.student.id))!;
  const [a, b] = reader.fragments;
  return { ...ctx, text, a, b };
}

async function dwellMs(userId: string, fragmentId: string) {
  const d = await db.dwell.findUnique({ where: { userId_fragmentId: { userId, fragmentId } } });
  return d?.ms ?? 0;
}

beforeAll(async () => {
  process.env.STORAGE_DIR = await mkdtemp(path.join(tmpdir(), "polya-storage-"));
});

beforeEach(async () => {
  vi.restoreAllMocks();
  await resetDb();
});

describe("учёт дочитывания", () => {
  it("порог: половина расчётного времени", () => {
    expect(thresholdMs(120, 200)).toBe(18_000);
    // Короткий абзац всё равно требует хотя бы секунду.
    expect(thresholdMs(1, 200)).toBe(1_000);
  });

  it("читалка отдаёт только абзацы и пороги", async () => {
    const { text, student, teacher, a } = await published();
    const reader = await getReaderData(text.id, student.id);
    expect(reader?.fragments).toHaveLength(2);
    expect(reader?.preview).toBe(false);
    // 6 слов при 200 сл/мин: 1,8 с, половина — 0,9 с, округляется до секунды.
    expect(a.thresholdMs).toBe(1_000);
    expect((await getReaderData(text.id, teacher.id))?.preview).toBe(true);
  });

  it("засчитывает не больше, чем прошло по часам сервера", async () => {
    const { text, student, a, b } = await published();
    // Первый отчёт только открывает текст.
    await recordDwell(text.id, student.id, { [a.id]: 5_000 }, at(0));
    expect(await dwellMs(student.id, a.id)).toBe(0);

    // Через 5 с клиент заявляет 5 с для двух абзацев сразу: оба в зоне, оба засчитаны.
    const res = await recordDwell(text.id, student.id, { [a.id]: 5_000, [b.id]: 5_000 }, at(5_000));
    expect(await dwellMs(student.id, a.id)).toBe(5_000);
    expect(await dwellMs(student.id, b.id)).toBe(5_000);
    expect(res.ok && res.readIds.sort()).toEqual([a.id, b.id].sort());

    // Через 2 с клиент врёт про 60 с: засчитываются 2 с и секунда допуска.
    await recordDwell(text.id, student.id, { [a.id]: 60_000 }, at(7_000));
    expect(await dwellMs(student.id, a.id)).toBe(8_000);
  });

  it("долгий перерыв не превращается в чтение", async () => {
    const { text, student, a } = await published();
    await recordDwell(text.id, student.id, {}, at(0));
    await recordDwell(text.id, student.id, { [a.id]: 3_600_000 }, at(3_600_000));
    expect(await dwellMs(student.id, a.id)).toBe(MAX_CREDIT_MS);
  });

  it("две вкладки не удваивают время", async () => {
    const { text, student, a } = await published();
    await recordDwell(text.id, student.id, {}, at(0));
    await Promise.all([
      recordDwell(text.id, student.id, { [a.id]: 5_000 }, at(5_000)),
      recordDwell(text.id, student.id, { [a.id]: 5_000 }, at(5_000)),
    ]);
    // Первый отчёт получает 5 с, второй — только секунду допуска.
    expect(await dwellMs(student.id, a.id)).toBe(6_000);
  });

  it("отмечает момент дочитывания один раз", async () => {
    const { text, student, b } = await published();
    await recordDwell(text.id, student.id, {}, at(0));
    await recordDwell(text.id, student.id, { [b.id]: 500 }, at(500));
    let d = await db.dwell.findUniqueOrThrow({
      where: { userId_fragmentId: { userId: student.id, fragmentId: b.id } },
    });
    expect(d.readAt).toBeNull();
    await recordDwell(text.id, student.id, { [b.id]: 1_000 }, at(1_500));
    d = await db.dwell.findUniqueOrThrow({ where: { userId_fragmentId: { userId: student.id, fragmentId: b.id } } });
    expect(d.readAt).toEqual(at(1_500));
    await recordDwell(text.id, student.id, { [b.id]: 1_000 }, at(2_500));
    d = await db.dwell.findUniqueOrThrow({ where: { userId_fragmentId: { userId: student.id, fragmentId: b.id } } });
    expect(d.readAt).toEqual(at(1_500));
  });

  it("не пишет предпросмотр, черновик и чужие фрагменты", async () => {
    const { text, teacher, student, a, course } = await published();
    expect((await recordDwell(text.id, teacher.id, { [a.id]: 1_000 }, at(0))).ok).toBe(false);

    // Фрагмент другого текста или заголовок в зачёт не идут.
    const other = await upload(course.id, teacher.id);
    const heading = await db.fragment.findFirstOrThrow({ where: { textId: text.id, kind: "HEADING" } });
    await recordDwell(text.id, student.id, {}, at(0));
    await recordDwell(text.id, student.id, { [heading.id]: 1_000 }, at(1_000));
    expect(await dwellMs(student.id, heading.id)).toBe(0);
    expect((await recordDwell(other.id, student.id, {}, at(0))).ok).toBe(false);
    expect(await getReaderData(other.id, student.id)).toBeNull();
  });

  it("сводка для преподавателя", async () => {
    const { text, teacher, student, a, b } = await published();
    await recordDwell(text.id, student.id, {}, at(0));
    await recordDwell(text.id, student.id, { [a.id]: 5_000, [b.id]: 400 }, at(5_000));
    // Два абзаца в зоне одновременно: время чтения 5 с, а не 5,4 с.
    const cursor = await db.readingCursor.findUniqueOrThrow({
      where: { userId_textId: { userId: student.id, textId: text.id } },
    });
    expect(cursor.activeMs).toBe(5_000);

    const summary = await getReadingSummary(text.id, teacher.id);
    expect(summary.bodyCount).toBe(2);
    expect(summary.rows).toEqual([
      { userId: student.id, name: "Студент", email: "s@example.com", openedAt: at(0), readCount: 1, minutes: 0 },
    ]);
    await expect(getReadingSummary(text.id, student.id)).rejects.toThrow();
  });
});
