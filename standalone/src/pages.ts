// Текст страниц PDF, извлечённый PDF.js прямо в браузере: строки с
// координатами, сплошной текст страницы и его предложения.

import type { PDFDocumentProxy } from "pdfjs-dist/legacy/build/pdf.mjs";
import { countWords } from "@/lib/fragments";
import type { FragmentLine, Sentence } from "@/lib/pdf-service";
import { splitSentences } from "./sentences";

export type PageText = {
  width: number;
  height: number;
  content: string;
  lines: FragmentLine[];
  sentences: Sentence[];
  words: number;
};

// Кусок текста PDF.js: строка, её левый нижний угол и размеры в пунктах.
export type TextPiece = { str: string; x: number; y: number; width: number; height: number; eol: boolean };

// Перевод точки страницы в координаты экрана при масштабе 1 (ось y вниз).
export type ToViewport = (x: number, y: number) => [number, number];

type RawLine = { text: string; x0: number; y0: number; x1: number; y1: number };

function groupLines(pieces: TextPiece[], toViewport: ToViewport): RawLine[] {
  const lines: RawLine[] = [];
  let current: (RawLine & { baseline: number; size: number }) | null = null;
  let breakNext = false;
  for (const p of pieces) {
    const [ax, ay] = toViewport(p.x, p.y + p.height);
    const [bx, by] = toViewport(p.x + p.width, p.y);
    const box = { x0: Math.min(ax, bx), y0: Math.min(ay, by), x1: Math.max(ax, bx), y1: Math.max(ay, by) };
    const size = Math.max(1, p.height);
    const sameLine = current && !breakNext && Math.abs(p.y - current.baseline) < size * 0.5;
    if (!sameLine && p.str.trim()) {
      if (current) lines.push(current);
      current = { text: p.str, ...box, baseline: p.y, size };
    } else if (current && p.str) {
      current.text += p.str;
      if (p.str.trim()) {
        current.x0 = Math.min(current.x0, box.x0);
        current.y0 = Math.min(current.y0, box.y0);
        current.x1 = Math.max(current.x1, box.x1);
        current.y1 = Math.max(current.y1, box.y1);
      }
    }
    breakNext = p.eol;
  }
  if (current) lines.push(current);
  return lines;
}

// Строки склеиваются в текст страницы. Перенос слова по слогам («чте-\nние»)
// склеивается обратно.
export function buildPage(
  pieces: TextPiece[],
  toViewport: ToViewport,
  page: number,
  size: { width: number; height: number },
): PageText {
  let content = "";
  const lines: FragmentLine[] = [];
  const raw = groupLines(pieces, toViewport)
    .map((l) => ({ ...l, text: l.text.replace(/\s+/g, " ").trim() }))
    .filter((l) => l.text);
  let glue = false;
  raw.forEach((l, i) => {
    const hyphen = /\p{L}[-‐\u00ad]$/u.test(l.text) && /^\p{Ll}/u.test(raw[i + 1]?.text ?? "");
    const text = hyphen ? l.text.slice(0, -1) : l.text;
    // После переноса следующая строка продолжает слово без пробела.
    if (content && !glue) content += " ";
    const start = content.length;
    content += text;
    lines.push({ page, bbox: [l.x0, l.y0, l.x1, l.y1], start, end: content.length });
    glue = hyphen;
  });
  return {
    width: size.width,
    height: size.height,
    content,
    lines,
    sentences: splitSentences(content),
    words: countWords(content),
  };
}

export async function extractPages(
  doc: PDFDocumentProxy,
  onProgress?: (done: number, total: number) => void,
): Promise<PageText[]> {
  const pages: PageText[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const viewport = page.getViewport({ scale: 1 });
    const text = await page.getTextContent();
    const pieces: TextPiece[] = [];
    for (const item of text.items) {
      if (!("str" in item)) continue;
      const [, , , , x, y] = item.transform as number[];
      pieces.push({ str: item.str, x, y, width: item.width, height: item.height, eol: item.hasEOL });
    }
    pages.push(
      buildPage(pieces, (x, y) => viewport.convertToViewportPoint(x, y) as [number, number], i - 1, {
        width: viewport.width,
        height: viewport.height,
      }),
    );
    page.cleanup();
    onProgress?.(i, doc.numPages);
  }
  return pages;
}
