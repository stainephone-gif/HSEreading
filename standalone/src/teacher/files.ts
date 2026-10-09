import { getDocument, type PDFDocumentProxy } from "pdfjs-dist/legacy/build/pdf.mjs";

export function download(name: string, content: string, type = "text/plain") {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

// PDF.js забирает буфер себе, поэтому ему отдаётся копия.
export async function openPdf(pdf: Uint8Array): Promise<{ doc: PDFDocumentProxy; close: () => Promise<void> }> {
  const task = getDocument({ data: pdf.slice() });
  return { doc: await task.promise, close: () => task.destroy() };
}

// Скрипт и стили конструктора: из них же собирается файл читалки.
export function ownBundle(): { js: string; css: string } | null {
  const js = document.getElementById("polya-app")?.textContent;
  const css = document.getElementById("polya-style")?.textContent;
  return js && css ? { js, css } : null;
}

// Дедлайн в поле datetime-local — по часам этого компьютера.
export function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fromLocalInput(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
