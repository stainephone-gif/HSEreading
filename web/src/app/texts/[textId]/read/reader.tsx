"use client";

import type { DocumentInitParameters } from "pdfjs-dist/types/src/display/api";
import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask, TextLayer } from "pdfjs-dist/legacy/build/pdf.mjs";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { sentenceRects } from "@/lib/geometry";
import type { Sentence } from "@/lib/pdf-service";
import type { ReaderData, StudentTasks } from "@/lib/reader-types";
import { TaskBar, TaskList, TaskPanel } from "./task-panel";

// Зона чтения: средняя полоса экрана, по 20% высоты сверху и снизу не считаются.
const ZONE_MARGIN = "-20% 0px -20% 0px";
const TICK_MS = 1_000;
const BEAT_MS = 5_000;
const MAX_PAGE_WIDTH = 900;

// Legacy-сборка PDF.js: обычная требует новейших методов JS (Map.getOrInsertComputed),
// которых нет в Safari и не самых свежих Chrome.
const loadPdfjs = () => import("pdfjs-dist/legacy/build/pdf.mjs");

// Откуда читалка берёт PDF и куда отчитывается. В приложении это сервер, в
// офлайн-читалке (киоске) — локальное состояние в браузере.
export type DwellResponse = { readIds?: string[]; tasks?: StudentTasks };
export type ReaderBackend = {
  pdf: () => DocumentInitParameters;
  // beacon: страница закрывается, ответ не нужен.
  beat: (claims: Record<string, number>, beacon: boolean) => Promise<DwellResponse | null>;
  submit: (taskId: string, value: unknown) => Promise<{ error?: string; tasks?: StudentTasks }>;
};

// Маркер задания: новое (ещё не открыто), открытое без ответа, с ответом.
type MarkerState = "new" | "open" | "done";
type Marker = { taskId: string; state: MarkerState };

const MARKER: Record<MarkerState, { mark: string; label: string; title: string }> = {
  new: { mark: "?", label: "Задание", title: "Здесь спрятано задание" },
  open: { mark: "!", label: "Ответить", title: "Задание открыто, но ответа нет" },
  done: { mark: "✓", label: "Ответ есть", title: "Ответ сохранён" },
};

function MarkerButton({
  marker,
  inline,
  onClick,
  style,
}: {
  marker: Marker;
  inline?: boolean;
  onClick: () => void;
  style?: React.CSSProperties;
}) {
  const m = MARKER[marker.state];
  return (
    <button
      type="button"
      className={`task-marker ${marker.state}${inline ? " inline" : ""}`}
      style={style}
      onClick={onClick}
      aria-label={`${m.title}: открыть`}
      title={m.title}
    >
      <span aria-hidden>{m.mark}</span>
      {!inline && <span className="task-marker-label">{m.label}</span>}
    </button>
  );
}

