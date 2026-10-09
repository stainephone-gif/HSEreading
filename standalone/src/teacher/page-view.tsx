// Страница PDF в конструкторе: преподаватель видит её как студент и назначает
// задание к ней. Для задания «выделите предложение» предложения подсвечены
// поверх страницы и выбираются щелчком.

import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist/legacy/build/pdf.mjs";
import { useEffect, useRef, useState } from "react";
import { sentenceRects } from "@/lib/geometry";
import type { PageText } from "~/pages";

const MAX_WIDTH = 720;

export function PageView({
  doc,
  page,
  index,
  picking,
  picked,
  onPick,
  badges = [],
}: {
  doc: PDFDocumentProxy | null;
  page: PageText;
  index: number;
  // Показывать предложения для выбора.
  picking: boolean;
  picked: number | null;
  onPick: (sentence: number) => void;
  // Номера заданий, уже назначенных к этой странице.
  badges?: number[];
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(0);
  const [error, setError] = useState(false);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.min(MAX_WIDTH, Math.floor(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const scale = width / page.width;

  useEffect(() => {
    if (!doc || width === 0) return;
    let task: RenderTask | null = null;
    let cancelled = false;
    (async () => {
      const p = await doc.getPage(index + 1);
      if (cancelled) return;
      const viewport = p.getViewport({ scale });
      const canvas = canvasRef.current!;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.floor(viewport.width * dpr);
      canvas.height = Math.floor(viewport.height * dpr);
      task = p.render({ canvas, viewport, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined });
      await task.promise;
      if (!cancelled) setError(false);
    })().catch((err) => {
      if (err?.name === "RenderingCancelledException") return;
      console.error(err);
      setError(true);
    });
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [doc, index, scale, width]);

  const height = Math.round(page.height * scale);
  return (
    <div ref={boxRef} style={{ width: "100%" }}>
      {width > 0 && (
        <div className="reader-page" style={{ width, height }} aria-label={`Страница ${index + 1}`}>
          <canvas ref={canvasRef} style={{ width, height }} />
          <TaskBadges numbers={badges} />
          {picking &&
            page.sentences.flatMap((range, k) =>
              sentenceRects(page.lines, range).map((r, j) => (
                <button
                  key={`${k}:${j}`}
                  type="button"
                  className={`sentence-pick${picked === k ? " picked" : ""}`}
                  style={{
                    left: r.x0 * scale,
                    top: r.y0 * scale,
                    width: (r.x1 - r.x0) * scale,
                    height: (r.y1 - r.y0) * scale,
                  }}
                  onClick={() => onPick(k)}
                  aria-label={`Предложение ${k + 1}`}
                  title={page.content.slice(...range)}
                />
              )),
            )}
        </div>
      )}
      {error && <p className="error small">Не удалось показать страницу.</p>}
    </div>
  );
}

// Страница книги из DOCX: текст абзацами, как его увидит студент в режиме
// «Текст». Для задания на выделение предложения выбираются щелчком.
export function TextPageView({
  page,
  picking,
  picked,
  onPick,
  badges = [],
}: {
  badges?: number[];
  page: PageText;
  picking: boolean;
  picked: number | null;
  onPick: (sentence: number) => void;
}) {
  const parts: React.ReactNode[] = [];
  let at = 0;
  if (picking) {
    page.sentences.forEach(([s, e], k) => {
      parts.push(page.content.slice(at, s));
      parts.push(
        <span
          key={k}
          role="button"
          tabIndex={0}
          aria-pressed={picked === k}
          aria-label={`Предложение ${k + 1}`}
          className={`sentence-inline${picked === k ? " picked" : ""}`}
          onClick={() => onPick(k)}
          onKeyDown={(ev) => {
            if (ev.key === "Enter" || ev.key === " ") {
              ev.preventDefault();
              onPick(k);
            }
          }}
        >
          {page.content.slice(s, e)}
        </span>,
      );
      at = e;
    });
  }
  parts.push(page.content.slice(at));
  return (
    <article className="web-text text-page" style={{ maxWidth: "none", margin: 0 }}>
      <TaskBadges numbers={badges} />
      {parts}
    </article>
  );
}

// Задания этой страницы — так же, как маркер увидит студент.
function TaskBadges({ numbers }: { numbers: number[] }) {
  if (numbers.length === 0) return null;
  return (
    <div className="page-badges" aria-label="Задания на этой странице">
      {numbers.map((n) => (
        <span
          key={n}
          className="task-marker static"
          title="Отметка: здесь у студента появится задание. Выполнить его можно в читалке студента."
        >
          <span aria-hidden>?</span>
          Задание {n}
        </span>
      ))}
    </div>
  );
}
