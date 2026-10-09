import { describe, expect, it } from "vitest";
import { fromBase64, parseReportFile, sealReport, unpackKeys } from "@/lib/kiosk-crypto";
import { applyBeat, type KioskData, type KioskState, newState, submitAnswer } from "@/lib/kiosk-engine";
import { buildPage, type PageText, type TextPiece } from "~/pages";
import {
  buildKioskData,
  createTask,
  newProject,
  parseProject,
  type Project,
  type ProjectTask,
  renderStudentHtml,
  serializeProject,
  studentFileName,
} from "~/project";
import { buildResults, gradeKey, openReportFile, resultsToCsv } from "~/results";
import { splitSentences } from "~/sentences";

const text = (content: string, sentences: [number, number][]) => sentences.map(([s, e]) => content.slice(s, e));

describe("предложения", () => {
  it("делит по концу предложения, но не по инициалам и сокращениям", () => {
    const t = "А. С. Пушкин писал, т. е. сочинял. Это видно, см. рис. 2! «Правда?» — Да… Конец";
    expect(text(t, splitSentences(t))).toEqual([
      "А. С. Пушкин писал, т. е. сочинял.",
      "Это видно, см. рис. 2!",
      "«Правда?» — Да…",
      "Конец",
    ]);
    expect(splitSentences("")).toEqual([]);
    expect(text("Dr. Smith et al. agree. Fine.", splitSentences("Dr. Smith et al. agree. Fine."))).toEqual([
      "Dr. Smith et al. agree.",
      "Fine.",
    ]);
  });
});

// Координаты PDF: y вверх. Страница высотой 800.
const flip = (x: number, y: number): [number, number] => [x, 800 - y];
const piece = (str: string, x: number, y: number, eol = false): TextPiece => ({
  str,
  x,
  y,
  width: str.length * 5,
  height: 10,
  eol,
});

describe("текст страницы", () => {
  it("собирает строки, склеивает переносы и считает смещения", () => {
    const page = buildPage(
      [
        piece("Первая строка с пере-", 50, 700, true),
        piece("носом слова. Вторая", 50, 686),
        piece(" фраза", 145, 686, true),
        piece("на третьей строке.", 50, 672, true),
      ],
      flip,
      3,
      { width: 600, height: 800 },
    );
    expect(page.content).toBe("Первая строка с переносом слова. Вторая фраза на третьей строке.");
    expect(page.lines.map((l) => page.content.slice(l.start, l.end))).toEqual([
      "Первая строка с пере",
      "носом слова. Вторая фраза",
      "на третьей строке.",
    ]);
    expect(page.lines[0].page).toBe(3);
    expect(page.lines[0].bbox).toEqual([50, 90, 155, 100]);
    expect(text(page.content, page.sentences)).toEqual([
      "Первая строка с переносом слова.",
      "Вторая фраза на третьей строке.",
    ]);
    expect(page.words).toBe(10);
  });

  it("страница без текста", () => {
    expect(buildPage([], flip, 0, { width: 600, height: 800 })).toMatchObject({ content: "", words: 0, lines: [] });
  });
});

function page(content: string): PageText {
  const sentences = splitSentences(content);
  return {
    width: 600,
    height: 800,
    content,
    lines: [{ page: 0, bbox: [50, 50, 550, 60], start: 0, end: content.length }],
    sentences,
    words: content.split(/\s+/).filter(Boolean).length,
  };
}

const PAGES = [
  page("Первая страница. Здесь задание на выбор."),
  page(""),
  page("Третья страница. Эталонное предложение здесь. Ещё одно."),
  page("Четвёртая страница для раскиданного задания."),
];
const PDF = new TextEncoder().encode("%PDF-1.7 test");

function project(): Project {
  const p = newProject("Книга.pdf", PDF, PAGES);
  const add = (input: Parameters<typeof createTask>[2]) => {
    const t = createTask(p, PAGES, input);
    if (typeof t === "string") throw new Error(t);
    p.tasks.push(t);
    return t;
  };
  add({
    kind: "page-choice",
    page: 0,
    prompt: "Выбор",
    options: [
      { text: "верно", correct: true },
      { text: "неверно", correct: false },
    ],
  });
  add({ kind: "page-selection", page: 2, prompt: "Найдите", sentenceIndex: 1 });
  add({ kind: "scattered", pageFrom: 2, pageTo: 4, prompt: "Перескажите" });
  return p;
}

describe("проект", () => {
  it("проверяет задания", () => {
    const p = newProject("Книга.pdf", PDF, PAGES);
    const err = (input: Parameters<typeof createTask>[2]) => expect(createTask(p, PAGES, input)).toBeTypeOf("string");
    err({ kind: "page-short", page: 0, prompt: "  " });
    err({ kind: "page-short", page: 1, prompt: "Пустая страница" });
    err({ kind: "page-short", page: 9, prompt: "Нет страницы" });
    err({ kind: "page-choice", page: 0, prompt: "Выбор", options: [{ text: "один", correct: true }] });
    err({
      kind: "page-choice",
      page: 0,
      prompt: "Выбор",
      options: [
        { text: "а", correct: false },
        { text: "б", correct: false },
      ],
    });
    err({ kind: "page-selection", page: 0, prompt: "Найдите", sentenceIndex: 7 });
    err({ kind: "scattered", pageFrom: 2, pageTo: 2, prompt: "Только пустая" });
    err({ kind: "scattered", pageFrom: 3, pageTo: 9, prompt: "За пределами" });
    const ok = createTask(p, PAGES, { kind: "page-short", page: 0, prompt: " Кратко " }) as ProjectTask;
    expect(ok).toMatchObject({ format: "SHORT", page: 0, prompt: "Кратко" });
  });

  it("файл читалки без верных ответов и секретного ключа, ключ читается обратно", () => {
    const p = project();
    const data = buildKioskData(p, PAGES);
    const json = JSON.stringify(data);
    expect(json).not.toContain("correct");
    expect(json).not.toContain(p.keys.secretKey);
    expect(json).not.toContain(p.keys.mac);
    expect(data.fragments.map((f) => f.id)).toEqual(["p1", "p2", "p3", "p4"]);
    expect(data.blocks.map((b) => b.id)).toEqual(["h1", "p1", "h3", "p3", "h4", "p4"]);
    expect(data.tasks[2].candidates).toEqual(["p3", "p4"]);
    expect(Object.keys(data.selections)).toEqual(["p3"]);

    const html = renderStudentHtml({ data, pdf: PDF, js: 'x("</script>")', css: "a{}" });
    expect(html.match(/<\/script>/g)).toHaveLength(3);
    expect(html).toContain('id="polya-app"');
    expect(studentFileName("Война и мир")).toBe("polya-chitalka-voina-i-mir.html");

    expect(parseProject(serializeProject(p))).toEqual(p);
    expect(parseProject("{}")).toBeTypeOf("string");
    expect(parseProject("не json")).toBeTypeOf("string");
  });
});

