import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { createKioskExport, importKioskReports, renderKioskHtml } from "@/lib/kiosk";
import {
  fromBase64,
  openLocal,
  openReport,
  packKeys,
  parseReportFile,
  ReportError,
  sealReport,
  unpackKeys,
} from "@/lib/kiosk-crypto";
import {
  applyBeat,
  type KioskData,
  type KioskState,
  newState,
  normalizeStudent,
  placeTasks,
  studentTasks,
  submitAnswer,
} from "@/lib/kiosk-engine";
import * as pdfService from "@/lib/pdf-service";
import { reportFileName } from "@/kiosk/session";
import { createTask } from "@/lib/tasks";
import { setPublished, updateTextSettings } from "@/lib/texts";
import { dateToLocalInput } from "@/lib/time";
import { resetDb } from "./helpers";
import { EXTRACTED, setup, upload } from "./text-fixtures";

beforeAll(async () => {
  process.env.STORAGE_DIR = await mkdtemp(path.join(tmpdir(), "polya-storage-"));
});

beforeEach(async () => {
  vi.restoreAllMocks();
  await resetDb();
});

const keys = { mac: new Uint8Array(32).fill(1), local: new Uint8Array(32).fill(2) };

describe("шифрование отчёта", () => {
  it("ключи киоска не лежат в файле открыто и восстанавливаются", () => {
    const packed = packKeys("exp1", keys);
    expect(Buffer.from(fromBase64(packed)).includes(Buffer.from(keys.mac))).toBe(false);
    const back = unpackKeys("exp1", packed);
    expect([...back.mac]).toEqual([...keys.mac]);
    expect([...back.local]).toEqual([...keys.local]);
  });

  it("сервер читает отчёт, а правку замечает", async () => {
    const nacl = (await import("tweetnacl")).default;
    const pair = nacl.box.keyPair();
    const file = sealReport({ exportId: "exp1", publicKey: pair.publicKey, keys, payload: '{"a":1}', localCopy: "{}" });
    const parsed = parseReportFile(file)!;
    expect(parsed.exportId).toBe("exp1");
    expect(file).not.toContain('"a"');
    expect(openReport(parsed.sealed, pair.secretKey, keys.mac)).toBe('{"a":1}');
    expect(openLocal(keys.local, parsed.local)).toBe("{}");

    // Чужой ключ подписи: отчёт, собранный не киоском.
    const forged = parseReportFile(
      sealReport({
        exportId: "exp1",
        publicKey: pair.publicKey,
        keys: { ...keys, mac: new Uint8Array(32) },
        payload: '{"a":2}',
        localCopy: "{}",
      }),
    )!;
    expect(() => openReport(forged.sealed, pair.secretKey, keys.mac)).toThrow(ReportError);

    // Испорченный шифротекст.
    const raw = fromBase64(parsed.sealed);
    raw[raw.length - 1] ^= 1;
    expect(() => openReport(Buffer.from(raw).toString("base64"), pair.secretKey, keys.mac)).toThrow(ReportError);
  });
});

