import type { PDFDocumentProxy } from "pdfjs-dist/legacy/build/pdf.mjs";
import { useEffect, useState } from "react";
import { unlockSeconds } from "@/lib/fragments";
import {
  buildKioskData,
  type ChoiceOption,
  createTask,
  describeTask,
  keyFileName,
  type Project,
  renderStudentHtml,
  serializeProject,
  studentFileName,
  type TaskInput,
} from "~/project";
import type { PageText } from "~/pages";
import { attachBook, type Workspace } from "./app";
import { download, fromLocalInput, openPdf, ownBundle, toLocalInput } from "./files";
import { PageView, TextPageView } from "./page-view";
import { BOOK_ACCEPT } from "./source";
import { TaskImport } from "./task-import";

const FORMAT_LABEL = { CHOICE: "выбор варианта", SELECTION: "выделить предложение", SHORT: "короткий ответ" } as const;

export function Editor({
  ws,
  dirty,
  onChange,
  onPdf,
  onSaved,
}: {
  ws: Workspace;
  dirty: boolean;
  onChange: (ws: Workspace) => void;
  onPdf: (ws: Workspace) => void;
  onSaved: () => void;
}) {
  const { project, pages, pdf } = ws;
  const setProject = (p: Partial<Project>) => onChange({ ...ws, project: { ...project, ...p } });
  const docx = project.source === "docx";
  // Только что добавленные задания: подсвечены в списке, о них сообщение.
  const [fresh, setFresh] = useState<{ ids: Set<string>; text: string } | null>(null);
  const addTasks = (tasks: Project["tasks"], replace = false) => {
    const before = new Set(project.tasks.map((t) => t.id));
    const added = tasks.filter((t) => !before.has(t.id));
    setProject({ tasks: replace ? tasks : [...project.tasks, ...tasks] });
    const total = replace ? tasks.length : project.tasks.length + tasks.length;
    setFresh({
      ids: new Set(added.map((t) => t.id)),
      text:
        added.length === 1 && !replace
          ? `Задание ${total} добавлено (${describeTask(added[0])}). Всего заданий: ${total}.`
          : `${replace ? "Задания заменены" : "Добавлено заданий"}: ${added.length}. Всего заданий: ${total}.`,
    });
  };
  const doc = usePdfDoc(docx ? null : pdf);

  if (!pages || !pdf) return <AttachBook ws={ws} onBook={onPdf} />;

  const empty = pages.map((p, i) => (p.words === 0 ? i + 1 : null)).filter((n): n is number => n !== null);
  const words = pages.reduce((n, p) => n + p.words, 0);

  return (
    <div className="stack" style={{ gap: 36 }}>
      <p className="muted" style={{ margin: 0 }}>
        {project.pdf.name} · стр.: {pages.length}
        {docx && " (документ Word поделён на страницы примерно по 350 слов)"} · слов: {words}
        {empty.length > 0 && ` · без текста: стр. ${compactPages(empty)}`}
      </p>

      <Settings project={project} docx={docx} onChange={setProject} />

      <section className="stack teacher-section">
        <h2 style={{ margin: 0 }}>
          Спрятанные задания{project.tasks.length > 0 && <span className="muted"> · {project.tasks.length}</span>}
        </h2>
        <p className="muted" style={{ margin: 0 }}>
          Задание открывается студенту, когда он дочитает нужную страницу: она должна пробыть в середине экрана половину
          расчётного времени чтения. Задания дают до 8 баллов поровну.
        </p>
        {fresh && (
          <p className="added-note" role="status">
            ✓ {fresh.text} Не забудьте скачать ключ и читалку заново.
          </p>
        )}
        {project.tasks.length === 0 && (
          <p className="muted" style={{ margin: 0 }}>
            Заданий пока нет: добавьте их формой ниже или загрузите из файла.
          </p>
        )}
        {project.tasks.length > 0 && (
          <ol className="teacher-tasks">
            {project.tasks.map((t, i) => (
              <li
                key={t.id}
                className={`row${fresh?.ids.has(t.id) ? " fresh" : ""}`}
                style={{ alignItems: "baseline" }}
              >
                <span>
                  {i + 1}. {t.prompt}{" "}
                  <span className="muted small">
                    · {describeTask(t)} · {FORMAT_LABEL[t.format]}
                    {t.options && ` · верно: «${t.options.find((o) => o.correct)?.text}»`}
                    {t.answerRange && ` · «${t.pageContent?.slice(...t.answerRange).slice(0, 80)}»`}
                  </span>
                </span>
                <span className="spacer" />
                <button
                  type="button"
                  className="link small"
                  onClick={() => {
                    if (window.confirm("Удалить задание?")) {
                      setProject({ tasks: project.tasks.filter((x) => x.id !== t.id) });
                      setFresh(null);
                    }
                  }}
                >
                  Удалить
                </button>
              </li>
            ))}
          </ol>
        )}
        <TaskImport project={project} pages={pages} onApply={addTasks} />
        <details open>
          <summary>Новое задание</summary>
          <div style={{ marginTop: 12 }}>
            <TaskForm project={project} pages={pages} doc={doc} onCreate={(task) => addTasks([task])} />
          </div>
        </details>
      </section>

      <Downloads project={project} pages={pages} pdf={docx ? new Uint8Array(0) : pdf} dirty={dirty} onSaved={onSaved} />
    </div>
  );
}

