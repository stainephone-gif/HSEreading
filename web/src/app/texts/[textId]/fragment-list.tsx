"use client";

import { useState, useTransition } from "react";
import { mergeAction, setKindAction, splitAction, type ActionResult } from "./actions";

export type FragmentView = {
  id: string;
  kind: "BODY" | "HEADING" | "EXCLUDED";
  content: string;
  sentences: [number, number][];
  wordCount: number;
  unlockSeconds: number;
  pages: number[];
  excludeReason: string | null;
};

export function FragmentList({ textId, fragments }: { textId: string; fragments: FragmentView[] }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const act = (fn: () => Promise<ActionResult>) =>
    startTransition(async () => {
      const result = await fn();
      setError(result.error ?? null);
    });

  return (
    <div className="stack" aria-busy={pending}>
      {error && <p className="error">{error}</p>}
      {fragments.map((f, i) => {
        const page = f.pages[0] ?? 0;
        const newPage = i === 0 || page !== (fragments[i - 1].pages[0] ?? 0);
        const pageHeader = newPage ? <h3 className="page-label">Страница {page + 1}</h3> : null;
        return (
          <div key={f.id}>
            {pageHeader}
            <article className={`fragment fragment-${f.kind.toLowerCase()}`}>
              <div className="fragment-text">
                {f.kind === "BODY" && f.sentences.length > 1 ? (
                  <Sentences f={f} disabled={pending} onSplit={(k) => act(() => splitAction(textId, f.id, k))} />
                ) : (
                  f.content
                )}
              </div>
              <div className="fragment-meta row">
                {f.kind === "BODY" && (
                  <span className="muted small">
                    {f.wordCount} сл. · маркер через {f.unlockSeconds} с
                  </span>
                )}
                {f.kind === "EXCLUDED" && (
                  <span className="muted small">{f.excludeReason ?? "исключён преподавателем"}</span>
                )}
                {f.pages.length > 1 && <span className="muted small">стр. {f.pages.map((p) => p + 1).join("–")}</span>}
                <span className="spacer" />
                <select
                  value={f.kind}
                  disabled={pending}
                  aria-label="Тип фрагмента"
                  onChange={(e) => act(() => setKindAction(textId, f.id, e.target.value))}
                >
                  <option value="BODY">Абзац</option>
                  <option value="HEADING">Заголовок</option>
                  <option value="EXCLUDED">Исключить</option>
                </select>
                {i < fragments.length - 1 && (
                  <button
                    type="button"
                    className="secondary small"
                    disabled={pending}
                    onClick={() => act(() => mergeAction(textId, f.id))}
                    title="Склеить со следующим фрагментом (колонтитулы между ними пропускаются)"
                  >
                    Склеить со следующим
                  </button>
                )}
              </div>
            </article>
          </div>
        );
      })}
    </div>
  );
}

function Sentences({ f, disabled, onSplit }: { f: FragmentView; disabled: boolean; onSplit: (k: number) => void }) {
  return (
    <>
      {f.sentences.map(([s, e], k) => (
        <span key={k}>
          {k > 0 && (
            <button
              type="button"
              className="cut"
              disabled={disabled}
              onClick={() => onSplit(k)}
              title="Разрезать абзац здесь"
              aria-label={`Разрезать перед предложением ${k + 1}`}
            >
              ✂
            </button>
          )}
          {f.content.slice(s, e)}{" "}
        </span>
      ))}
    </>
  );
}
