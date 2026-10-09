"use client";

import { useState, useTransition } from "react";
import { formatPoints, TASK_POINTS, taskPoints } from "@/lib/scoring";
import type { StudentTask, StudentTasks } from "@/lib/reader-types";

const FORMAT_HINT = {
  CHOICE: "Выберите вариант",
  SELECTION: "Нажмите на предложение в абзаце",
  SHORT: "Ответ до трёх предложений",
} as const;

export function TaskBar({
  tasks,
  deadlineLabel,
  onOpenList,
}: {
  tasks: StudentTasks;
  deadlineLabel: string | null;
  onOpenList: () => void;
}) {
  return (
    <div className="task-bar">
      <button type="button" className="link" onClick={onOpenList} disabled={tasks.found.length === 0}>
        Найдено заданий: {tasks.found.length} из {tasks.total}
      </button>
      {deadlineLabel && <span className="muted small">{deadlineLabel}</span>}
      {tasks.closed && tasks.total > 0 && !tasks.gradesPending && (
        <span className="small">
          Баллы за задания:{" "}
          {formatPoints(taskPoints(tasks.found.filter((t) => t.grade === "PASS").length, tasks.total))} из {TASK_POINTS}
        </span>
      )}
    </div>
  );
}

export function TaskList({
  tasks,
  onOpen,
  onClose,
}: {
  tasks: StudentTasks;
  onOpen: (id: string) => void;
  onClose: () => void;
}) {
  return (
    <aside className="task-panel" aria-label="Найденные задания">
      <div className="row">
        <h2 style={{ margin: 0, fontSize: "1.1rem" }}>Найденные задания</h2>
        <span className="spacer" />
        <button type="button" className="link" onClick={onClose} aria-label="Закрыть">
          ✕
        </button>
      </div>
      <ol className="task-list">
        {tasks.found.map((t) => (
          <li key={t.id}>
            <button type="button" className="link" onClick={() => onOpen(t.id)}>
              {t.prompt.length > 80 ? `${t.prompt.slice(0, 80)}…` : t.prompt}
            </button>{" "}
            <span className="muted small">{t.answer ? "· ответ сохранён" : "· без ответа"}</span>
          </li>
        ))}
      </ol>
      <p className="muted small" style={{ margin: 0 }}>
        Остальные задания спрятаны в тексте: они откроются, когда вы дочитаете нужные места.
      </p>
    </aside>
  );
}

export function TaskPanel({
  task,
  onSubmit,
  closed,
  gradesPending,
  selectedSentence,
  onTasks,
  onClose,
  onBack,
}: {
  task: StudentTask;
  onSubmit: (taskId: string, value: unknown) => Promise<{ error?: string; tasks?: StudentTasks }>;
  closed: boolean;
  gradesPending?: boolean;
  // Для ответа выделением: предложение, выбранное кликом в абзаце.
  selectedSentence: number | null;
  onTasks: (tasks: StudentTasks) => void;
  onClose: () => void;
  onBack: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [choice, setChoice] = useState<number | null>(task.answer?.choice ?? null);
  const [text, setText] = useState(task.answer?.text ?? "");

  const save = (value: unknown) =>
    startTransition(async () => {
      const res = await onSubmit(task.id, value);
      setError(res.error ?? null);
      setSaved(!res.error);
      if (res.tasks) onTasks(res.tasks);
    });

  const answeredSentence =
    task.selection && task.answer?.range ? task.selection.content.slice(...task.answer.range) : null;
  const pickedSentence =
    task.selection && selectedSentence !== null
      ? task.selection.content.slice(...task.selection.sentences[selectedSentence])
      : null;

  return (
    <aside className="task-panel" aria-label="Задание">
      <div className="row">
        <button type="button" className="link small" onClick={onBack}>
          ← Все задания
        </button>
        <span className="spacer" />
        <button type="button" className="link" onClick={onClose} aria-label="Закрыть">
          ✕
        </button>
      </div>
      <p className="task-prompt">{task.prompt}</p>
      <p className="muted small" style={{ margin: 0 }}>
        {FORMAT_HINT[task.format]}
      </p>

      {task.format === "CHOICE" && (
        <div className="stack" style={{ gap: 6 }}>
          {task.options!.map((o, i) => (
            <label key={i} className="choice">
              <input
                type="radio"
                name={`choice-${task.id}`}
                checked={choice === i}
                disabled={closed}
                onChange={() => setChoice(i)}
              />{" "}
              {o}
            </label>
          ))}
        </div>
      )}

      {task.format === "SELECTION" && (
        <div className="stack" style={{ gap: 6 }}>
          {pickedSentence ? (
            <blockquote className="picked">{pickedSentence}</blockquote>
          ) : answeredSentence ? (
            <blockquote className="picked">{answeredSentence}</blockquote>
          ) : (
            <p className="muted small" style={{ margin: 0 }}>
              Предложения абзаца подсвечены в тексте.
            </p>
          )}
        </div>
      )}

      {task.format === "SHORT" && (
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={4}
          maxLength={1000}
          disabled={closed}
          placeholder="Ваш ответ"
        />
      )}

      {closed ? (
        <p className="small" style={{ margin: 0 }}>
          Дедлайн прошёл.{" "}
          {gradesPending
            ? task.answer
              ? "Ответ проверит преподаватель по вашему отчёту."
              : "Ответа нет."
            : task.grade === "PASS"
              ? "Ответ засчитан."
              : task.grade === "FAIL"
                ? "Ответ не засчитан."
                : task.answer
                  ? "Ответ ещё не проверен."
                  : "Ответа нет."}
        </p>
      ) : (
        <div className="row">
          <button
            type="button"
            disabled={
              pending ||
              (task.format === "CHOICE" && choice === null) ||
              (task.format === "SELECTION" && selectedSentence === null) ||
              (task.format === "SHORT" && !text.trim())
            }
            onClick={() =>
              save(
                task.format === "CHOICE"
                  ? { choice }
                  : task.format === "SELECTION"
                    ? { sentence: selectedSentence }
                    : { text },
              )
            }
          >
            {task.answer ? "Изменить ответ" : "Ответить"}
          </button>
          {saved && !error && <span className="muted small">Сохранено. Ответ можно изменить до дедлайна.</span>}
          {error && <span className="error small">{error}</span>}
        </div>
      )}
    </aside>
  );
}
