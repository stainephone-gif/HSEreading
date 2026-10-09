"use client";

// «Пряник» читалки: радость находки, открытка на финише с подсказками и карта
// чтения. Пропущенное задание подаётся не как провал, а как то, что ещё можно найти.

import { useEffect, useState } from "react";
import type { ReaderData, StudentTasks } from "@/lib/reader-types";

// Подсказки: одна сразу и ещё одна за каждые HINT_EVERY найденных заданий.
const HINT_EVERY = 3;
// Ширина района подсказки, страниц.
const HINT_SPAN = 20;

export type Hint = { fragmentId: string; from: number; to: number };

function hash(s: string): number {
  let h = 0;
  for (const c of s) h = (Math.imul(h, 31) + c.charCodeAt(0)) | 0;
  return h >>> 0;
}

export function pageOf(data: ReaderData, fragmentId: string): number {
  return (data.fragments.find((f) => f.id === fragmentId)?.lines[0]?.page ?? 0) + 1;
}

// Район из HINT_SPAN страниц вокруг задания. Сдвиг зависит от задания, поэтому
// задание не всегда стоит в середине района.
export function hintRange(page: number, pageCount: number, seed: string): { from: number; to: number } {
  const span = Math.min(HINT_SPAN, Math.max(0, pageCount - 1));
  const offset = hash(seed) % (span + 1);
  let from = Math.max(1, page - offset);
  const to = Math.min(pageCount, from + span);
  from = Math.max(1, to - span);
  return { from, to };
}

export function hintsAllowed(found: number): number {
  return 1 + Math.floor(found / HINT_EVERY);
}

const hintKey = (textId: string) => `polya:hints:${textId}`;

export function useHints(textId: string): [Hint[], (h: Hint) => void] {
  const [hints, setHints] = useState<Hint[]>(() => {
    try {
      const raw = typeof localStorage === "undefined" ? null : localStorage.getItem(hintKey(textId));
      return raw ? (JSON.parse(raw) as Hint[]) : [];
    } catch {
      return [];
    }
  });
  const add = (h: Hint) => {
    const next = [...hints, h];
    setHints(next);
    try {
      localStorage.setItem(hintKey(textId), JSON.stringify(next));
    } catch {
      // Без хранилища подсказки живут до закрытия вкладки.
    }
  };
  return [hints, add];
}

// Дочитал ли студент до конца текста (долистал до низа страницы).
export function useReachedEnd(active: boolean): boolean {
  const [reached, setReached] = useState(false);
  useEffect(() => {
    if (!active || reached) return;
    const check = () => {
      const doc = document.documentElement;
      if (window.scrollY > 200 && window.innerHeight + window.scrollY >= doc.scrollHeight - 150) setReached(true);
    };
    window.addEventListener("scroll", check, { passive: true });
    return () => window.removeEventListener("scroll", check);
  }, [active, reached]);
  return reached;
}

export function FoundToast({ text }: { text: string }) {
  return (
    <div className="found-toast" role="status">
      {text}
    </div>
  );
}

export function foundMessage(found: number, total: number): string {
  if (found >= total) return `Все задания найдены: ${found} из ${total}! 🎉`;
  return `Нашли задание! Найдено ${found} из ${total} ✨`;
}

// Открытка на финише: итог без упрёков и подсказки, где искать остальное.
export function FinishCard({
  data,
  tasks,
  hidden,
  hints,
  onHint,
  onJumpPage,
  onClose,
}: {
  data: ReaderData;
  tasks: StudentTasks;
  // Места ненайденных заданий (известны только офлайн-читалке).
  hidden: string[] | null;
  hints: Hint[];
  onHint: (h: Hint) => void;
  onJumpPage: (page: number) => void;
  onClose: () => void;
}) {
  const found = tasks.found.length;
  const left = tasks.total - found;
  const foundIds = new Set(tasks.found.map((t) => t.fragmentId));
  const hinted = new Set(hints.map((h) => h.fragmentId));
  const nextHint = hidden?.find((f) => !hinted.has(f)) ?? null;
  const available = hintsAllowed(found) - hints.length;

  return (
    <aside className="task-panel finish-card" aria-label="Итоги чтения">
      <div className="row">
        <h2 style={{ margin: 0, fontSize: "1.2rem" }}>
          {left > 0 ? "Вы дочитали до конца!" : "Все задания найдены! 🎉"}
        </h2>
        <span className="spacer" />
        <button type="button" className="link" onClick={onClose} aria-label="Закрыть">
          ✕
        </button>
      </div>
      <div className="finish-progress" aria-hidden>
        <span style={{ width: `${tasks.total ? (found / tasks.total) * 100 : 100}%` }} />
      </div>
      {left > 0 ? (
        <p style={{ margin: 0 }}>
          Найдено заданий: <b>{found}</b> из {tasks.total}.{" "}
          {left === 1
            ? "Ещё одно ждёт вас — оно прячется там, где стоит читать не спеша."
            : `Ещё ${left} ждут вас — они прячутся там, где стоит читать не спеша.`}{" "}
          Бледные места на карте чтения вверху — страницы, прочитанные бегло.
        </p>
      ) : (
        <p style={{ margin: 0 }}>Вы нашли все {tasks.total} заданий. Отличное внимательное чтение!</p>
      )}

      {hidden && left > 0 && (
        <div className="stack" style={{ gap: 8 }}>
          {hints.map((h) => (
            <p key={h.fragmentId} className="hint-line" style={{ margin: 0 }}>
              {foundIds.has(h.fragmentId) ? "✓ Найдено: " : "💡 Задание прячется "}
              <button type="button" className="link" onClick={() => onJumpPage(h.from)}>
                где-то на стр. {h.from}–{h.to}
              </button>
            </p>
          ))}
          {nextHint && (
            <div className="row">
              <button
                type="button"
                className="secondary small"
                disabled={available <= 0}
                onClick={() => {
                  const r = hintRange(pageOf(data, nextHint), data.pages.length || data.fragments.length, nextHint);
                  onHint({ fragmentId: nextHint, ...r });
                }}
              >
                Получить подсказку
              </button>
              <span className="muted small">
                {available > 0
                  ? `Доступно подсказок: ${available}`
                  : `Новая подсказка — за каждые ${HINT_EVERY} найденных задания`}
              </span>
            </div>
          )}
        </div>
      )}
      <div>
        <button type="button" onClick={onClose}>
          Продолжить чтение
        </button>
      </div>
    </aside>
  );
}

// Карта чтения: по отрезку на абзац или страницу; дочитанные закрашены.
export function ReadingMap({
  data,
  readIds,
  onJump,
}: {
  data: ReaderData;
  readIds: Set<string>;
  onJump: (fragmentId: string) => void;
}) {
  if (data.fragments.length < 2) return null;
  const read = data.fragments.filter((f) => readIds.has(f.id)).length;
  return (
    <div className="reading-map" role="group" aria-label={`Карта чтения: дочитано ${read} из ${data.fragments.length}`}>
      {data.fragments.map((f) => {
        const page = (f.lines[0]?.page ?? 0) + 1;
        const done = readIds.has(f.id);
        return (
          <button
            key={f.id}
            type="button"
            className={done ? "read" : undefined}
            title={`Стр. ${page}: ${done ? "дочитана" : "ещё не дочитана"}`}
            aria-label={`Стр. ${page}`}
            onClick={() => onJump(f.id)}
          />
        );
      })}
    </div>
  );
}
