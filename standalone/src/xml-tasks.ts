// Задания в XML: импорт пачкой и выгрузка для правки или переноса в другую
// читалку. Формат — см. XML_SAMPLE.

import type { Sentence } from "@/lib/pdf-service";
import type { PageText } from "./pages";
import { createTask, type Project, type ProjectTask, type TaskInput } from "./project";

export const XML_SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<!--
  Задания для читалки «Поля». Страницы нумеруются с 1, как в PDF-просмотрщике.
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

// Текст без регистра, пробелов и знаков препинания, со ссылкой на позицию в
// исходном тексте: так «эталон» находится, даже если в PDF другие кавычки или
// переносы строк.
function normalize(text: string): { chars: string; at: number[] } {
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

// Номер предложения страницы, в котором стоит текст эталона.
export function findSentence(page: PageText, answer: string): number | null {
  const needle = normalize(answer).chars;
  if (!needle) return null;
  const hay = normalize(page.content);
  const pos = hay.chars.indexOf(needle);
  if (pos < 0) return null;
  const range: Sentence = [hay.at[pos], hay.at[pos + needle.length - 1] + 1];
  // Предложение, больше всего пересекающееся с найденным местом.
  let best: number | null = null;
  let bestOverlap = 0;
  page.sentences.forEach(([s, e], i) => {
    const overlap = Math.min(e, range[1]) - Math.max(s, range[0]);
    if (overlap > bestOverlap) {
      best = i;
      bestOverlap = overlap;
    }
  });
  return best;
}

const text = (el: Element | null | undefined) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
const isTrue = (v: string | null) => /^(true|1|yes|да)$/i.test((v ?? "").trim());

export type XmlImport = { tasks: ProjectTask[]; errors: string[] };

export function importTasksXml(xml: string, project: Project, pages: PageText[]): XmlImport {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.getElementsByTagName("parsererror").length || doc.documentElement?.nodeName !== "tasks") {
    return { tasks: [], errors: ["Это не XML с заданиями: нужен корневой тег <tasks>. Скачайте образец."] };
  }
  const tasks: ProjectTask[] = [];
  const errors: string[] = [];
  const items = Array.from(doc.documentElement.children).filter((el) => el.nodeName === "task");
  if (items.length === 0) errors.push("В файле нет ни одного <task>.");

  items.forEach((el, i) => {
    const fail = (message: string) => errors.push(`Задание ${i + 1}: ${message}`);
    const type = (el.getAttribute("type") ?? "").trim();
    const prompt = text(el.getElementsByTagName("prompt")[0]);
    const pageAttr = Number(el.getAttribute("page"));
    const page = pageAttr - 1;
    const needsPage = type === "choice" || type === "selection" || type === "short";
    if (needsPage && (!Number.isInteger(pageAttr) || !pages[page])) {
      return fail(`укажите страницу от 1 до ${pages.length} в атрибуте page.`);
    }

    let input: TaskInput;
    if (type === "choice") {
      const options = Array.from(el.getElementsByTagName("option")).map((o) => ({
        text: text(o),
        correct: isTrue(o.getAttribute("correct")),
      }));
      input = { kind: "page-choice", page, prompt, options };
    } else if (type === "selection") {
      const answer = text(el.getElementsByTagName("answer")[0]);
      if (!answer) return fail("в <answer> нужен текст эталонного предложения.");
      const sentence = findSentence(pages[page], answer);
      if (sentence === null) return fail(`на стр. ${pageAttr} не найден текст «${answer.slice(0, 60)}».`);
      input = { kind: "page-selection", page, prompt, sentenceIndex: sentence };
    } else if (type === "short") {
      input = { kind: "page-short", page, prompt };
    } else if (type === "scattered") {
      input = {
        kind: "scattered",
        pageFrom: Number(el.getAttribute("from")),
        pageTo: Number(el.getAttribute("to")),
        prompt,
      };
    } else {
      return fail(`неизвестный тип «${type}»: нужен choice, selection, short или scattered.`);
    }
    const task = createTask(project, pages, input);
    if (typeof task === "string") fail(task[0].toLowerCase() + task.slice(1));
    else tasks.push(task);
  });
  return { tasks, errors };
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

// Текущие задания в том же формате.
export function exportTasksXml(project: Project): string {
  const body = project.tasks.map((t) => {
    const prompt = `    <prompt>${esc(t.prompt)}</prompt>`;
    if (t.page === null) {
      return `  <task type="scattered" from="${t.pageFrom}" to="${t.pageTo}">\n${prompt}\n  </task>`;
    }
    const page = t.page + 1;
    if (t.format === "CHOICE") {
      const options = (t.options ?? []).map(
        (o) => `    <option${o.correct ? ' correct="true"' : ""}>${esc(o.text)}</option>`,
      );
      return `  <task type="choice" page="${page}">\n${prompt}\n${options.join("\n")}\n  </task>`;
    }
    if (t.format === "SELECTION") {
      const answer = t.answerRange && t.pageContent ? t.pageContent.slice(...t.answerRange) : "";
      return `  <task type="selection" page="${page}">\n${prompt}\n    <answer>${esc(answer)}</answer>\n  </task>`;
    }
    return `  <task type="short" page="${page}">\n${prompt}\n  </task>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<tasks>\n${body.join("\n")}\n</tasks>\n`;
}
