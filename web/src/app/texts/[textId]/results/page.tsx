import Link from "next/link";
import { notFound } from "next/navigation";
import { AccessError } from "@/lib/courses";
import { type CellState, getTextResults } from "@/lib/results";
import { formatPoints, TASK_POINTS } from "@/lib/scoring";
import { requireUser } from "@/lib/session";
import { getTextForTeacher } from "@/lib/texts";
import { formatDateTime } from "@/lib/time";

const CELL: Record<CellState, { mark: string; label: string; className: string }> = {
  pass: { mark: "✓", label: "засчитано", className: "result-pass" },
  fail: { mark: "✗", label: "не засчитано", className: "result-fail" },
  pending: { mark: "?", label: "ждёт проверки", className: "result-pending" },
  found: { mark: "○", label: "найдено, нет ответа", className: "result-none" },
  hidden: { mark: "—", label: "не найдено", className: "result-none" },
};

export default async function ResultsPage({ params }: { params: Promise<{ textId: string }> }) {
  const { textId } = await params;
  const user = await requireUser(`/texts/${textId}/results`);
  const text = await getTextForTeacher(textId, user.id);
  if (!text) notFound();
  const results = await getTextResults(textId, user.id).catch((err) => {
    if (err instanceof AccessError) notFound();
    throw err;
  });

  const opened = results.rows.filter((r) => r.openedAt).length;
  const pending = results.rows.reduce((sum, r) => sum + r.pending, 0);
  const average = results.rows.length ? results.rows.reduce((sum, r) => sum + r.points, 0) / results.rows.length : 0;

  return (
    <main className="stack" style={{ gap: 48 }}>
      <div className="stack" style={{ gap: 12 }}>
        <p style={{ margin: 0 }}>
          <Link href={`/texts/${text.id}`}>← {text.title}</Link>
        </p>
        <span className="eyebrow">Результаты</span>
        <h1 style={{ margin: 0 }}>{text.title}</h1>
        <p className="muted" style={{ margin: 0 }}>
          {results.deadline ? `Дедлайн: ${formatDateTime(results.deadline)}.` : "Дедлайн не задан."} Задания дают до{" "}
          {TASK_POINTS} баллов поровну; засчитываются принятые ответы. Пасхалки добавятся позже.
        </p>
      </div>

      <section className="stat-row" aria-label="Сводка">
        <div className="stack" style={{ gap: 6 }}>
          <span className="stat-value">
            {opened}
            <span className="muted"> / {results.students}</span>
          </span>
          <span className="muted small">открыли текст</span>
        </div>
        <div className="stack" style={{ gap: 6 }}>
          <span className="stat-value">{formatPoints(average)}</span>
          <span className="muted small">средний балл за задания</span>
        </div>
        <div className="stack" style={{ gap: 6 }}>
          <span className={`stat-value${pending ? " result-pending" : ""}`}>{pending}</span>
          <span className="muted small">
            {pending ? <Link href={`/texts/${text.id}#tasks`}>ответов ждут проверки</Link> : "ответов ждут проверки"}
          </span>
        </div>
      </section>

      <section className="stack">
        <div className="row">
          <h2 style={{ margin: 0 }}>Кто что нашёл</h2>
          <span className="spacer" />
          <a href={`/texts/${text.id}/results/csv`} download>
            Скачать CSV
          </a>
        </div>
        {results.rows.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            В курсе пока нет студентов.
          </p>
        ) : (
          <div className="table-wrap">
            <table className="summary">
              <thead>
                <tr>
                  <th>Студент</th>
                  <th className="num">Дочитано</th>
                  <th className="num">Найдено</th>
                  {results.tasks.map((t, i) => (
                    <th key={t.id} className="num" title={t.prompt}>
                      {i + 1}
                    </th>
                  ))}
                  <th className="num">Баллы</th>
                </tr>
              </thead>
              <tbody>
                {results.rows.map((r) => (
                  <tr key={r.userId}>
                    <td>
                      {r.name}
                      {!r.openedAt && <span className="muted small"> · не открывал</span>}
                    </td>
                    <td className="num">
                      {r.readCount}/{results.bodyCount}
                    </td>
                    <td className="num">
                      {r.found}/{results.tasks.length}
                    </td>
                    {r.cells.map((c, i) => (
                      <td key={i} className={`num result-cell ${CELL[c].className}`} title={CELL[c].label}>
                        {CELL[c].mark}
                      </td>
                    ))}
                    <td className="num">
                      {formatPoints(r.points)}
                      {r.pending > 0 && <span className="result-pending">*</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="muted small" style={{ margin: 0 }}>
          {Object.values(CELL).map((c, i) => (
            <span key={c.label}>
              {i > 0 && " · "}
              <span className={`result-cell ${c.className}`}>{c.mark}</span> {c.label}
            </span>
          ))}
          {pending > 0 && " · * балл вырастет после проверки коротких ответов"}
        </p>
        {results.tasks.length > 0 && (
          <ol className="muted small" style={{ margin: 0, paddingLeft: 20 }}>
            {results.tasks.map((t) => (
              <li key={t.id}>{t.prompt}</li>
            ))}
          </ol>
        )}
      </section>

      <section className="stack">
        <h2 style={{ margin: 0 }}>Карта дочитывания</h2>
        <p className="muted" style={{ margin: 0 }}>
          Какая доля студентов дочитала каждый абзац. Провалы показывают места, которые пролистывают.
        </p>
        <div className="heat">
          {results.heat.map((h) => {
            const share = results.students ? h.readers / results.students : 0;
            return (
              <div key={h.fragmentId} style={{ display: "contents" }}>
                <span className="muted">стр. {h.page}</span>
                <span className="stack" style={{ gap: 4, minWidth: 0 }}>
                  <span className="heat-bar" aria-hidden>
                    <span style={{ width: `${Math.round(share * 100)}%` }} />
                  </span>
                  <span className="heat-text">{h.preview}</span>
                </span>
                <span className="num" style={{ textAlign: "right" }}>
                  {h.readers}/{results.students}
                </span>
              </div>
            );
          })}
        </div>
      </section>
    </main>
  );
}
