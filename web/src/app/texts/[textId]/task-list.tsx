"use client";

import { useState, useTransition } from "react";
import type { TeacherTask } from "@/lib/tasks";
import { deleteTaskAction, gradeAction } from "./actions";

const FORMAT_LABEL = { CHOICE: "выбор варианта", SELECTION: "выделение предложения", SHORT: "короткий ответ" } as const;

export function TeacherTaskList({ textId, tasks }: { textId: string; tasks: TeacherTask[] }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const act = (fn: () => Promise<{ error?: string }>) =>
    startTransition(async () => setError((await fn()).error ?? null));

  if (tasks.length === 0) {
    return (
      <p className="muted" style={{ margin: 0 }}>
        Заданий пока нет.
      </p>
    );
  }
  return (
    <div className="stack" aria-busy={pending}>
      {error && <p className="error">{error}</p>}
      {tasks.map((t, i) => (
        <article key={t.id} className="fragment stack" style={{ gap: 6 }}>
          <div className="row">
            <b>Задание {i + 1}</b>
            <span className="muted small">
              {t.mode === "ANCHORED" ? t.where : `раскидано: ${t.where}`} · {FORMAT_LABEL[t.format]}
            </span>
            <span className="spacer" />
            <button
              type="button"
              className="link small"
              disabled={pending}
              onClick={() => {
                if (confirm("Удалить задание вместе с ответами студентов?")) act(() => deleteTaskAction(textId, t.id));
              }}
            >
              Удалить
            </button>
          </div>
          <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{t.prompt}</p>
          {t.options && (
            <ul style={{ margin: 0 }}>
              {t.options.map((o, k) => (
                <li key={k}>
                  {o.text} {o.correct && <b>✓</b>}
                </li>
              ))}
            </ul>
          )}
          {t.reference && (
            <p className="muted small" style={{ margin: 0 }}>
              Эталон: «{t.reference}»
            </p>
          )}
          <details>
            <summary className="small">
              Нашли: {t.found} из {t.students} · ответов: {t.answers.length}
              {t.format === "SHORT" && t.answers.some((a) => !a.grade) && " · есть непроверенные"}
            </summary>
            {t.answers.length === 0 ? (
              <p className="muted small">Ответов пока нет.</p>
            ) : (
              <ul className="plain">
                {t.answers.map((a) => (
                  <li key={a.userId} className="stack" style={{ gap: 4 }}>
                    <div className="row">
                      <b className="small">{a.name}</b>
                      <span className="spacer" />
                      {t.format === "SHORT" ? (
                        <span className="row">
                          <button
                            type="button"
                            className="secondary small"
                            aria-pressed={a.grade === "PASS"}
                            disabled={pending}
                            onClick={() =>
                              act(() => gradeAction(textId, t.id, a.userId, a.grade === "PASS" ? null : "PASS"))
                            }
                          >
                            Зачёт
                          </button>
                          <button
                            type="button"
                            className="secondary small"
                            aria-pressed={a.grade === "FAIL"}
                            disabled={pending}
                            onClick={() =>
                              act(() => gradeAction(textId, t.id, a.userId, a.grade === "FAIL" ? null : "FAIL"))
                            }
                          >
                            Незачёт
                          </button>
                        </span>
                      ) : (
                        <span className="small">{a.grade === "PASS" ? "✓ верно" : "✗ неверно"}</span>
                      )}
                    </div>
                    <span style={{ whiteSpace: "pre-wrap" }}>{a.value}</span>
                  </li>
                ))}
              </ul>
            )}
          </details>
        </article>
      ))}
    </div>
  );
}
