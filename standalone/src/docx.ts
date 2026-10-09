// Книга из DOCX: абзацы текста из word/document.xml. Страниц в DOCX нет,
// поэтому текст делится на страницы примерно по WORDS_PER_PAGE слов, по
// границам абзацев: к ним привязываются задания и учёт дочитывания.

import { unzipSync } from "fflate";
import { countWords } from "@/lib/fragments";
import type { PageText } from "./pages";
import { splitSentences } from "./sentences";

export const WORDS_PER_PAGE = 350;

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

export class DocxError extends Error {}

export function isDocx(bytes: Uint8Array): boolean {
  return bytes[0] === 0x50 && bytes[1] === 0x4b;
}

// Текст абзацев документа по порядку (с таблицами, без сносок и колонтитулов).
export function docxParagraphs(bytes: Uint8Array): string[] {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, { filter: (f) => f.name === "word/document.xml" });
  } catch {
    throw new DocxError("Файл повреждён или это не DOCX.");
  }
  const xml = files["word/document.xml"];
  if (!xml) throw new DocxError("Это не документ Word (DOCX).");
  const doc = new DOMParser().parseFromString(new TextDecoder().decode(xml), "application/xml");
  if (doc.getElementsByTagName("parsererror").length) throw new DocxError("Файл DOCX повреждён.");

  const paragraphs: string[] = [];
  const all = Array.from(doc.getElementsByTagName("*"));
  for (const p of all.filter((el) => el.namespaceURI === W && el.localName === "p")) {
    let text = "";
    const walk = (node: Element) => {
      for (const child of Array.from(node.children)) {
        if (child.namespaceURI !== W) continue;
        const name = child.localName;
        if (name === "t") text += child.textContent ?? "";
        else if (name === "tab" || name === "br" || name === "cr") text += " ";
        else if (name === "noBreakHyphen") text += "-";
        // Удалённый при рецензировании текст и вложенные абзацы (надписи) не берём.
        else if (name !== "del" && name !== "p" && name !== "txbxContent") walk(child);
      }
    };
    walk(p);
    text = text.replace(/\s+/g, " ").trim();
    if (text) paragraphs.push(text);
  }
  return paragraphs;
}

// Абзацы раскладываются по страницам; слишком длинный абзац режется по предложениям.
export function paginate(paragraphs: string[], wordsPerPage = WORDS_PER_PAGE): PageText[] {
  const pieces: string[] = [];
  for (const para of paragraphs) {
    if (countWords(para) <= wordsPerPage * 1.5) {
      pieces.push(para);
      continue;
    }
    let chunk = "";
    for (const [s, e] of splitSentences(para)) {
      const sentence = para.slice(s, e);
      if (chunk && countWords(chunk) + countWords(sentence) > wordsPerPage) {
        pieces.push(chunk);
        chunk = "";
      }
      chunk = chunk ? `${chunk} ${sentence}` : sentence;
    }
    if (chunk) pieces.push(chunk);
  }

  const pages: string[][] = [];
  let current: string[] = [];
  let count = 0;
  for (const piece of pieces) {
    const n = countWords(piece);
    if (current.length && count + n > wordsPerPage) {
      pages.push(current);
      current = [];
      count = 0;
    }
    current.push(piece);
    count += n;
  }
  if (current.length) pages.push(current);

  return pages.map((paras) => {
    // Абзацы разделены переводом строки: читалка показывает их отдельно.
    const content = paras.join("\n");
    return {
      width: 0,
      height: 0,
      content,
      lines: [],
      sentences: splitSentences(content),
      words: countWords(content),
    };
  });
}

export function extractDocx(bytes: Uint8Array): PageText[] {
  const paragraphs = docxParagraphs(bytes);
  if (paragraphs.length === 0) throw new DocxError("В документе нет текста.");
  return paginate(paragraphs);
}
