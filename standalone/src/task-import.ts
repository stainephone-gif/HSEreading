// Задания из файла: XML, CSV (из Excel) или JSON. Любой формат сводится к
// одинаковым строкам, а строки проверяются так же, как задания из формы.
// Выгрузка текущих заданий — в XML или CSV, чтобы поправить и загрузить снова.

import type { PageText } from "./pages";
import { createTask, type Project, type ProjectTask, type TaskInput } from "./project";

// Задание из файла до проверки: все поля — как написал преподаватель.
export type RawTask = {
  type: string;
  // Страница задания или начало диапазона раскиданного (с 1).
  page: string;
  to: string;
  prompt: string;
  options: string[];
  // Верный вариант: номер (с 1) или его текст.
  correct: string;
  // Эталонное предложение для выделения.
  reference: string;
};

export type ImportRow = { label: string; result: ProjectTask | string };
export type ImportPreview = { error: string } | { rows: ImportRow[] };

const TYPES: Record<string, "choice" | "selection" | "short" | "scattered"> = {
  choice: "choice",
  выбор: "choice",
  "выбор варианта": "choice",
  selection: "selection",
  выделение: "selection",
  выделить: "selection",
  "выделить предложение": "selection",
  short: "short",
  короткий: "short",
  "короткий ответ": "short",
  scattered: "scattered",
  раскидать: "scattered",
  раскидано: "scattered",
  "раскидать по страницам": "scattered",
};

// Названия колонок CSV и полей JSON (сравниваются без регистра, пробелов и знаков).
const FIELDS: Record<Exclude<keyof RawTask, "options">, string[]> = {
  type: ["тип", "type", "формат", "format"],
  page: ["стр", "страница", "page", "строт", "страницаот", "from", "pagefrom"],
  to: ["стрдо", "страницадо", "to", "pageto"],
  prompt: ["задание", "prompt", "вопрос", "question"],
  correct: ["верный", "верныйвариант", "correct", "answer", "ответ"],
  reference: ["эталон", "эталонноепредложение", "reference", "sentence"],
};

const CSV_HEADER = [
  "тип",
  "стр_от",
  "стр_до",
  "задание",
  "вар1",
  "вар2",
  "вар3",
  "вар4",
  "вар5",
  "вар6",
  "верный",
  "эталон",
];