// Задание открыто, ответа нет, а студент пролистал его: какое из таких
// заданий осталось выше экрана (первое по порядку) — о нём напомнить.
function useLeftBehind(pending: { id: string; fragmentId: string }[], skip: Set<string>): string | null {
  const [away, setAway] = useState<string | null>(null);
  const key = pending.map((t) => `${t.id}:${t.fragmentId}`).join(",") + "|" + [...skip].join(",");
  useEffect(() => {
    let frame = 0;
    const check = () => {
      frame = 0;
      let found: string | null = null;
      for (const t of pending) {
        if (skip.has(t.id)) continue;
        const els = document.querySelectorAll(`[data-fid="${CSS.escape(t.fragmentId)}"]`);
        if (els.length && els[els.length - 1].getBoundingClientRect().bottom < 0) {
          found = t.id;
          break;
        }
      }
      setAway(found);
    };
    const onScroll = () => {
      frame ||= requestAnimationFrame(check);
    };
    check();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
    // pending и skip сведены в key: эффект перезапускается только при их изменении.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return away;
}
type SelectionOverlay = {
  fragmentId: string;
  sentences: Sentence[];
  rects: { index: number; rects: ReturnType<typeof sentenceRects> }[];
};

type View = "pdf" | "web";
const VIEW_KEY = "polya:view";
// Уже этого PDF-страница не читается: по умолчанию показываем текст.
const NARROW_PX = 640;

function storedView(): View | null {
  try {
    const v = localStorage.getItem(VIEW_KEY);
    return v === "pdf" || v === "web" ? v : null;
  } catch {
    return null;
  }
}

const noSubscribe = () => () => {};

// Вид по умолчанию известен только в браузере: ширина экрана и прошлый выбор.
function useDefaultView(displayMode: ReaderData["displayMode"]): View | null {
  return useSyncExternalStore(
    noSubscribe,
    () => (displayMode === "WEB" ? "web" : (storedView() ?? (window.innerWidth < NARROW_PX ? "web" : "pdf"))),
    () => null,
  );
}

export function Reader({
  data,
  deadlineLabel,
  backend,
}: {
  data: ReaderData;
  deadlineLabel: string | null;
  // Должен быть один и тот же на всё время жизни читалки.
  backend: ReaderBackend;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tasks, setTasks] = useState<StudentTasks | null>(data.tasks);
  // Что открыто в панели: список найденных или конкретное задание.
  const [panel, setPanel] = useState<"list" | string | null>(null);
  const [selectedSentence, setSelectedSentence] = useState<number | null>(null);
  // Задания, которые студент уже видел: новые маркеры мигают.
  const [seen, setSeen] = useState(() => new Set(data.tasks?.found.map((t) => t.id) ?? []));
  const zone = useReadingZone(data, backend, (body) => body.tasks && setTasks(body.tasks));
  const defaultView = useDefaultView(data.displayMode);
  const [chosenView, setChosenView] = useState<View | null>(null);
  const view = chosenView ?? defaultView;
  const chooseView = (v: View) => {
    setChosenView(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      // Без хранилища выбор просто не запомнится.
    }
  };

  // Напоминания, которые студент отложил кнопкой «Позже».
  const [snoozed, setSnoozed] = useState<Set<string>>(() => new Set());

  const openTask = useCallback((id: string) => {
    setPanel(id);
    setSelectedSentence(null);
    setSeen((prev) => (prev.has(id) ? prev : new Set([...prev, id])));
    setSnoozed((prev) => (prev.has(id) ? new Set([...prev].filter((x) => x !== id)) : prev));
  }, []);

  const markers = useMemo(() => {
    const map = new Map<string, Marker[]>();
    const add = (fragmentId: string, taskId: string, state: MarkerState) =>
      map.set(fragmentId, [...(map.get(fragmentId) ?? []), { taskId, state }]);
    if (tasks) {
      tasks.found.forEach((t) =>
        add(t.fragmentId, t.id, !seen.has(t.id) ? "new" : t.answer || tasks.closed ? "done" : "open"),
      );
    } else {
      data.previewTasks
        .filter((t) => zone.readIds.has(t.fragmentId))
        .forEach((t) => add(t.fragmentId, t.id, seen.has(t.id) ? "done" : "new"));
    }
    return map;
  }, [tasks, data.previewTasks, zone.readIds, seen]);

  // Открытые задания без ответа: о пролистанном напоминаем внизу экрана.
  const unanswered = useMemo(
    () => (tasks && !tasks.closed ? tasks.found.filter((t) => seen.has(t.id) && !t.answer) : []),
    [tasks, seen],
  );
  const skipReminder = useMemo(
    () => new Set([...snoozed, ...(panel && panel !== "list" ? [panel] : [])]),
    [snoozed, panel],
  );
  const leftBehindId = useLeftBehind(unanswered, skipReminder);
  const leftBehind = panel === "list" ? null : (unanswered.find((t) => t.id === leftBehindId) ?? null);

  // Пролистанные слишком быстро места со спрятанными заданиями: задание там
  // ещё не открылось, и студент должен об этом узнать.
  const skippable = useMemo(() => {
    const found = new Set(tasks?.found.map((t) => t.fragmentId));
    return [...new Set(data.taskFragments ?? [])]
      .filter((fid) => !zone.readIds.has(fid) && !found.has(fid))
      .map((fid) => ({ id: `skip:${fid}`, fragmentId: fid }));
  }, [data.taskFragments, zone.readIds, tasks]);
  const skippedId = useLeftBehind(skippable, snoozed);
  const skipped = leftBehind || panel ? null : (skippable.find((x) => x.id === skippedId) ?? null);
  const skippedPage = skipped ? (data.fragments.find((f) => f.id === skipped.fragmentId)?.lines[0]?.page ?? -1) + 1 : 0;

  const openStudentTask = tasks?.found.find((t) => t.id === panel) ?? null;

  // Задание на выбор предложения: абзац прокручивается наверх, чтобы его не
  // закрыла панель ответа (на телефоне она снизу).
  const pickFragment = openStudentTask?.format === "SELECTION" ? openStudentTask.fragmentId : null;
  useEffect(() => {
    if (!pickFragment) return;
    document.querySelector(`[data-fid="${pickFragment}"]`)?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [pickFragment, view]);
  const openPreviewTask = !tasks ? (data.previewTasks.find((t) => t.id === panel) ?? null) : null;

  const selection: SelectionOverlay | null =
    openStudentTask?.selection && !tasks?.closed
      ? {
          fragmentId: openStudentTask.fragmentId,
          sentences: openStudentTask.selection.sentences,
          rects: openStudentTask.selection.sentences.map((range: Sentence, index) => ({
            index,
            rects: sentenceRects(openStudentTask.selection!.lines, range),
          })),
        }
      : null;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.min(MAX_PAGE_WIDTH, Math.floor(entry.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (view !== "pdf") return;
    let cancelled = false;
    let loading: PDFDocumentLoadingTask | null = null;
    (async () => {
      const pdfjs = await loadPdfjs();
      if (cancelled) return;
      pdfjs.GlobalWorkerOptions.workerSrc = "/pdfjs/pdf.worker.min.mjs";
      loading = pdfjs.getDocument(backend.pdf());
      const loaded = await loading.promise;
      if (!cancelled) setDoc(loaded);
    })().catch((err) => {
      if (cancelled) return;
      console.error(err);
      setError("Не удалось открыть PDF. Обновите страницу.");
    });
    return () => {
      cancelled = true;
      loading?.destroy();
      setDoc(null);
    };
  }, [backend, view]);

  return (
    <div ref={containerRef} className="reader">
      {tasks && (
        <TaskBar
          tasks={tasks}
          unanswered={unanswered.length}
          deadlineLabel={deadlineLabel}
          onOpenList={() => setPanel("list")}
        />
      )}
      {leftBehind && (
        <div className="task-reminder" role="status">
          <span className="task-reminder-text">
            <b>Задание без ответа</b> осталось выше: «
            {leftBehind.prompt.length > 70 ? `${leftBehind.prompt.slice(0, 70)}…` : leftBehind.prompt}»
          </span>
          <span className="row" style={{ gap: 8 }}>
            <button
              type="button"
              className="small"
              onClick={() => {
                document
                  .querySelector(`[data-fid="${CSS.escape(leftBehind.fragmentId)}"]`)
                  ?.scrollIntoView({ block: "center", behavior: "smooth" });
                openTask(leftBehind.id);
              }}
            >
              Вернуться к заданию
            </button>
            <button
              type="button"
              className="link small"
              onClick={() => setSnoozed((prev) => new Set([...prev, leftBehind.id]))}
            >
              Позже
            </button>
          </span>
        </div>
      )}
      {skipped && (
        <div className="task-reminder" role="status">
          <span className="task-reminder-text">
            <b>Вы пропустили задание.</b>{" "}
            {skippedPage > 0 ? `Страница ${skippedPage} пролистана` : "Это место пролистано"} слишком быстро, а на ней
            спрятано задание. Вернитесь и дочитайте её — задание откроется.
          </span>
          <span className="row" style={{ gap: 8 }}>
            <button
              type="button"
              className="small"
              onClick={() =>
                document
                  .querySelector(`[data-fid="${CSS.escape(skipped.fragmentId)}"]`)
                  ?.scrollIntoView({ block: "center", behavior: "smooth" })
              }
            >
              Вернуться к странице
            </button>
            <button
              type="button"
              className="link small"
              onClick={() => setSnoozed((prev) => new Set([...prev, skipped.id]))}
            >
              Позже
            </button>
          </span>
        </div>
      )}
      {data.displayMode === "PDF" && view && (
        <div className="view-switch" role="group" aria-label="Вид текста">
          <button type="button" className={view === "web" ? undefined : "secondary"} onClick={() => chooseView("web")}>
            Текст
          </button>
          <button type="button" className={view === "pdf" ? undefined : "secondary"} onClick={() => chooseView("pdf")}>
            Страницы PDF
          </button>
        </div>
      )}
      {error && <p className="error">{error}</p>}
      {data.preview && <ZoneShade />}
      {tasks && panel === "list" && <TaskList tasks={tasks} onOpen={openTask} onClose={() => setPanel(null)} />}
      {tasks && openStudentTask && (
        <TaskPanel
          key={openStudentTask.id}
          task={openStudentTask}
          onSubmit={backend.submit}
          closed={tasks.closed}
          gradesPending={tasks.gradesPending}
          selectedSentence={selectedSentence}
          onTasks={setTasks}
          onClose={() => setPanel(null)}
          onBack={() => setPanel("list")}
        />
      )}
      {openPreviewTask && (
        <aside className="task-panel" aria-label="Задание">
          <div className="row">
            <span className="muted small">Предпросмотр задания</span>
            <span className="spacer" />
            <button type="button" className="link" onClick={() => setPanel(null)} aria-label="Закрыть">
              ✕
            </button>
          </div>
          <p className="task-prompt">{openPreviewTask.prompt}</p>
        </aside>
      )}
      {view === "web" && (
        <WebText
          data={data}
          observe={zone.observe}
          dwellMs={zone.dwellMs}
          readIds={zone.readIds}
          markers={markers}
          onMarker={openTask}
          selection={selection}
          selectedSentence={selectedSentence}
          onSentence={setSelectedSentence}
        />
      )}
      {view === "pdf" &&
        width > 0 &&
        data.pages.map((size, i) => (
          <Page
            key={i}
            index={i}
            size={size}
            width={width}
            doc={doc}
            data={data}
            observe={zone.observe}
            dwellMs={zone.dwellMs}
            readIds={zone.readIds}
            markers={markers}
            onMarker={openTask}
            selection={selection}
            selectedSentence={selectedSentence}
            onSentence={setSelectedSentence}
          />
        ))}
    </div>
  );
}

type TextViewProps = {
  data: ReaderData;
  observe: (el: HTMLElement | null) => void;
  dwellMs: Record<string, number>;
  readIds: Set<string>;
  markers: Map<string, Marker[]>;
  onMarker: (taskId: string) => void;
  selection: SelectionOverlay | null;
  selectedSentence: number | null;
  onSentence: (index: number) => void;
};

// Веб-текст: абзацы свёрстаны заново под ширину экрана. Зона чтения считается
// по абзацам так же, как по строкам на страницах PDF.
function WebText({
  data,
  observe,
  dwellMs,
  readIds,
  markers,
  onMarker,
  selection,
  selectedSentence,
  onSentence,
}: TextViewProps) {
  const thresholds = useMemo(() => new Map(data.fragments.map((f) => [f.id, f.thresholdMs])), [data.fragments]);
  return (
    <article className="web-text" lang={data.language}>
      {data.blocks.map((b) => {
        if (b.kind === "HEADING") return <h2 key={b.id}>{b.content}</h2>;
        const list = markers.get(b.id) ?? [];
        const picking = selection?.fragmentId === b.id;
        const classes = ["web-par"];
        if (data.preview) classes.push("debug");
        if (data.preview && readIds.has(b.id)) classes.push("read");
        if (list.length) classes.push("has-task");
        return (
          <div key={b.id} ref={observe} data-fid={b.id} className={classes.join(" ")}>
            <p>
              {picking
                ? selection.sentences.map((range, k) => (
                    <span key={k}>
                      {/* Текст между предложениями как есть: пробел или перевод строки (абзац). */}
                      {b.content.slice(k === 0 ? 0 : selection.sentences[k - 1][1], range[0])}
                      {/* Не <button>: кнопка в браузерах не бывает строчной и ломает абзац. */}
                      <span
                        role="button"
                        tabIndex={0}
                        aria-pressed={selectedSentence === k}
                        className={`sentence-inline${selectedSentence === k ? " picked" : ""}`}
                        onClick={() => onSentence(k)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            onSentence(k);
                          }
                        }}
                      >
                        {b.content.slice(...range)}
                      </span>
                      {k === selection.sentences.length - 1 && b.content.slice(range[1])}
                    </span>
                  ))
                : b.content}
            </p>
            {list.length > 0 && (
              <div className="web-markers">
                {list.map((m) => (
                  <MarkerButton key={m.taskId} marker={m} inline onClick={() => onMarker(m.taskId)} />
                ))}
              </div>
            )}
            {data.preview && (
              <span className="zone-timer web">
                {Math.floor((dwellMs[b.id] ?? 0) / 1000)} / {(thresholds.get(b.id) ?? 0) / 1000} с
              </span>
            )}
          </div>
        );
      })}
    </article>
  );
}

type PageProps = {
  index: number;
  size: { width: number; height: number };
  width: number;
  doc: PDFDocumentProxy | null;
  data: ReaderData;
  observe: (el: HTMLElement | null) => void;
  dwellMs: Record<string, number>;
  readIds: Set<string>;
  markers: Map<string, Marker[]>;
  onMarker: (taskId: string) => void;
  selection: SelectionOverlay | null;
  selectedSentence: number | null;
  onSentence: (index: number) => void;
};

function Page({
  index,
  size,
  width,
  doc,
  data,
  observe,
  dwellMs,
  readIds,
  markers,
  onMarker,
  selection,
  selectedSentence,
  onSentence,
}: PageProps) {
  const scale = width / size.width;
  const height = Math.round(size.height * scale);
  const pageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);

  // Страница рисуется, только когда подходит к экрану.
  useEffect(() => {
    const el = pageRef.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => entry.isIntersecting && setNear(true), { rootMargin: "100% 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!doc || !near) return;
    let task: RenderTask | null = null;
    let textLayer: TextLayer | null = null;
    let cancelled = false;
    (async () => {
      const pdfjs = await loadPdfjs();
      const page = await doc.getPage(index + 1);
      if (cancelled) return;
      const viewport = page.getViewport({ scale });
      const canvas = canvasRef.current!;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.floor(viewport.width * dpr);
      canvas.height = Math.floor(viewport.height * dpr);
      task = page.render({ canvas, viewport, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined });
      await task.promise;
      if (cancelled) return;
      const container = textRef.current!;
      container.replaceChildren();
      textLayer = new pdfjs.TextLayer({ textContentSource: page.streamTextContent(), container, viewport });
      await textLayer.render();
    })().catch((err) => {
      if (err?.name !== "RenderingCancelledException") console.error(err);
    });
    return () => {
      cancelled = true;
      task?.cancel();
      textLayer?.cancel();
    };
  }, [doc, near, index, scale]);

  const lines = data.fragments.flatMap((f) =>
    f.lines
      .map((l, k) => ({ fragment: f, line: l, key: `${f.id}:${k}`, first: k === 0 }))
      .filter((x) => x.line.page === index),
  );

  return (
    <div
      ref={pageRef}
      className="reader-page"
      style={{ width, height, ["--total-scale-factor" as string]: scale }}
      aria-label={`Страница ${index + 1}`}
    >
      <canvas ref={canvasRef} style={{ width, height }} />
      <div ref={textRef} className="textLayer" />
      {lines.map(({ fragment, line, key, first }) => {
        const [x0, y0, x1, y1] = line.bbox;
        const read = readIds.has(fragment.id);
        return (
          <div
            key={key}
            ref={observe}
            data-fid={fragment.id}
            className={data.preview ? `zone-line debug${read ? " read" : ""}` : "zone-line"}
            style={{ left: x0 * scale, top: y0 * scale, width: (x1 - x0) * scale, height: (y1 - y0) * scale }}
          >
            {data.preview && first && (
              <span className="zone-timer">
                {Math.floor((dwellMs[fragment.id] ?? 0) / 1000)} / {fragment.thresholdMs / 1000} с
              </span>
            )}
          </div>
        );
      })}
      {data.fragments.map((f) => {
        const list = markers.get(f.id);
        const anchor = f.lines[0];
        if (!list || anchor.page !== index) return null;
        // Плашки у верхнего края абзаца (страницы), друг под другом.
        return list.map((m, k) => (
          <MarkerButton
            key={m.taskId}
            marker={m}
            style={{ top: Math.max(8, anchor.bbox[1] * scale - 6) + k * 40, right: 8 }}
            onClick={() => onMarker(m.taskId)}
          />
        ));
      })}
      {selection?.rects.flatMap(({ index: sentence, rects }) =>
        rects
          .filter((r) => r.page === index)
          .map((r, k) => (
            <button
              key={`${sentence}:${k}`}
              type="button"
              className={`sentence-pick${selectedSentence === sentence ? " picked" : ""}`}
              style={{
                left: r.x0 * scale,
                top: r.y0 * scale,
                width: (r.x1 - r.x0) * scale,
                height: (r.y1 - r.y0) * scale,
              }}
              onClick={() => onSentence(sentence)}
              aria-label={`Предложение ${sentence + 1}`}
            />
          )),
      )}
    </div>
  );
}

function ZoneShade() {
  return (
    <>
      <div className="zone-shade top" aria-hidden />
      <div className="zone-shade bottom" aria-hidden />
    </>
  );
}

// Учёт времени: какие абзацы сейчас в зоне чтения и сколько они там пробыли.
function useReadingZone(data: ReaderData, backend: ReaderBackend, onResponse: (body: DwellResponse) => void) {
  // Колбэк в ref: эффект отчётов не перезапускается при каждом рендере.
  const onResponseRef = useRef(onResponse);
  useEffect(() => {
    onResponseRef.current = onResponse;
  });
  // Сколько строк каждого абзаца сейчас пересекают зону чтения.
  const inZone = useRef(new Map<string, number>());
  const lineInZone = useRef(new WeakMap<Element, boolean>());
  const observerRef = useRef<IntersectionObserver | null>(null);
  const pending = useRef<Record<string, number>>({});
  const initialDwell = data.preview ? {} : data.dwellMs;
  const initialRead = data.preview ? [] : data.readIds;
  const dwellRef = useRef<Record<string, number>>({ ...initialDwell });
  const readRef = useRef(new Set(initialRead));
  const [dwellMs, setDwellMs] = useState<Record<string, number>>(initialDwell);
  const [readIds, setReadIds] = useState(() => new Set(initialRead));

  const setLine = useCallback((el: Element, inside: boolean) => {
    if ((lineInZone.current.get(el) ?? false) === inside) return;
    lineInZone.current.set(el, inside);
    const fid = (el as HTMLElement).dataset.fid!;
    const count = (inZone.current.get(fid) ?? 0) + (inside ? 1 : -1);
    if (count > 0) inZone.current.set(fid, count);
    else inZone.current.delete(fid);
  }, []);

  const getObserver = useCallback(() => {
    observerRef.current ??= new IntersectionObserver(
      (entries) => entries.forEach((e) => setLine(e.target, e.isIntersecting)),
      { rootMargin: ZONE_MARGIN },
    );
    return observerRef.current;
  }, [setLine]);

  // Колбэк-ref строки абзаца: подключает её к наблюдателю и отключает при удалении.
  const observe = useCallback(
    (el: HTMLElement | null) => {
      if (!el) return;
      const observer = getObserver();
      observer.observe(el);
      return () => {
        observer.unobserve(el);
        setLine(el, false);
      };
    },
    [getObserver, setLine],
  );

  useEffect(() => () => observerRef.current?.disconnect(), []);

  useEffect(() => {
    const thresholds = new Map(data.fragments.map((f) => [f.id, f.thresholdMs]));

    const flush = (beacon = false) => {
      const claims = pending.current;
      pending.current = {};
      if (data.preview) return;
      backend
        .beat(claims, beacon)
        .then((body) => {
          if (!body?.readIds) return;
          readRef.current = new Set(body.readIds);
          setReadIds(readRef.current);
          onResponseRef.current(body);
        })
        .catch(() => {});
    };

    // Первый отчёт без времени: сервер отмечает открытие текста и начинает отсчёт.
    flush();

    let last = performance.now();
    let sinceBeat = 0;
    const tick = setInterval(() => {
      const now = performance.now();
      const dt = now - last;
      last = now;
      // При неактивной вкладке таймер стоит.
      if (document.visibilityState !== "visible") return;

      const ids = [...inZone.current.keys()];
      for (const id of ids) {
        pending.current[id] = (pending.current[id] ?? 0) + dt;
        dwellRef.current[id] = (dwellRef.current[id] ?? 0) + dt;
      }
      if (data.preview && ids.length) {
        // В предпросмотре дочитанность считается на месте, без сервера.
        const done = ids.filter((id) => !readRef.current.has(id) && dwellRef.current[id] >= thresholds.get(id)!);
        if (done.length) {
          readRef.current = new Set([...readRef.current, ...done]);
          setReadIds(readRef.current);
        }
        setDwellMs({ ...dwellRef.current });
      }

      sinceBeat += dt;
      if (sinceBeat >= BEAT_MS) {
        sinceBeat = 0;
        flush();
      }
    }, TICK_MS);

    const onHide = () => {
      if (document.visibilityState === "hidden") flush(true);
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onHide);
    return () => {
      clearInterval(tick);
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", onHide);
      flush(true);
    };
  }, [data, backend]);

  return { observe, dwellMs, readIds };
}
