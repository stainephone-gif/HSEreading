// Конструктор преподавателя: собрать читалку из PDF или DOCX, разослать её и ключом
// преподавателя открыть присланные отчёты.

import { useEffect, useState } from "react";
import { LogoMark } from "@/components/logo";
import type { PageText } from "~/pages";
import { newProject, parseProject, pdfDigest, type Project } from "~/project";
import { Editor } from "./editor";
import { BOOK_ACCEPT, readBook } from "./source";
import { Results } from "./results";

export type Workspace = { project: Project; pages: PageText[] | null; pdf: Uint8Array | null };

export function TeacherApp() {
  const [ws, setWs] = useState<Workspace | null>(null);
  // Изменения, которых нет в сохранённом файле ключа.
  const [dirty, setDirty] = useState(false);
  const [tab, setTab] = useState<"editor" | "results">("editor");

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  return (
    <div className="shell">
      <header className="topbar">
        <span className="brand">
          <LogoMark />
          Поля · конструктор
        </span>
        {ws && (
          <button
            type="button"
            className="link"
            onClick={() => {
              if (dirty && !window.confirm("Ключ с последними изменениями не сохранён. Закрыть?")) return;
              setWs(null);
              setDirty(false);
            }}
          >
            Закрыть
          </button>
        )}
      </header>
      {!ws ? (
        <Home
          onOpen={(w, isNew) => {
            setWs(w);
            setDirty(isNew);
            setTab(isNew ? "editor" : "results");
          }}
        />
      ) : (
        <main className="stack">
          <h1 style={{ margin: 0 }}>{ws.project.title}</h1>
          <div className="view-switch" role="group" aria-label="Раздел" style={{ alignSelf: "flex-start" }}>
            <button
              type="button"
              className={tab === "editor" ? undefined : "secondary"}
              onClick={() => setTab("editor")}
            >
              Читалка и задания
            </button>
            <button
              type="button"
              className={tab === "results" ? undefined : "secondary"}
              onClick={() => setTab("results")}
            >
              Результаты
            </button>
          </div>
          {tab === "editor" ? (
            <Editor
              ws={ws}
              dirty={dirty}
              onChange={(w) => {
                setWs(w);
                setDirty(true);
              }}
              onPdf={setWs}
              onSaved={() => setDirty(false)}
            />
          ) : (
            <Results project={ws.project} />
          )}
        </main>
      )}
    </div>
  );
}

function Home({ onOpen }: { onOpen: (ws: Workspace, isNew: boolean) => void }) {
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);

  const fromBook = async (file: File) => {
    setError(null);
    setProgress("Открываю файл…");
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const book = await readBook(bytes, (done, total) => setProgress(`Читаю текст: страница ${done} из ${total}`));
      if (typeof book === "string") return setError(book);
      onOpen({ project: newProject(file.name, bytes, book.pages, book.source), pages: book.pages, pdf: bytes }, true);
    } catch (err) {
      console.error(err);
      setError("Не удалось открыть файл.");
    } finally {
      setProgress(null);
    }
  };

  const fromKey = async (file: File) => {
    setError(null);
    const project = parseProject(await file.text());
    if (typeof project === "string") setError(project);
    else onOpen({ project, pages: null, pdf: null }, false);
  };

  return (
    <main className="card stack">
      <h1 style={{ margin: 0 }}>Конструктор читалки</h1>
      <p style={{ margin: 0 }}>
        Соберите из PDF или DOCX офлайн-читалку со спрятанными заданиями и разошлите её студентам одним файлом. Студенты
        читают без интернета и присылают вам файлы отчётов, а здесь вы открываете их ключом преподавателя.
      </p>
      <section className="stack" style={{ gap: 12 }}>
        <h2 style={{ margin: 0 }}>Новая читалка</h2>
        <label className="stack" style={{ gap: 6 }}>
          <span>Книга: PDF с текстовым слоем или документ Word (DOCX)</span>
          <input
            type="file"
            accept={BOOK_ACCEPT}
            disabled={Boolean(progress)}
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) fromBook(f);
            }}
          />
        </label>
      </section>
      <section className="stack" style={{ gap: 12 }}>
        <h2 style={{ margin: 0 }}>Уже разосланная читалка</h2>
        <label className="stack" style={{ gap: 6 }}>
          <span>Ключ преподавателя (polya-klyuch-….json)</span>
          <input
            type="file"
            accept=".json,application/json"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) fromKey(f);
            }}
          />
        </label>
        <p className="muted small" style={{ margin: 0 }}>
          Откроются результаты. Чтобы поправить задания, потом понадобится и тот же файл книги.
        </p>
      </section>
      {progress && <p className="muted">{progress}</p>}
      {error && <p className="error">{error}</p>}
    </main>
  );
}

// Книга для уже открытого ключа: должна быть тем же файлом.
export async function attachBook(ws: Workspace, file: File): Promise<Workspace | string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (pdfDigest(bytes) !== ws.project.pdf.digest) {
    return `Это другой файл. Нужен тот же файл, из которого собрана читалка: ${ws.project.pdf.name}.`;
  }
  const book = await readBook(bytes);
  if (typeof book === "string") return book;
  return { ...ws, pages: book.pages, pdf: bytes };
}