// Открытый PDF для показа страниц; закрывается, когда редактор уходит с экрана.
function usePdfDoc(pdf: Uint8Array | null): PDFDocumentProxy | null {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  useEffect(() => {
    if (!pdf) return;
    let close: (() => Promise<void>) | null = null;
    let cancelled = false;
    openPdf(pdf)
      .then((opened) => {
        close = opened.close;
        if (cancelled) opened.close();
        else setDoc(opened.doc);
      })
      .catch((err) => console.error(err));
    return () => {
      cancelled = true;
      close?.();
      setDoc(null);
    };
  }, [pdf]);
  return doc;
}

function compactPages(nums: number[]): string {
  const parts: string[] = [];
  for (let i = 0; i < nums.length; i++) {
    let j = i;
    while (nums[j + 1] === nums[j] + 1) j++;
    parts.push(j > i ? `${nums[i]}–${nums[j]}` : String(nums[i]));
    i = j;
  }
  return parts.join(", ");
}

function AttachBook({ ws, onBook }: { ws: Workspace; onBook: (ws: Workspace) => void }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <section className="stack">
      <p style={{ margin: 0 }}>
        Чтобы изменить читалку или скачать её заново, выберите тот же файл книги: <b>{ws.project.pdf.name}</b>.
      </p>
      <input
        type="file"
        accept={BOOK_ACCEPT}
        disabled={busy}
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          setBusy(true);
          setError(null);
          try {
            const result = await attachBook(ws, f);
            if (typeof result === "string") setError(result);
            else onBook(result);
          } catch {
            setError("Не удалось открыть файл.");
          } finally {
            setBusy(false);
          }
        }}
      />
      {busy && <p className="muted">Читаю книгу…</p>}
      {error && <p className="error">{error}</p>}
    </section>
  );
}

