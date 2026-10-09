import { useState } from "react";
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
import { attachPdf, type Workspace } from "./app";
import { download, fromLocalInput, ownBundle, toLocalInput } from "./files";

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

  if (!pages || !pdf) return <AttachPdf ws={ws} onPdf={onPdf} />;

  const empty = pages.map((p, i) => (p.words === 0 ? i + 1 : null)).filter((n): n is number => n !== null);
  const words = pages.reduce((n, p) => n + p.words, 0);

  return (
    <div className="stack" style={{ gap: 36 }}>
      <p className="muted" style={{ margin: 0 }}>
        {project.pdf.name} · стр.: {pages.length} · слов: {words}
        {empty.length > 0 && ` · без текста: стр. ${compactPages(empty)}`}
      </p>

      <Settings project={project} onChange={setProject} />

      <section className="stack teacher-section">
        <h2 style={{ margin: 0 }}>Спрятанные задания</h2>
        <p className="muted" style={{ margin: 0 }}>
          Задание открывается студенту, когда он дочитает нужную страницу: она должна пробыть в середине экрана половину
          расчётного времени чтения. Задания дают до 8 баллов поровну.
        </p>
        {project.tasks.length > 0 && (
          <ol className="teacher-tasks">
            {project.tasks.map((t, i) => (
              <li key={t.id} className="row" style={{ alignItems: "baseline" }}>
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
                    }
                  }}
                >
                  Удалить
                </button>
              </li>
            ))}
          </ol>
        )}
        <details>
          <summary>Новое задание</summary>
          <div style={{ marginTop: 12 }}>
            <TaskForm
              project={project}
              pages={pages}
              onCreate={(task) => setProject({ tasks: [...project.tasks, task] })}
            />
          </div>
        </details>
      </section>

      <Downloads project={project} pages={pages} pdf={pdf} dirty={dirty} onSaved={onSaved} />
    </div>
  );
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

function AttachPdf({ ws, onPdf }: { ws: Workspace; onPdf: (ws: Workspace) => void }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <section className="stack">
      <p style={{ margin: 0 }}>
        Чтобы изменить читалку или скачать её заново, выберите тот же PDF: <b>{ws.project.pdf.name}</b>.
      </p>
      <input
        type="file"
        accept="application/pdf,.pdf"
        disabled={busy}
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          setBusy(true);
          setError(null);
          try {
            const result = await attachPdf(ws, f);
            if (typeof result === "string") setError(result);
            else onPdf(result);
          } catch {
            setError("Не удалось открыть PDF.");
          } finally {
            setBusy(false);
          }
        }}
      />
      {busy && <p className="muted">Читаю PDF…</p>}
      {error && <p className="error">{error}</p>}
    </section>
  );
}

function Settings({ project, onChange }: { project: Project; onChange: (p: Partial<Project>) => void }) {
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

function TaskForm({
  project,
  pages,
  onCreate,
}: {
  project: Project;
  pages: PageText[];
  onCreate: (t: Project["tasks"][number]) => void;
}) {
  const [kind, setKind] = useState<Kind>("page-choice");
  const [page, setPage] = useState(1);
  const [pageFrom, setPageFrom] = useState(1);
  const [pageTo, setPageTo] = useState(pages.length);
  const [prompt, setPrompt] = useState("");
  const [options, setOptions] = useState<ChoiceOption[]>([
    { text: "", correct: true },
    { text: "", correct: false },
  ]);
  const [sentence, setSentence] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const current = pages[page - 1];

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
    setOptions([
      { text: "", correct: true },
      { text: "", correct: false },
    ]);
    onCreate(task);
  };

  return (
    <div className="stack" style={{ gap: 12 }}>
      <label className="stack" style={{ gap: 6 }}>
        <span>Тип</span>
        <select value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
          <option value="page-choice">На странице: выбор варианта</option>
          <option value="page-selection">На странице: выделить предложение</option>
          <option value="page-short">На странице: короткий ответ</option>
          <option value="scattered">Раскидать по страницам: у каждого студента своя (короткий ответ)</option>
        </select>
      </label>

      {kind === "scattered" ? (
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
      ) : (
        <>
          <label className="stack" style={{ gap: 6 }}>
            <span>Страница (1–{pages.length})</span>
            <input
              type="number"
              min={1}
              max={pages.length}
              value={page}
              onChange={(e) => {
                setPage(Math.min(pages.length, Math.max(1, Number(e.target.value) || 1)));
                setSentence(null);
              }}
            />
          </label>
          {kind !== "page-selection" && (
            <p className="page-preview" style={{ margin: 0 }}>
              {current?.content ? `${current.content.slice(0, 300)}…` : "На этой странице нет текста."}
            </p>
          )}
        </>
      )}

      <label className="stack" style={{ gap: 6 }}>
        <span>Задание</span>
        <textarea value={prompt} rows={3} maxLength={2000} onChange={(e) => setPrompt(e.target.value)} />
      </label>

      {kind === "page-choice" && (
        <div className="stack" style={{ gap: 6 }}>
          {options.map((o, i) => (
            <div key={i} className="row">
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
                  onClick={() => {
                    const next = options.filter((_, k) => k !== i);
                    if (!next.some((x) => x.correct)) next[0].correct = true;
                    setOptions(next);
                  }}
                >
                  убрать
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
          <span className="muted small">
            Эталонное предложение: засчитается выделение, совпадающее с ним больше чем наполовину.
          </span>
          {current?.sentences.length ? (
            <div className="sentence-options">
              {current.sentences.map(([s, e], i) => (
                <label key={i}>
                  <input type="radio" name="sentence" checked={sentence === i} onChange={() => setSentence(i)} />
                  {current.content.slice(s, e)}
                </label>
              ))}
            </div>
          ) : (
            <p className="muted">На этой странице нет текста.</p>
          )}
        </div>
      )}

      {error && <p className="error">{error}</p>}
      <div>
        <button type="button" className="secondary" onClick={submit} disabled={!prompt.trim()}>
          Добавить задание
        </button>
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
