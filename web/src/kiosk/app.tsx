// Офлайн-читалка (киоск): HTML-файл, который студент открывает с диска. Та же
// читалка, что в приложении, но отчитывается не серверу, а в состояние в
// браузере. Отчёт для преподавателя студент сохраняет файлом.

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { type ReaderBackend, Reader } from "@/app/texts/[textId]/read/reader";
import { LogoMark } from "@/components/logo";
import { normalizeStudent } from "@/lib/kiosk-engine";
import { type KioskSession, type KioskStore, reportFileName } from "./session";

function download(name: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: "text/plain" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function formatTime(ms: number): string {
  return new Date(ms).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" });
}

export function KioskApp({ store, pdf }: { store: KioskStore; pdf: Uint8Array }) {
  const [session, setSession] = useState<KioskSession | null>(() => store.load());
  if (!session) return <StartScreen store={store} onStart={setSession} />;
  return <Reading key={session.id} store={store} session={session} pdf={pdf} onSession={setSession} />;
}

function Shell({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="shell">
      <header className="topbar">
        <span className="brand">
          <LogoMark />
          Поля
        </span>
        {right}
      </header>
      {children}
    </div>
  );
}

function RestoreButton({
  store,
  onRestore,
  label,
}: {
  store: KioskStore;
  onRestore: (s: KioskSession) => void;
  label: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <button type="button" className="link small" onClick={() => input.current?.click()}>
        {label}
      </button>
      <input
        ref={input}
        type="file"
        accept=".polya,text/plain"
        hidden
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          const result = await store.restore(file);
          if (typeof result === "string") setError(result);
          else {
            setError(null);
            onRestore(result);
          }
        }}
      />
      {error && <span className="error small">{error}</span>}
    </>
  );
}

function StartScreen({ store, onStart }: { store: KioskStore; onStart: (s: KioskSession) => void }) {
  const { data } = store;
  const [error, setError] = useState<string | null>(null);
  return (
    <Shell>
      <main className="card stack">
        <h1 style={{ margin: 0 }}>{data.title}</h1>
        <p style={{ margin: 0 }}>
          Офлайн-читалка: интернет не нужен. Читайте текст — по мере чтения на полях появятся спрятанные задания.
          {data.tasks.length > 0 && ` Всего заданий: ${data.tasks.length}.`}
          {data.deadlineLabel && ` ${data.deadlineLabel}.`}
        </p>
        <p className="muted" style={{ margin: 0 }}>
          Прогресс хранится в этом браузере. Когда закончите (или в любой момент раньше), нажмите «Сохранить отчёт» и
          пришлите файл отчёта преподавателю. Отчёт можно сохранять сколько угодно раз — присылайте последний.
        </p>
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            const form = new FormData(e.currentTarget);
            const student = normalizeStudent({
              name: String(form.get("name") ?? ""),
              email: String(form.get("email") ?? ""),
            });
            if (typeof student === "string") setError(student);
            else onStart(store.start(student));
          }}
        >
          <label className="stack" style={{ gap: 6 }}>
            <span>Фамилия и имя</span>
            <input type="text" name="name" required autoComplete="name" />
          </label>
          <label className="stack" style={{ gap: 6 }}>
            <span>Почта: по ней преподаватель узнает ваш отчёт</span>
            <input type="email" name="email" required autoComplete="email" />
          </label>
          {error && <p className="error">{error}</p>}
          <div className="row">
            <button type="submit">Начать чтение</button>
            <RestoreButton store={store} onRestore={onStart} label="Продолжить по сохранённому отчёту" />
          </div>
        </form>
      </main>
    </Shell>
  );
}

function Reading({
  store,
  session,
  pdf,
  onSession,
}: {
  store: KioskStore;
  session: KioskSession;
  pdf: Uint8Array;
  onSession: (s: KioskSession | null) => void;
}) {
  // Перерисовка подсказок при каждом изменении прогресса.
  useSyncExternalStore(
    (cb) => session.subscribe(cb),
    () => session.version,
  );

  const backend = useMemo(
    (): ReaderBackend => ({
      // pdf.js забирает буфер себе, поэтому каждый раз копия.
      pdf: () => ({ data: pdf.slice() }),
      beat: async (claims) => session.beat(claims),
      submit: async (taskId, value) => session.submit(taskId, value),
    }),
    [session, pdf],
  );
  // Начальные данные: дальше читалка живёт своими отчётами.
  const [readerData] = useState(() => session.readerData());
  const closed = readerData.tasks?.closed ?? false;

  // Закрытие вкладки с несохранённым отчётом: браузер переспросит.
  const dirty = session.dirty;
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  const saveReport = () => {
    const file = session.report();
    download(reportFileName(session.student.name, new Date()), file);
  };

  return (
    <Shell
      right={
        <div className="row">
          <span className="nav-label">{session.student.name}</span>
          <button type="button" onClick={saveReport}>
            Сохранить отчёт
          </button>
        </div>
      }
    >
      <main className="stack">
        <h1 style={{ margin: 0 }}>{store.data.title}</h1>
        <div className="row small">
          <span className={dirty ? undefined : "muted"}>
            {session.reportedAt
              ? `Отчёт сохранён ${formatTime(session.reportedAt)}${dirty ? ", после этого есть новый прогресс" : ""}.`
              : "Отчёт ещё не сохранялся."}{" "}
            Пришлите преподавателю последний файл отчёта.
          </span>
          <span className="spacer" />
          <RestoreButton store={store} onRestore={onSession} label="Загрузить отчёт" />
          <button
            type="button"
            className="link small"
            onClick={() => {
              const ok = window.confirm(
                `Прогресс (${session.student.name}) будет удалён из этого браузера. ` +
                  "Если отчёт не сохранён, он пропадёт. Продолжить?",
              );
              if (!ok) return;
              store.clear();
              onSession(null);
            }}
          >
            Другой студент
          </button>
        </div>
        {!session.storageOk && (
          <p className="error small" style={{ margin: 0 }}>
            Браузер не даёт сохранять прогресс (частный режим?). Не закрывайте вкладку, пока не сохраните отчёт.
          </p>
        )}
        {closed && (
          <p className="muted small" style={{ margin: 0 }}>
            Дедлайн прошёл: ответы больше не меняются. Сохраните и пришлите отчёт.
          </p>
        )}
        <Reader data={readerData} backend={backend} deadlineLabel={store.data.deadlineLabel} />
      </main>
    </Shell>
  );
}