function Settings({
  project,
  docx,
  onChange,
}: {
  project: Project;
  docx: boolean;
  onChange: (p: Partial<Project>) => void;
}) {
  return (
    <section className="stack teacher-section">
      <h2 style={{ margin: 0 }}>Настройки</h2>
      <label className="stack" style={{ gap: 6 }}>
        <span>Название</span>
        <input
          type="text"
          value={project.title}
          maxLength={300}
          onChange={(e) => onChange({ title: e.target.value })}
          onBlur={(e) => onChange({ title: e.target.value.trim() || "Текст" })}
        />
      </label>
      <div className="row" style={{ alignItems: "flex-end" }}>
        <label className="stack" style={{ gap: 6 }}>
          <span>Норма чтения, слов в минуту</span>
          <input
            type="number"
            min={50}
            max={1000}
            value={project.wordsPerMinute}
            onChange={(e) => onChange({ wordsPerMinute: Math.min(1000, Math.max(50, Number(e.target.value) || 200)) })}
          />
        </label>
        {/* DOCX читается только текстом. */}
        {!docx && (
          <label className="stack" style={{ gap: 6 }}>
            <span>Вид по умолчанию</span>
            <select
              value={project.displayMode}
              onChange={(e) => onChange({ displayMode: e.target.value === "WEB" ? "WEB" : "PDF" })}
            >
              <option value="PDF">Страницы PDF</option>
              <option value="WEB">Текст</option>
            </select>
          </label>
        )}
        <label className="stack" style={{ gap: 6 }}>
          <span>Дедлайн ответов (необязательно)</span>
          <input
            type="datetime-local"
            value={toLocalInput(project.deadline)}
            onChange={(e) => onChange({ deadline: fromLocalInput(e.target.value) })}
          />
        </label>
      </div>
      <p className="muted small" style={{ margin: 0 }}>
        От нормы чтения зависит, через сколько секунд страница считается дочитанной: страница в 300 слов при{" "}
        {project.wordsPerMinute} сл./мин — {Math.max(1, unlockSeconds(300, project.wordsPerMinute))} с. Дедлайн
        проверяется по часам компьютера студента и при открытии отчётов.
      </p>
    </section>
  );
}

type Kind = TaskInput["kind"];

// Типы заданий: что делает студент и кто проверяет ответ.
const KINDS: { kind: Kind; title: string; hint: string }[] = [
  {
    kind: "page-choice",
    title: "Выбрать вариант",
    hint: "Студент выбирает один из 2–6 вариантов. Вы отмечаете верный, проверка автоматическая.",
  },
  {
    kind: "page-selection",
    title: "Найти предложение на странице",
    hint: "Студент щёлкает по нужному предложению в тексте. Вы выбираете эталон на странице слева, проверка автоматическая.",
  },
  {
    kind: "page-short",
    title: "Написать короткий ответ",
    hint: "Студент пишет до трёх предложений. Проверяете вы в «Результатах».",
  },
  {
    kind: "scattered",
    title: "Короткий ответ на «своей» странице",
    hint: "Каждому студенту задание выпадет на случайной странице из диапазона: у соседа место другое. Проверяете вы.",
  },
];

const fresh = (): ChoiceOption[] => [
  { text: "", correct: true },
  { text: "", correct: false },
];

