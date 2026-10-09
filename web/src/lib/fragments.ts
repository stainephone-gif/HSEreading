// Правка разбивки текста на фрагменты: склейка и разрезание по границе предложения.
// Чистые функции, чтобы их можно было проверить без базы.

import type { FragmentLine, Sentence } from "./pdf-service";

export type FragmentData = {
  content: string;
  wordCount: number;
  lines: FragmentLine[];
  sentences: Sentence[];
};

const TERMINAL = /[.!?…:;]["»”’)\]]*$/;
const WORD = /[\p{L}\p{N}_][\p{L}\p{N}_'’-]*/gu;

export function countWords(text: string): number {
  return text.match(WORD)?.length ?? 0;
}

// Время, после которого открывается маркер: половина расчётного времени чтения.
export function unlockSeconds(wordCount: number, wordsPerMinute: number): number {
  return Math.round(((wordCount / wordsPerMinute) * 60) / 2);
}

function shiftLines(lines: FragmentLine[], by: number): FragmentLine[] {
  return lines.map((l) => ({ ...l, start: l.start + by, end: l.end + by }));
}

export function mergeFragments(a: FragmentData, b: FragmentData): FragmentData {
  const offset = a.content.length + 1;
  const content = `${a.content} ${b.content}`;
  const bSentences = b.sentences.map(([s, e]): Sentence => [s + offset, e + offset]);

  let sentences: Sentence[];
  if (a.sentences.length && bSentences.length && !TERMINAL.test(a.content)) {
    // Фраза была разорвана между фрагментами: склеиваем последнее и первое предложения.
    const last = a.sentences[a.sentences.length - 1];
    sentences = [...a.sentences.slice(0, -1), [last[0], bSentences[0][1]], ...bSentences.slice(1)];
  } else {
    sentences = [...a.sentences, ...bSentences];
  }

  return {
    content,
    wordCount: a.wordCount + b.wordCount,
    lines: [...a.lines, ...shiftLines(b.lines, offset)],
    sentences,
  };
}

// Режет фрагмент перед предложением с номером index (1 ≤ index < числа предложений).
export function splitFragment(f: FragmentData, index: number): [FragmentData, FragmentData] {
  if (!Number.isInteger(index) || index < 1 || index >= f.sentences.length) {
    throw new Error("Разрезать можно только между предложениями.");
  }
  const cut = f.sentences[index][0];
  const firstContent = f.content.slice(0, cut).trimEnd();
  const firstEnd = firstContent.length;
  const secondContent = f.content.slice(cut);

  // Строка, на которой проходит разрез, достаётся обеим частям.
  const firstLines = f.lines.filter((l) => l.start < firstEnd).map((l) => ({ ...l, end: Math.min(l.end, firstEnd) }));
  const secondLines = f.lines
    .filter((l) => l.end > cut)
    .map((l) => ({ ...l, start: Math.max(l.start, cut) - cut, end: l.end - cut }));

  return [
    {
      content: firstContent,
      wordCount: countWords(firstContent),
      lines: firstLines,
      sentences: f.sentences.slice(0, index),
    },
    {
      content: secondContent,
      wordCount: countWords(secondContent),
      lines: secondLines,
      sentences: f.sentences.slice(index).map(([s, e]): Sentence => [s - cut, e - cut]),
    },
  ];
}
