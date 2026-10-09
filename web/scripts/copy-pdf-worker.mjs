// Legacy-сборка: в ней полифилы для браузеров, где ещё нет новых методов Map и т. п.
// Воркер PDF.js отдаётся как статический файл: так он одинаково работает в dev и в сборке.
import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const src = require.resolve("pdfjs-dist/legacy/build/pdf.worker.min.mjs");
mkdirSync("public/pdfjs", { recursive: true });
copyFileSync(src, "public/pdfjs/pdf.worker.min.mjs");