function words(s: unknown): string {
  return String(s ?? "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

const key = (s: unknown) => words(s).replace(/ /g, "");

function rawFrom(entries: [string, unknown][]): RawTask {
  const raw: RawTask = { type: "", page: "", to: "", prompt: "", options: [], correct: "", reference: "" };
  for (const [name, value] of entries) {
    const k = key(name);
    if (Array.isArray(value) && (k === "варианты" || k === "options")) {
      raw.options = value.map((x) => String(x ?? ""));
      continue;
    }
    const opt = /^(?:вар|вариант|option|opt)(\d)$/.exec(k);
    if (opt) {
      raw.options[Number(opt[1]) - 1] = String(value ?? "");
      continue;
    }
    for (const [field, names] of Object.entries(FIELDS)) {
      if (names.includes(k)) {
        raw[field as keyof typeof FIELDS] = String(value ?? "");
        break;
      }
    }
  }
  raw.options = Array.from(raw.options, (o) => o ?? "");
  return raw;
}

// Разбор файла

// CSV из Excel: разделитель — точка с запятой, табуляция или запятая (что
// чаще встречается в первой строке), поля в кавычках могут содержать переносы.
export function splitCsv(text: string): string[][] {
  text = text.replace(/^﻿/, "");
  const first = text.split(/\r?\n/, 1)[0];
  const delim = [";", "\t", ","].map((d) => [d, first.split(d).length] as const).sort((a, b) => b[1] - a[1])[0][0];
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delim) {
      row.push(cur);
      cur = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cur);
      rows.push(row);
      row = [];
      cur = "";
    } else cur += ch;
  }
  if (cur !== "" || row.length) {
    row.push(cur);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

const clean = (el: Element | null | undefined) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();

function parseXml(text: string): { label: string; raw: RawTask }[] | string {
  const doc = new DOMParser().parseFromString(text.replace(/^﻿/, ""), "application/xml");
  if (doc.getElementsByTagName("parsererror").length || doc.documentElement?.nodeName !== "tasks") {
    return "Это не XML с заданиями: нужен корневой тег <tasks>. Скачайте образец.";
  }
  const items = Array.from(doc.documentElement.children).filter((el) => el.nodeName === "task");
  return items.map((el, i) => {
    const options = Array.from(el.getElementsByTagName("option"));
    const correct = options.findIndex((o) => /^(true|1|yes|да)$/i.test((o.getAttribute("correct") ?? "").trim()));
    return {
      label: `задание ${i + 1}`,
      raw: {
        type: el.getAttribute("type") ?? "",
        page: el.getAttribute("page") ?? el.getAttribute("from") ?? "",
        to: el.getAttribute("to") ?? "",
        prompt: clean(el.getElementsByTagName("prompt")[0]),
        options: options.map(clean),
        correct: correct >= 0 ? String(correct + 1) : "",
        reference: clean(el.getElementsByTagName("answer")[0]),
      },
    };
  });
}

export function parseTaskFile(name: string, text: string): { label: string; raw: RawTask }[] | string {
  const body = text.replace(/^﻿/, "").trimStart();
  if (/\.xml$/i.test(name) || body.startsWith("<")) return parseXml(text);
  if (/\.json$/i.test(name) || /^[[{]/.test(body)) {
    let data: unknown;
    try {
      data = JSON.parse(body);
    } catch (err) {
      return `Не удалось разобрать JSON: ${(err as Error).message}`;
    }
    const list = Array.isArray(data) ? data : (data as { tasks?: unknown })?.tasks;
    if (!Array.isArray(list)) return "В JSON нужен массив заданий или поле tasks.";
    return list.map((o, i) => ({
      label: `задание ${i + 1}`,
      raw: rawFrom(Object.entries((o ?? {}) as Record<string, unknown>)),
    }));
  }
  const rows = splitCsv(text);
  if (rows.length < 2) return "В файле нет строк с заданиями.";
  const header = rows[0];
  if (!header.some((h) => FIELDS.prompt.includes(key(h)))) {
    return "В первой строке не найдена колонка «задание». Скачайте шаблон и сверьте заголовки.";
  }
  return rows.slice(1).map((cells, i) => ({
    label: `строка ${i + 2}`,
    raw: rawFrom(header.map((h, j) => [h, cells[j] ?? ""])),
  }));
}

// Эталонное предложение

// Текст без регистра, пробелов и знаков со ссылкой на позицию в исходнике.
function letters(text: string): { chars: string; at: number[] } {
  let chars = "";
  const at: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const c = text[i].toLowerCase().replace("ё", "е");
    if (/[\p{L}\p{N}]/u.test(c)) {
      chars += c;
      at.push(i);
    }
  }
  return { chars, at };
}

// Номер предложения страницы по тексту эталона: сначала точное вхождение
// (без учёта кавычек, регистра и переносов), потом похожее по словам.
export function findSentence(page: PageText, reference: string): number | string {
  const needle = letters(reference).chars;
  if (!needle) return "Не указано эталонное предложение.";
  const hay = letters(page.content);
  const pos = hay.chars.indexOf(needle);
  if (pos >= 0) {
    const [from, to] = [hay.at[pos], hay.at[pos + needle.length - 1] + 1];
    let best = -1;
    let most = 0;
    page.sentences.forEach(([s, e], i) => {
      const overlap = Math.min(e, to) - Math.max(s, from);
      if (overlap > most) [best, most] = [i, overlap];
    });
    if (best >= 0) return best;
  }
  const q = new Set(words(reference).split(" "));
  let best = -1;
  let score = 0;
  page.sentences.forEach(([s, e], i) => {
    const w = new Set(words(page.content.slice(s, e)).split(" "));
    const common = [...q].filter((x) => w.has(x)).length;
    const jaccard = common / (q.size + w.size - common);
    if (jaccard > score) [best, score] = [i, jaccard];
  });
  if (best >= 0 && score >= 0.6) return best;
  const nearest = best >= 0 ? `. Ближайшее: «${page.content.slice(...page.sentences[best]).slice(0, 90)}»` : "";
  return `Эталонное предложение не найдено на странице${nearest}`;
}

// Проверка строки

const num = (v: string) => (v.trim() === "" ? NaN : Number(v.trim()));

export function buildTask(project: Project, pages: PageText[], raw: RawTask): ProjectTask | string {
  const type = TYPES[words(raw.type)];
  if (!type) return `Неизвестный тип «${raw.type}». Допустимо: выбор, выделение, короткий, раскидать.`;
  const prompt = raw.prompt;
  if (type === "scattered") {
    return createTask(project, pages, { kind: "scattered", pageFrom: num(raw.page), pageTo: num(raw.to), prompt });
  }
  const n = num(raw.page);
  if (!Number.isInteger(n)) return "Не указана страница.";
  if (!pages[n - 1]) return `В тексте ${pages.length} стр., страницы ${n} нет.`;
  const page = n - 1;
  let input: TaskInput;
  if (type === "short") input = { kind: "page-short", page, prompt };
  else if (type === "selection") {
    const sentence = findSentence(pages[page], raw.reference);
    if (typeof sentence === "string") return sentence;
    input = { kind: "page-selection", page, prompt, sentenceIndex: sentence };
  } else {
    const options = raw.options.map((text, i) => ({ text: text.trim(), i })).filter((o) => o.text);
    const c = raw.correct.trim();
    const byNumber = Number(c);
    const correct =
      c === ""
        ? -1
        : Number.isInteger(byNumber) && byNumber >= 1
          ? byNumber - 1
          : raw.options.findIndex((o) => words(o) === words(c));
    if (!options.some((o) => o.i === correct)) return "Не указан верный вариант (номер от 1 или его текст).";
    input = {
      kind: "page-choice",
      page,
      prompt,
      options: options.map((o) => ({ text: o.text, correct: o.i === correct })),
    };
  }
  return createTask(project, pages, input);
}

export function previewImport(project: Project, pages: PageText[], name: string, text: string): ImportPreview {
  const parsed = parseTaskFile(name, text);
  if (typeof parsed === "string") return { error: parsed };
  if (parsed.length === 0) return { error: "В файле нет заданий." };
  return { rows: parsed.map(({ label, raw }) => ({ label, result: buildTask(project, pages, raw) })) };
}

// Образцы и выгрузка

export const XML_SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<!--
  Задания для читалки «Поля». Страницы нумеруются с 1.
  type="choice"     — выбор варианта: 2–6 <option>, верный отмечен correct="true".
  type="selection"  — выделить предложение: в <answer> текст эталонного
                      предложения со страницы (можно начало фразы).
  type="short"      — короткий ответ (до трёх предложений), проверяете вы.
  type="scattered"  — раскидать по страницам from–to: у каждого студента своя,
                      короткий ответ.
-->
<tasks>
  <task type="choice" page="3">
    <prompt>Какую мысль автор считает главной?</prompt>
    <option>Первый вариант</option>
    <option correct="true">Верный вариант</option>
    <option>Третий вариант</option>
  </task>
  <task type="selection" page="5">
    <prompt>Найдите предложение, в котором автор вводит термин.</prompt>
    <answer>Начало эталонного предложения</answer>
  </task>
  <task type="short" page="7">
    <prompt>Сформулируйте тезис страницы своими словами.</prompt>
  </task>
  <task type="scattered" from="10" to="20">
    <prompt>Перескажите эту страницу в двух предложениях.</prompt>
  </task>
</tasks>
`;

function csv(rows: (string | number)[][]): string {
  const field = (c: string | number) => {
    const s = String(c);
    return /[;",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return "﻿" + rows.map((r) => r.map(field).join(";")).join("\r\n") + "\r\n";
}

const csvRow = (
  type: string,
  from: number | string,
  to: number | string,
  prompt: string,
  options: string[],
  correct: number | string,
  reference: string,
) => [type, from, to, prompt, ...Array.from({ length: 6 }, (_, i) => options[i] ?? ""), correct, reference];

// Шаблон для Excel с примерами на страницах этой книги.
export function csvTemplate(pages: PageText[]): string {
  const i = pages.findIndex((p) => p.words > 0 && p.sentences.length > 0);
  const p = i >= 0 ? i + 1 : 1;
  const sentence = i >= 0 ? pages[i].content.slice(...pages[i].sentences[0]) : "";
  return csv([
    CSV_HEADER,
    csvRow(
      "выбор",
      p,
      "",
      "ПРИМЕР. Что автор утверждает на этой странице?",
      ["Первый вариант", "Второй вариант", "Третий вариант"],
      2,
      "",
    ),
    csvRow("выделение", p, "", "ПРИМЕР. Выделите предложение с главным тезисом", [], "", sentence),
    csvRow("короткий", p, "", "ПРИМЕР. Объясните в двух-трёх предложениях…", [], "", ""),
    csvRow("раскидать", 1, pages.length, "ПРИМЕР. Найдите на своей странице и перескажите главную мысль", [], "", ""),
  ]);
}

const TYPE_RU = { CHOICE: "выбор", SELECTION: "выделение", SHORT: "короткий" } as const;
const reference = (t: ProjectTask) => (t.answerRange && t.pageContent ? t.pageContent.slice(...t.answerRange) : "");

export function exportTasksCsv(project: Project): string {
  return csv([
    CSV_HEADER,
    ...project.tasks.map((t) =>
      t.page === null
        ? csvRow("раскидать", t.pageFrom ?? "", t.pageTo ?? "", t.prompt, [], "", "")
        : csvRow(
            TYPE_RU[t.format],
            t.page + 1,
            "",
            t.prompt,
            t.options?.map((o) => o.text) ?? [],
            t.options ? t.options.findIndex((o) => o.correct) + 1 : "",
            reference(t),
          ),
    ),
  ]);
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

export function exportTasksXml(project: Project): string {
  const body = project.tasks.map((t) => {
    const prompt = `    <prompt>${esc(t.prompt)}</prompt>`;
    if (t.page === null) return `  <task type="scattered" from="${t.pageFrom}" to="${t.pageTo}">\n${prompt}\n  </task>`;
    const page = t.page + 1;
    if (t.format === "CHOICE") {
      const options = (t.options ?? []).map(
        (o) => `    <option${o.correct ? ' correct="true"' : ""}>${esc(o.text)}</option>`,
      );
      return `  <task type="choice" page="${page}">\n${prompt}\n${options.join("\n")}\n  </task>`;
    }
    if (t.format === "SELECTION") {
      return `  <task type="selection" page="${page}">\n${prompt}\n    <answer>${esc(reference(t))}</answer>\n  </task>`;
    }
    return `  <task type="short" page="${page}">\n${prompt}\n  </task>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<tasks>\n${body.join("\n")}\n</tasks>\n`;
}
