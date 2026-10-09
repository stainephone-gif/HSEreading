// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import type { PageText } from "~/pages";
import { newProject } from "~/project";
import { splitSentences } from "~/sentences";
import { exportTasksXml, findSentence, importTasksXml, XML_SAMPLE } from "~/xml-tasks";

function page(content: string): PageText {
  return {
    width: 600,
    height: 800,
    content,
    lines: [{ page: 0, bbox: [50, 50, 550, 60], start: 0, end: content.length }],
    sentences: splitSentences(content),
    words: content.split(/\s+/).filter(Boolean).length,
  };
}

const PAGES = [
  page("Первая страница. Здесь задание на выбор."),
  page("Вторая страница. Это утверждение, т. е. тезис Маклюэна, обычно цитируют без контек-ста. Конец."),
  page(""),
  page("Четвёртая страница с текстом."),
];
const project = () => newProject("Книга.pdf", new TextEncoder().encode("%PDF"), PAGES);

describe("XML с заданиями", () => {
  it("находит эталонное предложение по началу фразы, без учёта кавычек и регистра", () => {
    expect(findSentence(PAGES[1], "это утверждение — т.е. «тезис Маклюэна»")).toBe(1);
    expect(findSentence(PAGES[1], "Конец")).toBe(2);
    expect(findSentence(PAGES[1], "нет такого")).toBeNull();
    expect(findSentence(PAGES[1], "  ")).toBeNull();
  });

  it("импортирует все типы и пропускает ошибочные с понятными причинами", () => {
    const xml = `<?xml version="1.0"?>
<tasks>
  <task type="choice" page="1">
    <prompt>Выбор</prompt>
    <option>нет</option>
    <option correct="true">да</option>
  </task>
  <task type="selection" page="2"><prompt>Найдите</prompt><answer>тезис Маклюэна</answer></task>
  <task type="short" page="4"><prompt>  Коротко  </prompt></task>
  <task type="scattered" from="1" to="4"><prompt>Раскидано</prompt></task>
  <task type="choice" page="1"><prompt>Без верного</prompt><option>а</option><option>б</option></task>
  <task type="short" page="3"><prompt>Пустая страница</prompt></task>
  <task type="short" page="99"><prompt>Нет страницы</prompt></task>
  <task type="selection" page="2"><prompt>Мимо</prompt><answer>чего нет</answer></task>
  <task type="essay" page="1"><prompt>Неизвестный тип</prompt></task>
  <task type="short" page="1"></task>
</tasks>`;
    const { tasks, errors } = importTasksXml(xml, project(), PAGES);
    expect(tasks.map((t) => [t.format, t.page, t.prompt])).toEqual([
      ["CHOICE", 0, "Выбор"],
      ["SELECTION", 1, "Найдите"],
      ["SHORT", 3, "Коротко"],
      ["SHORT", null, "Раскидано"],
    ]);
    expect(tasks[0].options).toEqual([
      { text: "нет", correct: false },
      { text: "да", correct: true },
    ]);
    expect(tasks[3]).toMatchObject({ pageFrom: 1, pageTo: 4 });
    expect(errors).toEqual([
      "Задание 5: отметьте один верный вариант.",
      "Задание 6: на этой странице нет текстового слоя: задание не к чему привязать.",
      "Задание 7: укажите страницу от 1 до 4 в атрибуте page.",
      "Задание 8: на стр. 2 не найден текст «чего нет».",
      "Задание 9: неизвестный тип «essay»: нужен choice, selection, short или scattered.",
      "Задание 10: напишите задание.",
    ]);
  });

  it("отвергает не XML и чужой XML", () => {
    expect(importTasksXml("не xml", project(), PAGES).errors[0]).toMatch(/<tasks>/);
    expect(importTasksXml("<quiz><question/></quiz>", project(), PAGES).errors[0]).toMatch(/<tasks>/);
    expect(importTasksXml("<tasks></tasks>", project(), PAGES).errors).toEqual(["В файле нет ни одного <task>."]);
  });

  it("образец разбирается, а выгрузка импортируется обратно без потерь", () => {
    const sample = importTasksXml(XML_SAMPLE, project(), PAGES);
    // В образце страницы 3–20, а в тестовой книге их 4: важно, что формат понятен.
    expect(sample.errors.every((e) => !/<tasks>|тип/.test(e))).toBe(true);

    const p = project();
    p.tasks = importTasksXml(
      `<tasks>
        <task type="choice" page="1"><prompt>A &amp; B "кавычки"</prompt><option correct="true">&lt;да&gt;</option><option>нет</option></task>
        <task type="selection" page="2"><prompt>Найдите</prompt><answer>Конец</answer></task>
        <task type="short" page="1"><prompt>Коротко</prompt></task>
        <task type="scattered" from="2" to="4"><prompt>Раскидано</prompt></task>
      </tasks>`,
      p,
      PAGES,
    ).tasks;
    const again = importTasksXml(exportTasksXml(p), p, PAGES);
    expect(again.errors).toEqual([]);
    const strip = (t: (typeof p.tasks)[number]) => ({ ...t, id: "" });
    expect(again.tasks.map(strip)).toEqual(p.tasks.map(strip));
  });
});
