// Один скрипт на двоих: без данных книги он конструктор преподавателя, с
// данными (в файле, который конструктор собрал) — читалка студента.

// Воркер PDF.js работает в основном потоке: отдельный файл воркера из файла,
// открытого с диска, браузеры не загружают.
import * as pdfjsWorker from "pdfjs-dist/legacy/build/pdf.worker.mjs";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/inter";
import "@/app/globals.css";
import { KioskApp } from "@/kiosk/app";
import { KioskStore } from "@/kiosk/session";
import { fromBase64, unpackKeys } from "@/lib/kiosk-crypto";
import type { KioskData } from "@/lib/kiosk-engine";
import { TeacherApp } from "./teacher/app";
import "./teacher/teacher.css";

(globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = pdfjsWorker;

const root = createRoot(document.getElementById("root")!);
const dataEl = document.getElementById("polya-data");
if (!dataEl) {
  root.render(<TeacherApp />);
} else {
  try {
    const data = JSON.parse(dataEl.textContent!) as KioskData;
    const pdf = fromBase64(document.getElementById("polya-pdf")!.textContent!.trim());
    root.render(<KioskApp store={new KioskStore(data, unpackKeys(data.exportId, data.keys))} pdf={pdf} />);
  } catch (err) {
    console.error(err);
    root.render(<p className="error">Файл читалки повреждён. Попросите преподавателя прислать его заново.</p>);
  }
}
