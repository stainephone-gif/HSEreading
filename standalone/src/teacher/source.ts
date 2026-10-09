// Книга из файла преподавателя: PDF (страницы как в файле) или DOCX (текст,
// поделённый на страницы).

import { DocxError, extractDocx, isDocx } from "~/docx";
import { extractPages, type PageText } from "~/pages";
import type { SourceKind } from "~/project";
import { openPdf } from "./files";

export const BOOK_ACCEPT =
  "application/pdf,.pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.docx";

export async function readBook(
  bytes: Uint8Array,
  onProgress?: (done: number, total: number) => void,
): Promise<{ pages: PageText[]; source: SourceKind } | string> {
  if (isDocx(bytes)) {
    try {
      return { pages: extractDocx(bytes), source: "docx" };
    } catch (err) {
      if (err instanceof DocxError) return err.message;
      throw err;
    }
  }
  if (new TextDecoder().decode(bytes.subarray(0, 1024)).includes("%PDF")) {
    const { doc, close } = await openPdf(bytes);
    try {
      const pages = await extractPages(doc, onProgress);
      if (pages.every((p) => p.words === 0)) return "В PDF нет текстового слоя (это скан?). Нужен PDF с текстом.";
      return { pages, source: "pdf" };
    } finally {
      await close();
    }
  }
  if (bytes[0] === 0xd0 && bytes[1] === 0xcf) return "Это старый формат Word (.doc): сохраните документ как .docx.";
  return "Нужен файл PDF или DOCX.";
}
