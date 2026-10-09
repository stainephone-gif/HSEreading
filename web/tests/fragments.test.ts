import { describe, expect, it } from "vitest";
import { countWords, type FragmentData, mergeFragments, splitFragment, unlockSeconds } from "@/lib/fragments";

function fragment(content: string, sentences: [number, number][], page = 0): FragmentData {
  return {
    content,
    wordCount: countWords(content),
    lines: [{ page, bbox: [0, 0, 100, 10], start: 0, end: content.length }],
    sentences,
  };
}

describe("правка фрагментов", () => {
  it("считает время открытия маркера по концепции", () => {
    // 120 слов при 200 словах в минуту: 36 секунд чтения, маркер через половину.
    expect(unlockSeconds(120, 200)).toBe(18);
  });

  it("считает слова в русском и английском тексте", () => {
    expect(countWords("Социально-экономический тезис, т. е. «довод».")).toBe(5);
    expect(countWords("Clinton-Lisell et al. don't agree.")).toBe(5);
  });

  it("склеивает разорванную фразу в одно предложение", () => {
    const a = fragment("Первая фраза. Вторая обрывается на", [
      [0, 13],
      [14, 34],
    ]);
    const b = fragment("середине. Третья.", [
      [0, 9],
      [10, 17],
    ], 1);
    const m = mergeFragments(a, b);
    expect(m.content).toBe("Первая фраза. Вторая обрывается на середине. Третья.");
    expect(m.sentences.map(([s, e]) => m.content.slice(s, e))).toEqual([
      "Первая фраза.",
      "Вторая обрывается на середине.",
      "Третья.",
    ]);
    expect(m.lines.map((l) => [l.page, m.content.slice(l.start, l.end)])).toEqual([
      [0, "Первая фраза. Вторая обрывается на"],
      [1, "середине. Третья."],
    ]);
    expect(m.wordCount).toBe(7);
  });

  it("склеивает два законченных абзаца без слияния предложений", () => {
    const m = mergeFragments(fragment("Один.", [[0, 5]]), fragment("Два.", [[0, 4]]));
    expect(m.sentences).toEqual([
      [0, 5],
      [6, 10],
    ]);
  });

  it("разрезает между предложениями, а склейка возвращает исходное", () => {
    const f: FragmentData = {
      content: "Первое предложение. Второе предложение длинное. Третье.",
      wordCount: 6,
      lines: [
        { page: 0, bbox: [0, 0, 100, 10], start: 0, end: 30 },
        { page: 0, bbox: [0, 12, 100, 22], start: 31, end: 55 },
      ],
      sentences: [
        [0, 19],
        [20, 47],
        [48, 55],
      ],
    };
    const [a, b] = splitFragment(f, 2);
    expect(a.content).toBe("Первое предложение. Второе предложение длинное.");
    expect(b.content).toBe("Третье.");
    expect(a.sentences).toEqual([
      [0, 19],
      [20, 47],
    ]);
    expect(b.sentences).toEqual([[0, 7]]);
    // Вторая строка проходит через разрез и достаётся обеим частям.
    expect(a.lines).toHaveLength(2);
    expect(a.lines[1].end).toBe(47);
    expect(b.lines).toEqual([{ page: 0, bbox: [0, 12, 100, 22], start: 0, end: 7 }]);
    expect(a.wordCount + b.wordCount).toBe(6);

    expect(mergeFragments(a, b).content).toBe(f.content);
  });

  it("не режет по краям", () => {
    const f = fragment("Одно. Два.", [
      [0, 5],
      [6, 10],
    ]);
    expect(() => splitFragment(f, 0)).toThrow();
    expect(() => splitFragment(f, 2)).toThrow();
  });
});
