"use client";

import type { DocumentInitParameters } from "pdfjs-dist/types/src/display/api";
import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask, TextLayer } from "pdfjs-dist/legacy/build/pdf.mjs";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { sentenceRects } from "@/lib/geometry";
import type { Sentence } from "@/lib/pdf-service";
import type { ReaderData } from "@/lib/reading";
import type { StudentTasks } from "@/lib/tasks";
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

type Marker = { taskId: string; isNew: boolean };
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

  const openTask = useCallback((id: string) => {
    setPanel(id);
    setSelectedSentence(null);
    setSeen((prev) => (prev.has(id) ? prev : new Set([...prev, id])));
  }, []);

  const markers = useMemo(() => {
    const map = new Map<string, Marker[]>();
    const add = (fragmentId: string, taskId: string) =>
      map.set(fragmentId, [...(map.get(fragmentId) ?? []), { taskId, isNew: !seen.has(taskId) }]);
    if (tasks) tasks.found.forEach((t) => add(t.fragmentId, t.id));
    else data.previewTasks.filter((t) => zone.readIds.has(t.fragmentId)).forEach((t) => add(t.fragmentId, t.id));
    return map;
  }, [tasks, data.previewTasks, zone.readIds, seen]);

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
      {tasks && <TaskBar tasks={tasks} deadlineLabel={deadlineLabel} onOpenList={() => setPanel("list")} />}
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
                      </span>{" "}
                    </span>
                  ))
                : b.content}
            </p>
            {list.length > 0 && (
              <div className="web-markers">
                {list.map((m) => (
                  <button
                    key={m.taskId}
                    type="button"
                    className={`task-marker inline${m.isNew ? " new" : ""}`}
                    onClick={() => onMarker(m.taskId)}
                    aria-label="Открыть задание"
                    title="Задание"
                  >
                    ?
                  </button>
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
        return list.map((m, k) => (
          <button
            key={m.taskId}
            type="button"
            className={`task-marker${m.isNew ? " new" : ""}`}
            style={{ top: anchor.bbox[1] * scale - 4, right: 4 + k * 30 }}
            onClick={() => onMarker(m.taskId)}
            aria-label="Открыть задание"
            title="Задание"
          >
            ?
          </button>
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
