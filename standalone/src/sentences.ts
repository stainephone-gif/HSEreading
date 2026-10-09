// Деление текста страницы на предложения: для заданий «выделите предложение».
// Проще, чем в сервисе разбора, но учитывает инициалы и частые сокращения.

import type { Sentence } from "@/lib/pdf-service";

const ABBREVIATIONS = new Set([
  "т",
  "е",
  "д",
  "п",
  "др",
  "см",
  "ср",
  "им",
  "г",
  "гг",
  "в",
  "вв",
  "с",
  "стр",
  "рис",
  "табл",
  "напр",
  "проф",
  "акад",
  "e.g",
  "i.e",
  "al",
  "etc",
  "cf",
  "vs",
  "mr",
  "mrs",
  "dr",
  "p",
  "pp",
  "vol",
  "no",
  "fig",
]);

// Конец предложения: знак, затем кавычки или скобки, пробел и начало нового
// предложения (заглавная буква, цифра, кавычка, тире).
const BOUNDARY = /[.!?…]+["»”’)\]]*(?=\s+["«“„(\[—–-]?[\p{Lu}\d])/gu;

function previousWord(text: string, end: number): string {
  const m = /([\p{L}.]+)$/u.exec(text.slice(Math.max(0, end - 20), end));
  return m ? m[1] : "";
}

function splitLine(text: string): Sentence[] {
  const result: Sentence[] = [];
  let start = 0;
  const push = (end: number) => {
    let s = start;
    while (s < end && /\s/.test(text[s])) s++;
    let e = end;
    while (e > s && /\s/.test(text[e - 1])) e--;
    if (e > s) result.push([s, e]);
  };
  for (const m of text.matchAll(BOUNDARY)) {
    const at = m.index!;
    if (m[0].startsWith(".") && m[0].length === 1) {
      const word = previousWord(text, at);
      // Инициал (одна заглавная буква) или сокращение: предложение не кончается.
      if (/^\p{Lu}$/u.test(word) || ABBREVIATIONS.has(word.toLowerCase())) continue;
    }
    const end = at + m[0].length;
    push(end);
    start = end;
  }
  push(text.length);
  return result;
}

// Перевод строки — граница абзаца: предложение через него не переходит
// (заголовок без точки не склеивается со следующим абзацем).
export function splitSentences(text: string): Sentence[] {
  const result: Sentence[] = [];
  let offset = 0;
  for (const line of text.split("\n")) {
    for (const [s, e] of splitLine(line)) result.push([s + offset, e + offset]);
    offset += line.length + 1;
  }
  return result;
}
