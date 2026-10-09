"use client";

import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask, TextLayer } from "pdfjs-dist/legacy/build/pdf.mjs";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReaderData } from "@/lib/reading";

// Зона чтения: средняя полоса экрана, по 20% высоты сверху и снизу не считаются.
const ZONE_MARGIN = "-20% 0px -20% 0px";
const TICK_MS = 1_000;
const BEAT_MS = 5_000;
const MAX_PAGE_WIDTH = 900;

// Legacy-сборка PDF.js: обычная требует новейших методов JS (Map.getOrInsertComputed),
// которых нет в Safari и не самых свежих Chrome.
const loadPdfjs = () => import("pdfjs-dist/legacy/build/pdf.mjs");

export function Reader({ data, pdfUrl }: { data: ReaderData; pdfUrl: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const zone = useReadingZone(data);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.min(MAX_PAGE_WIDTH, Math.floor(entry.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    let loading: PDFDocumentLoadingTask | null = null;
    (async () => {
      const pdfjs = await loadPdfjs();
      if (cancelled) return;
      pdfjs.GlobalWorkerOptions.workerSrc = "/pdfjs/pdf.worker.min.mjs";
      loading = pdfjs.getDocument({ url: pdfUrl });
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
    };
  }, [pdfUrl]);

  return (
    <div ref={containerRef} className="reader">
      {error && <p className="error">{error}</p>}
      {data.preview && <ZoneShade />}
      {width > 0 &&
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
          />
        ))}
    </div>
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
};

function Page({ index, size, width, doc, data, observe, dwellMs, readIds }: PageProps) {
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
function useReadingZone(data: ReaderData) {
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
    const url = `/texts/${data.textId}/dwell`;
    const thresholds = new Map(data.fragments.map((f) => [f.id, f.thresholdMs]));

    const flush = (beacon = false) => {
      const claims = pending.current;
      pending.current = {};
      if (data.preview) return;
      const payload = JSON.stringify({ claims });
      if (beacon && navigator.sendBeacon) {
        navigator.sendBeacon(url, new Blob([payload], { type: "text/plain" }));
        return;
      }
      fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: payload, keepalive: true })
        .then((res) => (res.ok ? res.json() : null))
        .then((body: { readIds?: string[] } | null) => {
          if (!body?.readIds) return;
          readRef.current = new Set(body.readIds);
          setReadIds(readRef.current);
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
  }, [data]);

  return { observe, dwellMs, readIds };
}
