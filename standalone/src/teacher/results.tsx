import { useState } from "react";
import { formatPoints, TASK_POINTS } from "@/lib/scoring";
import type { Project } from "~/project";
import { describeTask } from "~/project";
import {
  buildResults,
  type CellState,
  type Grades,
  type LoadedReport,
  openReportFile,
  type Report,
  resultsToCsv,
} from "~/results";
import { latinSlug } from "@/kiosk/session";
import { download } from "./files";

const CELL: Record<CellState, { mark: string; label: string; className: string }> = {
  pass: { mark: "✓", label: "засчитано", className: "result-pass" },
  fail: { mark: "✗", label: "не засчитано", className: "result-fail" },
  pending: { mark: "?", label: "ждёт проверки", className: "result-pending" },
  late: { mark: "⌛", label: "ответ после дедлайна, не засчитан", className: "result-fail" },
  found: { mark: "○", label: "найдено, нет ответа", className: "result-none" },
  hidden: { mark: "—", label: "не найдено", className: "result-none" },
};

// Оценки коротких ответов хранятся в этом браузере, по читалке.
function useGrades(exportId: string): [Grades, (key: string, grade: "PASS" | "FAIL" | null) => void] {
  const storageKey = `polya-grades:${exportId}`;
  const [grades, setGrades] = useState<Grades>(() => {
    try {
      return JSON.parse(localStorage.getItem(storageKey) ?? "{}") as Grades;
    } catch {
      return {};
    }
  });
  const set = (key: string, grade: "PASS" | "FAIL" | null) => {
    const next = { ...grades };
    if (grade) next[key] = grade;
    else delete next[key];
    setGrades(next);
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      // Без хранилища оценки живут до закрытия вкладки.
    }
  };
  return [grades, set];
}