function kioskData(overrides: Partial<KioskData> = {}): KioskData {
  return {
    v: 1,
    exportId: "exp1",
    textId: "t1",
    title: "Текст",
    displayMode: "PDF",
    language: "ru",
    blocks: [],
    pages: [],
    fragments: [
      { id: "f1", lines: [], thresholdMs: 3_000 },
      { id: "f2", lines: [], thresholdMs: 3_000 },
      { id: "f3", lines: [], thresholdMs: 3_000 },
    ],
    tasks: [
      { id: "a", format: "CHOICE", prompt: "Выбор", options: ["да", "нет"], fragmentId: "f1", candidates: null },
      {
        id: "s",
        format: "SHORT",
        prompt: "Раскиданное",
        options: null,
        fragmentId: null,
        candidates: ["f1", "f2", "f3"],
      },
    ],
    selections: {},
    deadline: null,
    deadlineLabel: null,
    publicKey: "",
    keys: "",
    exportedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("офлайн-читалка", () => {
  it("проверяет данные студента", () => {
    expect(normalizeStudent({ name: "  Иванов   Иван ", email: " Ivanov@Edu.HSE.ru " })).toEqual({
      name: "Иванов Иван",
      email: "ivanov@edu.hse.ru",
    });
    expect(normalizeStudent({ name: "", email: "a@b.ru" })).toBeTypeOf("string");
    expect(normalizeStudent({ name: "Иван", email: "не почта" })).toBeTypeOf("string");
  });

  it("раскидывает задания одинаково для одной почты и мимо привязанных абзацев", () => {
    const data = kioskData();
    const a = placeTasks(data, "x@hse.ru");
    expect(placeTasks(data, "x@hse.ru")).toEqual(a);
    expect(["f2", "f3"]).toContain(a.s);
  });

  it("засчитывает не больше прошедшего времени и открывает задания по дочитыванию", () => {
    const data = kioskData();
    const state = newState(data, { name: "И", email: "x@hse.ru" }, 1000);
    expect(studentTasks(state, data, 1000).found).toEqual([]);

    // Прошла секунда, а заявлено минута: засчитано 2 с (секунда и допуск).
    applyBeat(state, data, { f1: 60_000, unknown: 5_000 }, 1_000, 2000);
    expect(state.dwell).toEqual({ f1: 2_000 });
    expect(state.readAt.f1).toBeUndefined();
    applyBeat(state, data, { f1: 1_000 }, 5_000, 3000);
    expect(state.readAt.f1).toBe(3000);
    expect(state.activeMs).toBe(3_000);

    const tasks = studentTasks(state, data, 3000);
    expect(tasks.found.map((t) => t.id)).toEqual(["a"]);
    expect(tasks.found[0].options).toEqual(["да", "нет"]);
    expect(tasks.gradesPending).toBe(true);
  });

  it("принимает ответы только на найденные задания и до дедлайна", () => {
    const data = kioskData({ deadline: new Date(10_000).toISOString() });
    const state = newState(data, { name: "И", email: "x@hse.ru" }, 1000);
    expect(submitAnswer(state, data, "a", { choice: 0 }, 2000)).toBe("Задание ещё не найдено.");
    state.readAt.f1 = 1500;
    expect(submitAnswer(state, data, "a", { choice: 5 }, 2000)).toBe("Выберите вариант.");
    expect(submitAnswer(state, data, "a", { choice: 1 }, 2000)).toBeNull();
    expect(state.answers.a).toEqual({ value: { choice: 1 }, at: 2000 });
    expect(submitAnswer(state, data, "a", { choice: 0 }, 20_000)).toBe("Дедлайн прошёл, ответы закрыты.");

    state.readAt[state.placements.s] = 1500;
    expect(submitAnswer(state, data, "s", { text: "Раз. Два. Три. Четыре." }, 2000)).toMatch(/три предложения/);
    expect(submitAnswer(state, data, "s", { text: " Ответ. " }, 2000)).toBeNull();
    expect(state.answers.s.value).toEqual({ text: "Ответ." });
  });

  it("называет файл отчёта латиницей", () => {
    expect(reportFileName("Анна Щукина-Ёлкина", new Date(2026, 9, 9, 7, 5))).toBe(
      "polya-anna-shchukina-elkina-2026-10-09-0705.polya",
    );
    expect(reportFileName("—", new Date(2026, 0, 1))).toBe("polya-report-2026-01-01-0000.polya");
  });

  it("HTML не ломается от </script> в данных и скрипте", () => {
    const html = renderKioskHtml({
      data: kioskData({ title: "Про </script><script>alert(1)</script>" }),
      pdf: new Uint8Array([37, 80, 68, 70]),
      js: 'console.log("</script>")',
      css: "body{}",
    });
    expect(html.match(/<\/script>/g)).toHaveLength(3);
    expect(html).toContain("<title>Про &lt;/script&gt;");
  });
});

async function prepare() {
  vi.spyOn(pdfService, "extractPdf").mockResolvedValue(EXTRACTED);
  const ctx = await setup();
  const text = await upload(ctx.course.id, ctx.teacher.id);
  const [heading, first, , second] = await db.fragment.findMany({
    where: { textId: text.id },
    orderBy: { position: "asc" },
  });
  const choice = await createTask(text.id, ctx.teacher.id, {
    kind: "anchored-choice",
    fragmentId: first.id,
    prompt: "Выбор",
    options: [
      { text: "верно", correct: true },
      { text: "неверно", correct: false },
    ],
  });
  const selection = await createTask(text.id, ctx.teacher.id, {
    kind: "anchored-selection",
    fragmentId: first.id,
    prompt: "Найдите",
    sentenceIndex: 1,
  });
  const scattered = await createTask(text.id, ctx.teacher.id, {
    kind: "scattered-section",
    sectionFragmentId: heading.id,
    prompt: "Коротко",
  });
  await setPublished(text.id, ctx.teacher.id, true);
  return { ...ctx, text, first, second, choice, selection, scattered };
}

// Студент читает весь текст и отвечает на всё.
function readEverything(data: KioskData, email: string, at = Date.now()) {
  const state = newState(data, { name: "Пётр Петров", email }, at - 120_000);
  for (let i = 0; i < 10; i++) {
    applyBeat(state, data, Object.fromEntries(data.fragments.map((f) => [f.id, 15_000])), 15_000, at - 60_000);
  }
  return state;
}

function report(data: KioskData, state: KioskState, k = unpackKeys(data.exportId, data.keys)) {
  const payload = JSON.stringify(state);
  return sealReport({
    exportId: data.exportId,
    publicKey: fromBase64(data.publicKey),
    keys: k,
    payload,
    localCopy: payload,
  });
}

describe("выгрузка и загрузка отчётов", () => {
  it("выгружает только опубликованный текст и без верных ответов", async () => {
    const ctx = await prepare();
    await expect(createKioskExport(ctx.text.id, ctx.student.id)).rejects.toThrow();
    const { data, pdf } = await createKioskExport(ctx.text.id, ctx.teacher.id);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    const json = JSON.stringify(data);
    expect(json).not.toContain("correct");
    expect(json).not.toContain("answerRange");
    expect(data.fragments.map((f) => f.id)).toEqual([ctx.first.id, ctx.second.id]);
    expect(data.tasks.find((t) => t.id === ctx.scattered.id)!.candidates).toEqual([ctx.first.id, ctx.second.id]);
    expect(Object.keys(data.selections)).toEqual([ctx.first.id]);

    await setPublished(ctx.text.id, ctx.teacher.id, false);
    await expect(createKioskExport(ctx.text.id, ctx.teacher.id)).rejects.toThrow(/опубликованного/);
  });

  it("загружает отчёт: новый студент, дочитывание, ответы с оценками", async () => {
    const ctx = await prepare();
    const { data } = await createKioskExport(ctx.text.id, ctx.teacher.id);
    const state = readEverything(data, "new@hse.ru");
    const sentences = data.selections[ctx.first.id].sentences;
    expect(submitAnswer(state, data, ctx.choice.id, { choice: 0 }, Date.now() - 30_000)).toBeNull();
    expect(submitAnswer(state, data, ctx.selection.id, { sentence: 0 }, Date.now() - 30_000)).toBeNull();
    expect(submitAnswer(state, data, ctx.scattered.id, { text: "Мой ответ." }, Date.now() - 30_000)).toBeNull();
    const file = report(data, state);

    const [result] = await importKioskReports(ctx.text.id, ctx.teacher.id, [{ name: "r.polya", content: file }]);
    expect(result).toMatchObject({ ok: true, readCount: 2, answers: 3, late: 0 });

    const user = await db.user.findUniqueOrThrow({ where: { email: "new@hse.ru" } });
    expect(user.name).toBe("Пётр Петров");
    const member = await db.courseMember.findUnique({
      where: { courseId_userId: { courseId: ctx.course.id, userId: user.id } },
    });
    expect(member?.role).toBe("STUDENT");
    const dwells = await db.dwell.findMany({ where: { userId: user.id } });
    expect(dwells.every((d) => d.readAt)).toBe(true);
    const placement = await db.taskPlacement.findUniqueOrThrow({
      where: { taskId_userId: { taskId: ctx.scattered.id, userId: user.id } },
    });
    expect(placement.fragmentId).toBe(state.placements[ctx.scattered.id]);

    const answers = new Map((await db.answer.findMany({ where: { userId: user.id } })).map((a) => [a.taskId, a]));
    expect(answers.get(ctx.choice.id)?.grade).toBe("PASS");
    expect(answers.get(ctx.choice.id)?.updatedAt.getTime()).toBe(state.answers[ctx.choice.id].at);
    expect(answers.get(ctx.selection.id)?.value).toEqual({ range: sentences[0] });
    expect(answers.get(ctx.selection.id)?.grade).toBe("FAIL");
    expect(answers.get(ctx.scattered.id)?.grade).toBeNull();

    // Тот же файл второй раз ничего не меняет.
    const [again] = await importKioskReports(ctx.text.id, ctx.teacher.id, [{ name: "r.polya", content: file }]);
    expect(again.message).toMatch(/уже загружен/);
  });

  it("не сбрасывает оценку и не откатывает ответ более старым отчётом", async () => {
    const ctx = await prepare();
    const { data } = await createKioskExport(ctx.text.id, ctx.teacher.id);
    const state = readEverything(data, ctx.student.email);
    submitAnswer(state, data, ctx.scattered.id, { text: "Первый." }, Date.now() - 50_000);
    const older = report(data, state);
    submitAnswer(state, data, ctx.choice.id, { choice: 1 }, Date.now() - 40_000);
    const newer = report(data, state);

    await importKioskReports(ctx.text.id, ctx.teacher.id, [{ name: "new", content: newer }]);
    await db.answer.update({
      where: { taskId_userId: { taskId: ctx.scattered.id, userId: ctx.student.id } },
      data: { grade: "PASS", gradedAt: new Date() },
    });
    const dwellBefore = await db.dwell.findMany({ where: { userId: ctx.student.id }, orderBy: { fragmentId: "asc" } });

    const [res] = await importKioskReports(ctx.text.id, ctx.teacher.id, [{ name: "old", content: older }]);
    expect(res.ok).toBe(true);
    const short = await db.answer.findUniqueOrThrow({
      where: { taskId_userId: { taskId: ctx.scattered.id, userId: ctx.student.id } },
    });
    expect(short.grade).toBe("PASS");
    const choice = await db.answer.findUniqueOrThrow({
      where: { taskId_userId: { taskId: ctx.choice.id, userId: ctx.student.id } },
    });
    expect(choice.value).toEqual({ choice: 1 });
    expect(await db.dwell.findMany({ where: { userId: ctx.student.id }, orderBy: { fragmentId: "asc" } })).toEqual(
      dwellBefore,
    );
  });

  it("не засчитывает ответы после дедлайна и время абзаца больше общего", async () => {
    const ctx = await prepare();
    const deadline = new Date(Date.now() - 3_600_000);
    await updateTextSettings(ctx.text.id, ctx.teacher.id, {
      title: "Т",
      wordsPerMinute: 200,
      displayMode: "PDF",
      deadline: dateToLocalInput(deadline),
    });
    const { data } = await createKioskExport(ctx.text.id, ctx.teacher.id);
    const state = readEverything(data, "late@hse.ru");
    state.answers[ctx.choice.id] = { value: { choice: 0 }, at: Date.now() - 1000 };
    state.dwell[ctx.first.id] = 10_000_000;
    const [res] = await importKioskReports(ctx.text.id, ctx.teacher.id, [{ name: "r", content: report(data, state) }]);
    expect(res).toMatchObject({ ok: true, answers: 0, late: 1 });
    const user = await db.user.findUniqueOrThrow({ where: { email: "late@hse.ru" } });
    const dwell = await db.dwell.findUniqueOrThrow({
      where: { userId_fragmentId: { userId: user.id, fragmentId: ctx.first.id } },
    });
    expect(dwell.ms).toBe(state.activeMs);
  });

  it("отклоняет поддельные и чужие отчёты", async () => {
    const ctx = await prepare();
    const { data } = await createKioskExport(ctx.text.id, ctx.teacher.id);
    const state = readEverything(data, "x@hse.ru");
    const forged = report(data, state, { mac: new Uint8Array(32), local: new Uint8Array(32) });
    const teacher = readEverything(data, ctx.teacher.email);

    const other = await upload(ctx.course.id, ctx.teacher.id);
    await setPublished(other.id, ctx.teacher.id, true);

    const results = await importKioskReports(ctx.text.id, ctx.teacher.id, [
      { name: "forged", content: forged },
      { name: "garbage", content: "привет" },
      { name: "teacher", content: report(data, teacher) },
    ]);
    expect(results.map((r) => r.ok)).toEqual([false, false, false]);
    expect(results[0].message).toMatch(/Подпись/);
    expect(results[2].message).toMatch(/преподаватель/);

    const [wrong] = await importKioskReports(other.id, ctx.teacher.id, [{ name: "r", content: report(data, state) }]);
    expect(wrong.message).toMatch(/другому тексту/);
    await expect(
      importKioskReports(ctx.text.id, ctx.student.id, [{ name: "r", content: report(data, state) }]),
    ).rejects.toThrow();
    expect(await db.dwell.count()).toBe(0);
  });
});
