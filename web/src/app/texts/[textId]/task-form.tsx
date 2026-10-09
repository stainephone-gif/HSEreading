"use client";

import { useState, useTransition } from "react";
import type { TaskInput } from "@/lib/tasks";
import { createTaskAction } from "./actions";

export type FragmentOption = { id: string; label: string; sentences: string[] };
export type SectionOption = { id: string; label: string };

type Mode = "anchored" | "section" | "pages";
type Format = "choice" | "selection" | "short";

export function TaskForm({
  textId,
  paragraphs,
  sections,
  pageCount,
}: {
  textId: string;
  paragraphs: FragmentOption[];
  sections: SectionOption[];
  pageCount: number;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("anchored");
  const [format, setFormat] = useState<Format>("short");
  const [fragmentId, setFragmentId] = useState(paragraphs[0]?.id ?? "");
  const [sectionId, setSectionId] = useState(sections[0]?.id ?? "");
  const [pageFrom, setPageFrom] = useState(1);
  const [pageTo, setPageTo] = useState(pageCount);
  const [prompt, setPrompt] = useState("");
  const [options, setOptions] = useState([
    { text: "", correct: true },
    { text: "", correct: false },
  ]);
  const [sentenceIndex, setSentenceIndex] = useState(0);

  const paragraph = paragraphs.find((p) => p.id === fragmentId);

  const build = (): TaskInput => {
    if (mode === "section") return { kind: "scattered-section", sectionFragmentId: sectionId, prompt };
    if (mode === "pages") return { kind: "scattered-pages", pageFrom, pageTo, prompt };
    if (format === "choice") return { kind: "anchored-choice", fragmentId, prompt, options };
    if (format === "selection") return { kind: "anchored-selection", fragmentId, prompt, sentenceIndex };
    return { kind: "anchored-short", fragmentId, prompt };
  };

  const submit = () =>
    startTransition(async () => {
      const res = await createTaskAction(textId, build());
      setError(res.error ?? null);
      if (!res.error) {
        setPrompt("");
        setOptions([
          { text: "", correct: true },
          { text: "", correct: false },
        ]);
      }
    });

  return (
    <div className="stack">
      <fieldset className="stack" style={{ gap: 4 }}>
        <legend>Где спрятать</legend>
        <label>
          <input type="radio" checked={mode === "anchored"} onChange={() => setMode("anchored")} /> В конкретном абзаце:
          у всех студентов в одном месте
        </label>
        <label>
          <input
            type="radio"
            checked={mode === "section"}
            disabled={sections.length === 0}
            onChange={() => setMode("section")}
          />{" "}
          В случайном абзаце раздела: у каждого студента в своём
        </label>
        <label>
          <input type="radio" checked={mode === "pages"} onChange={() => setMode("pages")} /> В случайном абзаце
          диапазона страниц: у каждого студента в своём
        </label>
      </fieldset>

      {mode === "anchored" && (
        <label className="stack" style={{ gap: 4 }}>
          <span>Абзац</span>
          <select
            value={fragmentId}
            onChange={(e) => {
              setFragmentId(e.target.value);
              setSentenceIndex(0);
            }}
          >
            {paragraphs.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
      )}
      {mode === "section" && (
        <label className="stack" style={{ gap: 4 }}>
          <span>Раздел</span>
          <select value={sectionId} onChange={(e) => setSectionId(e.target.value)}>
            {sections.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
      )}
      {mode === "pages" && (
        <div className="row">
          <span>Страницы с</span>
          <input
            type="number"
            min={1}
            max={pageCount}
            value={pageFrom}
            onChange={(e) => setPageFrom(Number(e.target.value))}
          />
          <span>по</span>
          <input
            type="number"
            min={1}
            max={pageCount}
            value={pageTo}
            onChange={(e) => setPageTo(Number(e.target.value))}
          />
        </div>
      )}

      {mode === "anchored" ? (
        <fieldset className="stack" style={{ gap: 4 }}>
          <legend>Формат ответа</legend>
          <label>
            <input type="radio" checked={format === "short"} onChange={() => setFormat("short")} /> Короткий ответ до
            трёх предложений: проверяете вы
          </label>
          <label>
            <input type="radio" checked={format === "choice"} onChange={() => setFormat("choice")} /> Выбор варианта:
            проверяется автоматически
          </label>
          <label>
            <input type="radio" checked={format === "selection"} onChange={() => setFormat("selection")} /> Выделение
            предложения в абзаце: проверяется автоматически
          </label>
        </fieldset>
      ) : (
        <p className="muted small" style={{ margin: 0 }}>
          Раскиданное задание должно подходить к любому абзацу, например: «Перескажите этот абзац одним предложением».
          Формат — короткий ответ, проверяете вы.
        </p>
      )}

      <label className="stack" style={{ gap: 4 }}>
        <span>Задание</span>
        <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={3} maxLength={2000} />
      </label>

      {mode === "anchored" && format === "choice" && (
        <div className="stack" style={{ gap: 6 }}>
          <span>Варианты (отметьте верный)</span>
          {options.map((o, i) => (
            <div key={i} className="row">
              <input
                type="radio"
                name="correct"
                checked={o.correct}
                onChange={() => setOptions(options.map((x, j) => ({ ...x, correct: i === j })))}
                aria-label="Верный вариант"
              />
              <input
                type="text"
                value={o.text}
                onChange={(e) => setOptions(options.map((x, j) => (i === j ? { ...x, text: e.target.value } : x)))}
                placeholder={`Вариант ${i + 1}`}
                style={{ flex: 1 }}
              />
              {options.length > 2 && (
                <button
                  type="button"
                  className="link"
                  aria-label="Убрать вариант"
                  onClick={() => {
                    const next = options.filter((_, j) => j !== i);
                    if (!next.some((x) => x.correct)) next[0].correct = true;
                    setOptions(next);
                  }}
                >
                  ✕
                </button>
              )}
            </div>
          ))}
          {options.length < 6 && (
            <div>
              <button
                type="button"
                className="secondary small"
                onClick={() => setOptions([...options, { text: "", correct: false }])}
              >
                + Вариант
              </button>
            </div>
          )}
        </div>
      )}

      {mode === "anchored" && format === "selection" && paragraph && (
        <label className="stack" style={{ gap: 4 }}>
          <span>Эталонное предложение</span>
          <select value={sentenceIndex} onChange={(e) => setSentenceIndex(Number(e.target.value))}>
            {paragraph.sentences.map((s, i) => (
              <option key={i} value={i}>
                {s.length > 110 ? `${s.slice(0, 110)}…` : s}
              </option>
            ))}
          </select>
          <span className="muted small">Ответ засчитается, если студент выберет это предложение.</span>
        </label>
      )}

      <div className="row">
        <button type="button" onClick={submit} disabled={pending || !prompt.trim()}>
          Добавить задание
        </button>
        {error && <span className="error">{error}</span>}
      </div>
    </div>
  );
}
