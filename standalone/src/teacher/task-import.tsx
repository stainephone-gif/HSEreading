import { useRef, useState } from "react";
import { latinSlug } from "@/kiosk/session";
import type { PageText } from "~/pages";
import { describeTask, type Project } from "~/project";
import {
  csvTemplate,
  exportTasksCsv,
  exportTasksXml,
  type ImportPreview,
  previewImport,
  XML_SAMPLE,
} from "~/task-import";
import { download } from "./files";

const FORMAT_LABEL = { CHOICE: "выбор варианта", SELECTION: "выделить предложение", SHORT: "короткий ответ" } as const;

// Задания из файла (XML, CSV из Excel, JSON): сначала проверка по строкам,
// потом добавить верные или заменить ими все текущие.
export function TaskImport({
  project,
  pages,
  onApply,
}: {
  project: Project;
  pages: PageText[];
  // replace: заменить ими все текущие задания.
  onApply: (tasks: Project["tasks"], replace?: boolean) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<(ImportPreview & { file: string }) | null>(null);
  const slug = latinSlug(project.title, 40) || "text";
  const rows = preview && "rows" in preview ? preview.rows : [];
  const ok = rows.flatMap((r) => (typeof r.result === "string" ? [] : [r.result]));
  const bad = rows.length - ok.length;

  return (
    <details>
      <summary>Загрузить задания из файла</summary>
      <div className="stack" style={{ marginTop: 12, gap: 12 }}>
        <p className="muted small" style={{ margin: 0 }}>
          XML, CSV (из Excel) или JSON. Эталонное предложение для выделения указывайте текстом, можно началом фразы:
          конструктор сам найдёт его на странице. Задания проверяются так же, как в форме.
        </p>
        <div className="row">
          <button type="button" onClick={() => input.current?.click()}>
            Выбрать файл
          </button>
          <input
            ref={input}
            type="file"
            accept=".xml,.csv,.json,.txt,text/xml,application/xml,text/csv,application/json"
            hidden
            aria-label="Файл с заданиями"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              setPreview({ ...previewImport(project, pages, file.name, await file.text()), file: file.name });
            }}
          />
          <button
            type="button"
            className="link small"
            onClick={() => download("polya-zadaniya-shablon.csv", csvTemplate(pages), "text/csv;charset=utf-8")}
          >
            Шаблон CSV (Excel)
          </button>
          <button
            type="button"
            className="link small"
            onClick={() => download("polya-zadaniya-obrazets.xml", XML_SAMPLE, "application/xml")}
          >
            Образец XML
          </button>
          {project.tasks.length > 0 && (
            <>
              <button
                type="button"
                className="link small"
                onClick={() =>
                  download(`polya-zadaniya-${slug}.csv`, exportTasksCsv(project), "text/csv;charset=utf-8")
                }
              >
                Выгрузить задания: CSV
              </button>
              <button
                type="button"
                className="link small"
                onClick={() => download(`polya-zadaniya-${slug}.xml`, exportTasksXml(project), "application/xml")}
              >
                XML
              </button>
            </>
          )}
        </div>

        {preview && "error" in preview && (
          <p className="error" style={{ margin: 0 }}>
            {preview.file}: {preview.error}
          </p>
        )}
        {rows.length > 0 && (
          <div className="stack" style={{ gap: 8 }}>
            <p style={{ margin: 0 }}>
              {preview!.file}: <b>верных {ok.length}</b>
              {bad > 0 && <span className="error">, с ошибками {bad}</span>}
            </p>
            <ol className="teacher-tasks">
              {rows.map((r, i) => (
                <li key={i} style={{ padding: "4px 0" }}>
                  {typeof r.result === "string" ? (
                    <span className="error">
                      ✗ {r.label}: {r.result}
                    </span>
                  ) : (
                    <span>
                      ✓ {r.label}: {r.result.prompt.slice(0, 90)}{" "}
                      <span className="muted small">
                        · {describeTask(r.result)} · {FORMAT_LABEL[r.result.format]}
                      </span>
                    </span>
                  )}
                </li>
              ))}
            </ol>
            <div className="row">
              <button
                type="button"
                disabled={ok.length === 0}
                onClick={() => {
                  onApply(ok);
                  setPreview(null);
                }}
              >
                Добавить верные ({ok.length})
              </button>
              <button
                type="button"
                className="secondary"
                disabled={ok.length === 0}
                onClick={() => {
                  const sure =
                    project.tasks.length === 0 ||
                    window.confirm(`Заменить все текущие задания (${project.tasks.length}) на ${ok.length} новых?`);
                  if (!sure) return;
                  onApply(ok, true);
                  setPreview(null);
                }}
              >
                Заменить все текущие
              </button>
              <button type="button" className="link" onClick={() => setPreview(null)}>
                Отменить
              </button>
            </div>
            <p className="muted small" style={{ margin: 0 }}>
              После импорта скачайте ключ преподавателя и читалку заново.
            </p>
          </div>
        )}
      </div>
    </details>
  );
}