function readAll(data: KioskData, email: string, name = "Анна Смирнова") {
  const state = newState(data, { name, email }, 1_000);
  for (let i = 0; i < 20; i++) {
    applyBeat(state, data, Object.fromEntries(data.fragments.map((f) => [f.id, 15_000])), 15_000, 2_000);
  }
  return state;
}

function reportFile(data: KioskData, state: KioskState, keys = unpackKeys(data.exportId, data.keys)) {
  const payload = JSON.stringify(state);
  return sealReport({
    exportId: data.exportId,
    publicKey: fromBase64(data.publicKey),
    keys,
    payload,
    localCopy: payload,
  });
}

function open(p: Project, file: string) {
  const r = openReportFile(p, "r.polya", file);
  if ("error" in r) throw new Error(r.error);
  return r.report;
}

describe("результаты", () => {
  it("расшифровывает отчёт, проверяет ответы и ждёт оценки короткого", () => {
    const p = project();
    const data = buildKioskData(p, PAGES);
    const state = readAll(data, "anna@hse.ru");
    expect(submitAnswer(state, data, p.tasks[0].id, { choice: 0 }, 3_000)).toBeNull();
    expect(submitAnswer(state, data, p.tasks[1].id, { sentence: 1 }, 3_000)).toBeNull();
    expect(submitAnswer(state, data, p.tasks[2].id, { text: "Мой ответ." }, 3_000)).toBeNull();
    const report = open(p, reportFile(data, state));

    let [row] = buildResults(p, [report], {});
    expect(row).toMatchObject({ email: "anna@hse.ru", readPages: 4, found: 3, passed: 2, points: 5.33 });
    expect(row.cells.map((c) => c.state)).toEqual(["pass", "pass", "pending"]);
    expect(row.cells[1].answer).toBe("Эталонное предложение здесь.");

    const key = gradeKey("anna@hse.ru", p.tasks[2].id, "Мой ответ.");
    expect(row.cells[2].gradeKey).toBe(key);
    [row] = buildResults(p, [report], { [key]: "PASS" });
    expect(row.points).toBe(8);

    const csv = resultsToCsv(p, [row]);
    expect(csv.startsWith("﻿Студент;Почта")).toBe(true);
    expect(csv).toContain("Анна Смирнова;anna@hse.ru;4/4");
  });

  it("сливает отчёты одного студента и не засчитывает ответ после дедлайна", () => {
    const p = { ...project(), deadline: new Date(10_000).toISOString() };
    const data = buildKioskData(p, PAGES);
    const home = newState(data, { name: "Анна", email: "anna@hse.ru" }, 1_000);
    applyBeat(home, data, { p1: 15_000 }, 15_000, 2_000);
    submitAnswer(home, data, p.tasks[0].id, { choice: 1 }, 3_000);
    const phone = readAll(data, "anna@hse.ru");
    // Ответ изменён позже, но после дедлайна.
    phone.answers[p.tasks[0].id] = { value: { choice: 0 }, at: 20_000 };

    const [row] = buildResults(p, [open(p, reportFile(data, home)), open(p, reportFile(data, phone))], {});
    expect(row).toMatchObject({ reports: 2, instances: 2, readPages: 4 });
    expect(row.cells[0].state).toBe("late");
  });

  it("не открывает поддельные и чужие отчёты", () => {
    const p = project();
    const data = buildKioskData(p, PAGES);
    const state = readAll(data, "x@hse.ru");
    const forged = reportFile(data, state, { mac: new Uint8Array(32), local: new Uint8Array(32) });
    expect(openReportFile(p, "f", forged)).toMatchObject({ error: expect.stringMatching(/Подпись/) });
    expect(openReportFile(p, "g", "мусор")).toMatchObject({ error: expect.any(String) });
    const other = project();
    expect(openReportFile(other, "o", reportFile(data, state))).toMatchObject({
      error: expect.stringMatching(/другой читалки/),
    });
    expect(parseReportFile(reportFile(data, state))?.exportId).toBe(p.exportId);
  });

  it("время страницы не больше общего времени в читалке", () => {
    const p = project();
    const data = buildKioskData(p, PAGES);
    const state = newState(data, { name: "Хитрый", email: "h@hse.ru" }, 1_000);
    state.dwell = { p1: 10_000_000, p3: 10_000_000, p4: 10_000_000 };
    state.activeMs = 100;
    const [row] = buildResults(p, [open(p, reportFile(data, state))], {});
    expect(row.readPages).toBe(0);
  });
});
