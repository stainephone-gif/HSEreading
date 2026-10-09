// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import type { PageText } from "~/pages";
import { newProject, type ProjectTask } from "~/project";
import { splitSentences } from "~/sentences";
import {
  csvTemplate,
  exportTasksCsv,
  exportTasksXml,
  findSentence,
  type ImportPreview,
  previewImport,
  splitCsv,
  XML_SAMPLE,
} from "~/task-import";

function page(content: string): PageText {
  return {
    width: 600,
    height: 800,
    content,
    lines: [],
    sentences: splitSentences(content),
    words: content.split(/\s+/).filter(Boolean).length,
  };
}

const PAGES = [
  page("Первая страница. Здесь задание на выбор."),
  page("Вторая страница. Это утверждение, т. е. тезис Маклюэна, обычно цитируют без контекста. Конец."),
  page(""),
  page("Четвёртая страница с текстом."),
];
const project = () => newProject("Книга.pdf", new TextEncoder().encode("%PDF"), PAGES);

function results(preview: ImportPreview) {
  if ("error" in preview) throw new Error(preview.error);
  return preview.rows.map((r) => (typeof r.result === "string" ? `${r.label}: ${r.result}` : r.result));
}

const brief = (t: ProjectTask | string) =>
  typeof t === "string"
    ? t
    : [t.format, t.page, t.pageFrom, t.pageTo, t.prompt, t.options?.find((o) => o.correct)?.text ?? null];

describe("эталонное предложение", () => {
  it("находит по началу фразы и по похожим словам, иначе подсказывает ближайшее", () => {
    expect(findSentence(PAGES[1], "это утверждение — т.е. «тезис Маклюэна»")).toBe(1);
    expect(findSentence(PAGES[1], "обычно цитируют тезис Маклюэна это утверждение без контекста т е")).toBe(1);
    expect(findSentence(PAGES[1], "Конец")).toBe(2);
    expect(findSentence(PAGES[1], "  ")).toBe("Не указано эталонное предложение.");
    expect(findSentence(PAGES[1], "тезис Маклюэна обычно забывают")).toMatch(/не найдено.*Ближайшее: «Это утверждение/);
  });
});

