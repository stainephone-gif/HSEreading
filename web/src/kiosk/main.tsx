// Точка входа офлайн-читалки. Собирается отдельно (npm run build:kiosk) в один
// скрипт, который сервер вставляет в HTML-файл вместе с данными и PDF.

// Воркер PDF.js работает в основном потоке: отдельный файл воркера из файла,
// открытого с диска, браузеры не загружают.
import * as pdfjsWorker from "pdfjs-dist/legacy/build/pdf.worker.mjs";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/inter";
import "@/app/globals.css";
import { fromBase64, unpackKeys } from "@/lib/kiosk-crypto";
import type { KioskData } from "@/lib/kiosk-engine";
import { KioskApp } from "./app";
import { KioskStore } from "./session";

(globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = pdfjsWorker;

const root = createRoot(document.getElementById("root")!);
try {
  const data = JSON.parse(document.getElementById("polya-data")!.textContent!) as KioskData;
  const pdf = fromBase64(document.getElementById("polya-pdf")!.textContent!.trim());
  root.render(<KioskApp store={new KioskStore(data, unpackKeys(data.exportId, data.keys))} pdf={pdf} />);
} catch (err) {
  console.error(err);
  root.render(<p className="error">Файл читалки повреждён. Попросите преподавателя прислать его заново.</p>);
}