// Задание назначается к странице, которая открыта слева: её видно так же, как
// увидит студент.
function TaskForm({
  project,
  pages,
  doc,
  onCreate,
}: {
  project: Project;
  pages: PageText[];
  doc: PDFDocumentProxy | null;
  onCreate: (t: Project["tasks"][number]) => void;
}) {
  const [kind, setKind] = useState<Kind>("page-choice");
  const [page, setPage] = useState(1);
  const [pageInput, setPageInput] = useState("1");
  const [pageFrom, setPageFrom] = useState(1);
  const [pageTo, setPageTo] = useState(pages.length);
  const [prompt, setPrompt] = useState("");
  const [options, setOptions] = useState<ChoiceOption[]>(fresh);
  const [sentence, setSentence] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Подтверждение под кнопкой; пропадает, когда начинают новое задание.
  const [done, setDone] = useState<string | null>(null);
  const current = pages[page - 1];
  const here = project.tasks.map((t, i) => ({ t, n: i + 1 })).filter(({ t }) => t.page === page - 1);

  const go = (n: number) => {
    const next = Math.min(pages.length, Math.max(1, Math.round(n) || 1));
    setPage(next);
    setPageInput(String(next));
    setSentence(null);
  };

  const submit = () => {
    const input: TaskInput =
      kind === "scattered"
        ? { kind, pageFrom, pageTo, prompt }
        : kind === "page-choice"
          ? { kind, page: page - 1, prompt, options }
          : kind === "page-selection"
            ? { kind, page: page - 1, prompt, sentenceIndex: sentence ?? -1 }
            : { kind, page: page - 1, prompt };
    const task = createTask(project, pages, input);
    if (typeof task === "string") return setError(task);
    setError(null);
    setPrompt("");
    setSentence(null);
    setOptions(fresh());
    onCreate(task);
    setDone(
      task.page !== null
        ? `Задание ${project.tasks.length + 1} добавлено к стр. ${task.page + 1}. Оно появилось в списке выше и отмечено на странице.`
        : `Задание ${project.tasks.length + 1} добавлено: ${describeTask(task)}. Оно появилось в списке выше.`,
    );
  };

  return (
    <div className="task-editor">
      <div className="stack" style={{ gap: 12 }}>
        <div className="row page-nav">
          <button type="button" className="secondary small" onClick={() => go(page - 1)} disabled={page <= 1}>
            ‹ Назад
          </button>
          <span className="row" style={{ gap: 6 }}>
            Страница
            <input
              type="number"
              min={1}
              max={pages.length}
              value={pageInput}
              aria-label="Номер страницы"
              onChange={(e) => setPageInput(e.target.value)}
              onBlur={() => go(Number(pageInput))}
              onKeyDown={(e) => e.key === "Enter" && go(Number(pageInput))}
            />
            из {pages.length}
          </span>
          <button
            type="button"
            className="secondary small"
            onClick={() => go(page + 1)}
            disabled={page >= pages.length}
          >
            Вперёд ›
          </button>
        </div>
        <p className="muted small" style={{ margin: 0 }}>
          {current.words === 0
            ? "На этой странице нет текстового слоя: задание к ней не назначить."
            : here.length
              ? `На этой странице уже есть задания: ${here.map((x) => x.n).join(", ")}. Плашки на странице — только отметки для вас; выполнить задание можно в читалке студента (кнопка «Скачать читалку для студентов» внизу).`
              : "На этой странице заданий пока нет."}
        </p>
        {project.source === "docx" ? (
          <TextPageView
            badges={here.map((x) => x.n)}
            page={current}
            picking={kind === "page-selection"}
            picked={sentence}
            onPick={setSentence}
          />
        ) : (
          <PageView
            doc={doc}
            page={current}
            index={page - 1}
            picking={kind === "page-selection"}
            picked={sentence}
            onPick={setSentence}
            badges={here.map((x) => x.n)}
          />
        )}
      </div>

      <div className="stack task-editor-form" style={{ gap: 12 }}>
        <fieldset className="stack" style={{ gap: 6 }}>
          <legend className="field-caption">Что сделает студент</legend>
          <div className="kind-options">
            {KINDS.map((k) => (
              <label key={k.kind} className={`kind-option${kind === k.kind ? " active" : ""}`}>
                <input type="radio" name="kind" checked={kind === k.kind} onChange={() => setKind(k.kind)} />
                <span className="kind-text">
                  <b>{k.title}</b>
                  <span className="muted small">{k.hint}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        {kind === "scattered" ? (
          <div className="stack" style={{ gap: 6 }}>
            <div className="row">
              <label className="stack" style={{ gap: 6 }}>
                <span>Со страницы</span>
                <input
                  type="number"
                  min={1}
                  max={pages.length}
                  value={pageFrom}
                  onChange={(e) => setPageFrom(Number(e.target.value))}
                />
              </label>
              <label className="stack" style={{ gap: 6 }}>
                <span>По страницу</span>
                <input
                  type="number"
                  min={1}
                  max={pages.length}
                  value={pageTo}
                  onChange={(e) => setPageTo(Number(e.target.value))}
                />
              </label>
            </div>
            <div className="row">
              <button type="button" className="link small" onClick={() => setPageFrom(page)}>
                Начало — эта страница
              </button>
              <button type="button" className="link small" onClick={() => setPageTo(page)}>
                Конец — эта страница
              </button>
            </div>
          </div>
        ) : (
          <p style={{ margin: 0 }}>
            К странице <b>{page}</b>
          </p>
        )}

        <label className="stack" style={{ gap: 6 }}>
          <span>Задание</span>
          <textarea
            value={prompt}
            rows={4}
            maxLength={2000}
            onChange={(e) => {
              setPrompt(e.target.value);
              setDone(null);
            }}
          />
        </label>

        {kind === "page-choice" && (
          <div className="stack" style={{ gap: 6 }}>
            {options.map((o, i) => (
              <div key={i} className="row" style={{ flexWrap: "nowrap" }}>
                <input
                  type="radio"
                  name="correct"
                  checked={o.correct}
                  onChange={() => setOptions(options.map((x, k) => ({ ...x, correct: k === i })))}
                  aria-label="Верный вариант"
                />
                <input
                  type="text"
                  value={o.text}
                  placeholder={`Вариант ${i + 1}`}
                  maxLength={500}
                  onChange={(e) => setOptions(options.map((x, k) => (k === i ? { ...x, text: e.target.value } : x)))}
                />
                {options.length > 2 && (
                  <button
                    type="button"
                    className="link small"
                    aria-label="Убрать вариант"
                    onClick={() => {
                      const next = options.filter((_, k) => k !== i);
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
                  className="link small"
                  onClick={() => setOptions([...options, { text: "", correct: false }])}
                >
                  + вариант
                </button>
              </div>
            )}
            <p className="muted small" style={{ margin: 0 }}>
              Отметьте верный вариант кружком слева.
            </p>
          </div>
        )}

        {kind === "page-selection" && (
          <div className="stack" style={{ gap: 6 }}>
            {sentence !== null ? (
              <blockquote className="picked">{current.content.slice(...current.sentences[sentence])}</blockquote>
            ) : (
              <p className="muted small" style={{ margin: 0 }}>
                Щёлкните на странице эталонное предложение: засчитается выделение, совпадающее с ним больше чем
                наполовину.
              </p>
            )}
          </div>
        )}

        {error && <p className="error">{error}</p>}
        <div>
          <button type="button" onClick={submit} disabled={!prompt.trim()}>
            Добавить задание
          </button>
        </div>
        {done && (
          <p className="added-note" role="status">
            ✓ {done}
          </p>
        )}
      </div>
    </div>
  );
}

function Downloads({
  project,
  pages,
  pdf,
  dirty,
  onSaved,
}: {
  project: Project;
  pages: PageText[];
  pdf: Uint8Array;
  dirty: boolean;
  onSaved: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  return (
    <section className="stack teacher-section">
      <h2 style={{ margin: 0 }}>Файлы</h2>
      <ol className="stack" style={{ gap: 12, margin: 0, paddingLeft: 20 }}>
        <li>
          <div className="row">
            <button
              type="button"
              className={dirty ? undefined : "secondary"}
              onClick={() => {
                download(keyFileName(project.title), serializeProject(project), "application/json");
                onSaved();
              }}
            >
              Скачать ключ преподавателя
            </button>
            {dirty && (
              <span className="small" style={{ color: "var(--color-saffron-spark)" }}>
                есть несохранённые изменения
              </span>
            )}
          </div>
          <p className="muted small" style={{ margin: "6px 0 0" }}>
            Храните у себя и никому не отправляйте. В нём верные ответы и ключ к отчётам: без него отчёты не открыть.
            После правки заданий скачайте ключ заново.
          </p>
        </li>
        <li>
          <div className="row">
            <button
              type="button"
              className="secondary"
              onClick={() => {
                const bundle = ownBundle();
                if (!bundle) return setError("Конструктор открыт не из собранного файла: читалку не собрать.");
                setError(null);
                const html = renderStudentHtml({ data: buildKioskData(project, pages), pdf, ...bundle });
                download(studentFileName(project.title), html, "text/html");
              }}
            >
              Скачать читалку для студентов
            </button>
          </div>
          <p className="muted small" style={{ margin: "6px 0 0" }}>
            Один HTML-файл с книгой и заданиями, без верных ответов. Разошлите его студентам. Если поменяете задания
            после рассылки, разошлите новый файл: студенты продолжат с того же места (если браузер не сохранил прогресс
            — кнопкой «Продолжить по сохранённому отчёту»).
          </p>
        </li>
      </ol>
      {error && <p className="error">{error}</p>}
    </section>
  );
}