export function Results({ project }: { project: Project }) {
  const [loaded, setLoaded] = useState<{ content: string; result: LoadedReport }[]>([]);
  const [grades, setGrade] = useGrades(project.exportId);
  const reports: Report[] = loaded.flatMap((l) => ("report" in l.result ? [l.result.report] : []));
  const errors = loaded.flatMap((l) => ("error" in l.result ? [l.result] : []));
  const rows = buildResults(project, reports, grades);
  const pending = rows.reduce((n, r) => n + r.cells.filter((c) => c.state === "pending").length, 0);
  const average = rows.length ? rows.reduce((s, r) => s + r.points, 0) / rows.length : 0;

  const addFiles = async (files: FileList) => {
    const next = [...loaded];
    for (const file of Array.from(files)) {
      const content = await file.text();
      // Один и тот же файл дважды не считается.
      if (next.some((l) => l.content === content)) continue;
      next.push({ content, result: openReportFile(project, file.name, content) });
    }
    setLoaded(next);
  };

  return (
    <div className="stack" style={{ gap: 36 }}>
      <section className="stack" style={{ gap: 12 }}>
        <p style={{ margin: 0 }}>
          Выберите файлы отчётов, которые прислали студенты (.polya). Можно все сразу и можно добавлять ещё. Если от
          студента несколько отчётов, засчитывается лучшее чтение и последние ответы.
        </p>
        <input
          type="file"
          accept=".polya,text/plain"
          multiple
          onChange={(e) => e.target.files && addFiles(e.target.files)}
        />
        <p className="muted small" style={{ margin: 0 }}>
          Отчёты не сохраняются: при следующем открытии выберите их снова. Ваши оценки коротких ответов запоминаются в
          этом браузере.
        </p>
        {errors.length > 0 && (
          <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
            {errors.map((e, i) => (
              <li key={i}>
                <b>{e.file}</b>: <span className="error">{e.error}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {rows.length > 0 && (
        <>
          <section className="stat-row" aria-label="Сводка">
            <div className="stack" style={{ gap: 6 }}>
              <span className="stat-value">{rows.length}</span>
              <span className="muted small">студентов прислали отчёт</span>
            </div>
            <div className="stack" style={{ gap: 6 }}>
              <span className="stat-value">{formatPoints(average)}</span>
              <span className="muted small">средний балл за задания (из {TASK_POINTS})</span>
            </div>
            <div className="stack" style={{ gap: 6 }}>
              <span className={`stat-value${pending ? " result-pending" : ""}`}>{pending}</span>
              <span className="muted small">ответов ждут проверки</span>
            </div>
          </section>

          <section className="stack">
            <div className="row">
              <h2 style={{ margin: 0 }}>Кто что нашёл</h2>
              <span className="spacer" />
              <button
                type="button"
                className="secondary"
                onClick={() =>
                  download(
                    `polya-rezultaty-${latinSlug(project.title, 40) || "text"}.csv`,
                    resultsToCsv(project, rows),
                    "text/csv",
                  )
                }
              >
                Скачать CSV
              </button>
            </div>
            <div className="table-wrap">
              <table className="summary">
                <thead>
                  <tr>
                    <th>Студент</th>
                    <th className="num">Страниц</th>
                    <th className="num">Минут</th>
                    {project.tasks.map((t, i) => (
                      <th key={t.id} className="num" title={t.prompt}>
                        {i + 1}
                      </th>
                    ))}
                    <th className="num">Баллы</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.email}>
                      <td>
                        {r.name}
                        <div className="muted small">
                          {r.email}
                          {r.instances > 1 && ` · читал(а) на ${r.instances} устройствах`}
                        </div>
                      </td>
                      <td className="num">
                        {r.readPages}/{project.pages.length}
                      </td>
                      <td className="num">{r.minutes}</td>
                      {r.cells.map((c, i) => (
                        <td
                          key={i}
                          className={`num result-cell ${CELL[c.state].className}`}
                          title={CELL[c.state].label}
                        >
                          {CELL[c.state].mark}
                        </td>
                      ))}
                      <td className="num">{formatPoints(r.points)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="muted small" style={{ margin: 0 }}>
              {Object.values(CELL)
                .map((c) => `${c.mark} ${c.label}`)
                .join(" · ")}
            </p>
          </section>

          <section className="stack">
            <h2 style={{ margin: 0 }}>Ответы</h2>
            {project.tasks.map((t, i) => {
              const answers = rows.map((r) => ({ row: r, cell: r.cells[i] })).filter((x) => x.cell.answer !== null);
              return (
                <details key={t.id} open={t.format === "SHORT" && answers.some((a) => a.cell.state === "pending")}>
                  <summary>
                    {i + 1}. {t.prompt}{" "}
                    <span className="muted small">
                      · {describeTask(t)} · ответов: {answers.length}
                    </span>
                  </summary>
                  <ul className="answer-list">
                    {answers.map(({ row, cell }) => (
                      <li key={row.email} className="row" style={{ alignItems: "baseline" }}>
                        <span className={`result-cell ${CELL[cell.state].className}`} title={CELL[cell.state].label}>
                          {CELL[cell.state].mark}
                        </span>
                        <span style={{ flex: "1 1 300px" }}>
                          <b>{row.name}</b>: {cell.answer}
                        </span>
                        {cell.gradeKey && cell.state !== "late" && (
                          <span className="row" style={{ gap: 8 }}>
                            <button
                              type="button"
                              className="small secondary"
                              aria-pressed={cell.state === "pass"}
                              onClick={() => setGrade(cell.gradeKey!, cell.state === "pass" ? null : "PASS")}
                            >
                              Засчитать
                            </button>
                            <button
                              type="button"
                              className="small secondary"
                              aria-pressed={cell.state === "fail"}
                              onClick={() => setGrade(cell.gradeKey!, cell.state === "fail" ? null : "FAIL")}
                            >
                              Не засчитать
                            </button>
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </details>
              );
            })}
          </section>
        </>
      )}
    </div>
  );
}