describe("задания из файла", () => {
  it("XML: все типы, ошибки с номером задания", () => {
    const xml = `<?xml version="1.0"?>
<tasks>
  <task type="choice" page="1"><prompt>Выбор</prompt><option>нет</option><option correct="true">да</option></task>
  <task type="selection" page="2"><prompt>Найдите</prompt><answer>тезис Маклюэна</answer></task>
  <task type="short" page="4"><prompt>  Коротко  </prompt></task>
  <task type="scattered" from="1" to="4"><prompt>Раскидано</prompt></task>
  <task type="choice" page="1"><prompt>Без верного</prompt><option>а</option><option>б</option></task>
  <task type="short" page="3"><prompt>Пустая страница</prompt></task>
  <task type="short" page="99"><prompt>Нет страницы</prompt></task>
  <task type="essay" page="1"><prompt>Неизвестный тип</prompt></task>
</tasks>`;
    expect(results(previewImport(project(), PAGES, "z.xml", xml)).map(brief)).toEqual([
      ["CHOICE", 0, null, null, "Выбор", "да"],
      ["SELECTION", 1, null, null, "Найдите", null],
      ["SHORT", 3, null, null, "Коротко", null],
      ["SHORT", null, 1, 4, "Раскидано", null],
      "задание 5: Не указан верный вариант (номер от 1 или его текст).",
      "задание 6: На этой странице нет текстового слоя: задание не к чему привязать.",
      "задание 7: В тексте 4 стр., страницы 99 нет.",
      "задание 8: Неизвестный тип «essay». Допустимо: выбор, выделение, короткий, раскидать.",
    ]);
  });

  it("CSV из Excel: точка с запятой, BOM, кавычки и перенос внутри поля, верный по тексту", () => {
    const text =
      "﻿Тип;Стр_от;Стр_до;Задание;Вар1;Вар2;Вар3;Верный;Эталон\r\n" +
      'выбор;1;;"Что ""главное""?";один;два;три;два;\r\n' +
      "Выделение;2;;Найдите;;;;;Это утверждение\r\n" +
      'короткий;4;;"Две\nстроки";;;;;\r\n' +
      "раскидать;2;4;Перескажите;;;;;\r\n" +
      ";;;;;;;;\r\n" +
      "выбор;1;;Плохой верный;а;б;;5;\r\n";
    expect(results(previewImport(project(), PAGES, "z.csv", text)).map(brief)).toEqual([
      ["CHOICE", 0, null, null, 'Что "главное"?', "два"],
      ["SELECTION", 1, null, null, "Найдите", null],
      ["SHORT", 3, null, null, "Две\nстроки", null],
      ["SHORT", null, 2, 4, "Перескажите", null],
      "строка 6: Не указан верный вариант (номер от 1 или его текст).",
    ]);
    expect(splitCsv("a,b\n1,2\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
    expect(previewImport(project(), PAGES, "z.csv", "a;b\n1;2")).toEqual({
      error: "В первой строке не найдена колонка «задание». Скачайте шаблон и сверьте заголовки.",
    });
  });

  it("JSON: массив или поле tasks, варианты массивом или по одному", () => {
    const json = JSON.stringify({
      tasks: [
        { type: "choice", page: 1, prompt: "Выбор", options: ["а", "б"], correct: 1 },
        { тип: "выбор", страница: 1, задание: "По-русски", вар1: "х", вар2: "у", верный: "у" },
        { type: "scattered", from: 1, to: 2, prompt: "Раскидано" },
      ],
    });
    expect(results(previewImport(project(), PAGES, "z.json", json)).map(brief)).toEqual([
      ["CHOICE", 0, null, null, "Выбор", "а"],
      ["CHOICE", 0, null, null, "По-русски", "у"],
      ["SHORT", null, 1, 2, "Раскидано", null],
    ]);
    expect(previewImport(project(), PAGES, "z.json", "{oops")).toMatchObject({ error: expect.stringMatching(/JSON/) });
    expect(previewImport(project(), PAGES, "z.json", '{"a":1}')).toEqual({
      error: "В JSON нужен массив заданий или поле tasks.",
    });
  });

  it("отвергает чужой XML и пустые файлы", () => {
    expect(previewImport(project(), PAGES, "q.xml", "<quiz/>")).toMatchObject({
      error: expect.stringMatching(/<tasks>/),
    });
    expect(previewImport(project(), PAGES, "q.xml", "<tasks></tasks>")).toEqual({ error: "В файле нет заданий." });
    expect(previewImport(project(), PAGES, "q.csv", "")).toEqual({ error: "В файле нет строк с заданиями." });
  });

  it("образцы разбираются, выгрузка в CSV и XML загружается обратно без потерь", () => {
    expect("rows" in previewImport(project(), PAGES, "o.xml", XML_SAMPLE)).toBe(true);
    const template = results(previewImport(project(), PAGES, "t.csv", csvTemplate(PAGES)));
    expect(template.every((t) => typeof t !== "string")).toBe(true);

    const p = project();
    p.tasks = results(
      previewImport(
        p,
        PAGES,
        "z.xml",
        `<tasks>
          <task type="choice" page="1"><prompt>A &amp; B; "кавычки"</prompt><option correct="true">&lt;да&gt;, конечно</option><option>нет</option></task>
          <task type="selection" page="2"><prompt>Найдите</prompt><answer>Конец</answer></task>
          <task type="short" page="1"><prompt>Коротко</prompt></task>
          <task type="scattered" from="2" to="4"><prompt>Раскидано</prompt></task>
        </tasks>`,
      ),
    ) as ProjectTask[];
    const strip = (t: ProjectTask | string) => (typeof t === "string" ? t : { ...t, id: "" });
    for (const [name, text] of [
      ["back.csv", exportTasksCsv(p)],
      ["back.xml", exportTasksXml(p)],
    ]) {
      expect(results(previewImport(p, PAGES, name, text)).map(strip)).toEqual(p.tasks.map(strip));
    }
  });
});
