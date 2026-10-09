import type { FragmentLine, Sentence } from "./pdf-service";

export type Rect = { page: number; x0: number; y0: number; x1: number; y1: number };

// Прямоугольники предложения на странице. Внутри строки положение символа
// оценивается пропорционально его номеру: для выбора предложения кликом этого хватает.
export function sentenceRects(lines: FragmentLine[], [start, end]: Sentence): Rect[] {
  const rects: Rect[] = [];
  for (const line of lines) {
    if (line.end <= start || line.start >= end) continue;
    const len = Math.max(1, line.end - line.start);
    const [x0, y0, x1, y1] = line.bbox;
    const from = (Math.max(start, line.start) - line.start) / len;
    const to = (Math.min(end, line.end) - line.start) / len;
    rects.push({ page: line.page, x0: x0 + (x1 - x0) * from, y0, x1: x0 + (x1 - x0) * to, y1 });
  }
  return rects;
}
