// @vitest-environment happy-dom
import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { DocxError, docxParagraphs, extractDocx, isDocx, paginate } from "~/docx";
import { buildKioskData, newProject } from "~/project";
import { splitSentences } from "~/sentences";

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

export function makeDocx(body: string): Uint8Array {
  return zipSync({
    "[Content_Types].xml": strToU8("<Types/>"),
    "word/document.xml": strToU8(
      `<?xml version="1.0" encoding="UTF-8"?><w:document ${W}><w:body>${body}</w:body></w:document>`,
    ),
  });
}

const p = (...runs: string[]) => `<w:p>${runs.map((r) => `<w:r>${r}</w:r>`).join("")}</w:p>`;
const t = (s: string) => `<w:t xml:space="preserve">${s}</w:t>`;

describe("DOCX", () => {
  it("достаёт абзацы: разбитые на куски строки, табуляции, таблицы; без удалённого текста", () => {
    const docx = makeDocx(
      [
        `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r>${t("Глава 1")}</w:r></w:p>`,
        p(t("Пер"), t("вый абзац."), "<w:tab/>", t("После табуляции.")),
        `<w:p><w:r>${t("Остаётся.")}</w:r><w:del><w:r><w:delText>Удалено.</w:delText></w:r></w:del></w:p>`,
        "<w:p/>",
        `<w:tbl><w:tr><w:tc>${p(t("В таблице."))}</w:tc></w:tr></w:tbl>`,
      ].join(""),
    );
    expect(isDocx(docx)).toBe(true);
    expect(docxParagraphs(docx)).toEqual(["Глава 1", "Первый абзац. После табуляции.", "Остаётся.", "В таблице."]);
  });

  it("сообщает о не-DOCX и пустом документе", () => {
    expect(() => docxParagraphs(new TextEncoder().encode("PK не архив"))).toThrow(DocxError);
    expect(() => docxParagraphs(zipSync({ "a.txt": strToU8("x") }))).toThrow(/не документ Word/);
    expect(() => extractDocx(makeDocx("<w:p/>"))).toThrow(/нет текста/);
    expect(isDocx(new TextEncoder().encode("%PDF"))).toBe(false);
  });

  it("делит на страницы по абзацам, длинный абзац — по предложениям", () => {
    const para = (n: number, word: string) => Array.from({ length: n }, () => word).join(" ") + ".";
    const pages = paginate(
      [para(200, "раз"), para(200, "два"), para(100, "три"), "Заголовок", para(50, "четыре")],
      350,
    );
    expect(pages.map((pg) => pg.words)).toEqual([200, 301, 50]);
    expect(pages[1].content.split("\n").map((x) => x.split(" ")[0])).toEqual(["два", "три", "Заголовок"]);

    const long = Array.from({ length: 30 }, (_, i) => `Предложение номер ${i + 1} из длинного абзаца.`).join(" ");
    const split = paginate([long], 60);
    expect(split.length).toBe(3);
    expect(split.every((pg) => pg.words <= 66)).toBe(true);
    expect(split.map((pg) => pg.content).join(" ")).toBe(long);
  });

  it("предложение не переходит через абзац, читалка из DOCX — только текстом", () => {
    const content = "Заголовок без точки\nПервое предложение. Второе.";
    expect(splitSentences(content).map(([s, e]) => content.slice(s, e))).toEqual([
      "Заголовок без точки",
      "Первое предложение.",
      "Второе.",
    ]);
    const docx = makeDocx(p(t("Глава")) + p(t("Текст книги. Ещё предложение.")));
    const pages = extractDocx(docx);
    const project = newProject("Книга.docx", docx, pages, "docx");
    expect(project).toMatchObject({ title: "Книга", source: "docx", displayMode: "WEB" });
    const data = buildKioskData({ ...project, displayMode: "PDF" }, pages);
    expect(data.displayMode).toBe("WEB");
    expect(data.blocks.map((b) => b.content)).toEqual(["Страница 1", "Глава\nТекст книги. Ещё предложение."]);
  });
});
