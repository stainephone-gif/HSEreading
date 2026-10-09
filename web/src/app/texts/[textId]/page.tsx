import Link from "next/link";
import { notFound } from "next/navigation";
import { unlockSeconds } from "@/lib/fragments";
import type { FragmentLine } from "@/lib/pdf-service";
import type { Sentence } from "@/lib/pdf-service";
import { listKioskImports } from "@/lib/kiosk";
import { getReadingSummary } from "@/lib/reading";
import { listTasksForTeacher } from "@/lib/tasks";
import { appTimeZone, dateToLocalInput, formatDateTime } from "@/lib/time";
import { requireUser } from "@/lib/session";
import { getTextForTeacher } from "@/lib/texts";
import { FragmentList, type FragmentView } from "./fragment-list";
import { KioskImport } from "./kiosk-section";
import { PublishButton } from "./publish-button";
import { TaskForm } from "./task-form";
import { TeacherTaskList } from "./task-list";
import { ReparseButton } from "./reparse-button";
import { SettingsForm } from "./settings-form";

export default async function TextPage({ params }: { params: Promise<{ textId: string }> }) {
  const { textId } = await params;
  const user = await requireUser(`/texts/${textId}`);
  const text = await getTextForTeacher(textId, user.id);
  if (!text) notFound();

  const fragments: FragmentView[] = text.fragments.map((f) => ({
    id: f.id,
    kind: f.kind,
    content: f.content,
    sentences: f.sentences as [number, number][],
    wordCount: f.wordCount,
    unlockSeconds: unlockSeconds(f.wordCount, text.wordsPerMinute),
    pages: [...new Set((f.lines as FragmentLine[]).map((l) => l.page))],
    excludeReason: f.excludeReason,
  }));
  const body = fragments.filter((f) => f.kind === "BODY");
  const words = body.reduce((sum, f) => sum + f.wordCount, 0);
  const published = Boolean(text.publishedAt);
  const summary = published ? await getReadingSummary(text.id, user.id) : null;
  const kiosk = published ? await listKioskImports(text.id, user.id) : null;
  const tasks = text.status === "READY" ? await listTasksForTeacher(text.id, user.id) : [];
  const paragraphs = text.fragments
    .filter((f) => f.kind === "BODY")
    .map((f) => {
      const page = ((f.lines as FragmentLine[])[0]?.page ?? 0) + 1;
      return {
        id: f.id,
        label: `стр. ${page}: ${f.content.slice(0, 70)}…`,
        sentences: (f.sentences as Sentence[]).map(([s, e]) => f.content.slice(s, e)),
      };
    });
  const sections = text.fragments.filter((f) => f.kind === "HEADING").map((f) => ({ id: f.id, label: f.content }));

  return (
    <main className="stack">
      <p style={{ margin: 0 }}>
        <Link href={`/courses/${text.courseId}`}>← {text.course.title}</Link>
      </p>
      <h1 style={{ margin: 0 }}>{text.title}</h1>
      <p className="muted" style={{ margin: 0 }}>
        <a href={`/texts/${text.id}/pdf`} target="_blank" rel="noreferrer">
          {text.pdfName}
        </a>
        {text.status === "READY" && (
          <>
            {" "}
            · стр.: {text.pageCount} · язык: {text.language === "ru" ? "русский" : "английский"} · абзацев:{" "}
            {body.length} · слов: {words}
          </>
        )}
      </p>

      {text.status === "FAILED" && (
        <section className="card stack">
          <p className="error" style={{ margin: 0 }}>
            {text.error}
          </p>
          <div>
            <ReparseButton textId={text.id} label="Попробовать ещё раз" />
          </div>
        </section>
      )}

      {text.status === "PROCESSING" && <p className="muted">Текст разбирается…</p>}

      {text.status === "READY" && (
        <section className="card stack">
          <div className="row">
            <h2 style={{ margin: 0 }}>Публикация</h2>
            <span className="spacer" />
            <Link href={`/texts/${text.id}/read`}>Предпросмотр читалки</Link>
            <Link href={`/texts/${text.id}/results`}>Результаты</Link>
          </div>
          <p style={{ margin: 0 }}>
            {published
              ? `Опубликован ${text.publishedAt!.toLocaleDateString("ru-RU")}: студенты видят текст в курсе.`
              : "Черновик: студенты текст не видят. Проверьте разбивку и опубликуйте."}
          </p>
          <div>
            <PublishButton textId={text.id} published={published} />
          </div>
        </section>
      )}

      {kiosk && (
        <section className="card stack" id="kiosk">
          <div className="row">
            <h2 style={{ margin: 0 }}>Офлайн-читалка</h2>
            <span className="spacer" />
            <a href={`/texts/${text.id}/kiosk`} download>
              Скачать HTML-файл
            </a>
          </div>
          <p className="muted" style={{ margin: 0 }}>
            Один файл с текстом и заданиями: студент открывает его в браузере без интернета и входа. Чтение и ответы
            сохраняются в браузере; кнопкой «Сохранить отчёт» студент получает зашифрованный подписанный файл и
            присылает его вам. Верных ответов в файле нет: ответы проверяются здесь, при загрузке отчёта. Задания,
            добавленные после скачивания, в уже разосланный файл не попадут.
          </p>
          <KioskImport textId={text.id} />
          {kiosk.reports.length > 0 && (
            <details>
              <summary>Загруженные отчёты: {kiosk.reports.length}</summary>
              <div className="table-wrap" style={{ marginTop: 12 }}>
                <table className="summary">
                  <thead>
                    <tr>
                      <th>Студент</th>
                      <th>Сохранён</th>
                      <th>Дочитано</th>
                      <th>Ответов</th>
                      <th>Копия</th>
                    </tr>
                  </thead>
                  <tbody>
                    {kiosk.reports.map((r) => (
                      <tr key={r.id}>
                        <td>{r.user.name ?? r.user.email}</td>
                        <td>{formatDateTime(r.savedAt)}</td>
                        <td>{r.readCount}</td>
                        <td>{r.answerCount}</td>
                        <td className="muted">{r.instanceId.slice(0, 6)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="muted small">
                «Копия» — браузер, в котором читал студент. Разные копии у одного студента — чтение на разных
                устройствах: засчитывается лучшее по каждому абзацу.
              </p>
            </details>
          )}
        </section>
      )}

      {summary && (
        <section className="card stack">
          <h2 style={{ margin: 0 }}>Чтение</h2>
          {summary.rows.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>
              В курсе пока нет студентов.
            </p>
          ) : (
            <div className="table-wrap">
              <table className="summary">
                <thead>
                  <tr>
                    <th>Студент</th>
                    <th>Открыл</th>
                    <th>Дочитано абзацев</th>
                    <th>Время в читалке</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.rows.map((r) => (
                    <tr key={r.userId}>
                      <td>{r.name ?? r.email}</td>
                      <td>{r.openedAt ? r.openedAt.toLocaleDateString("ru-RU") : "—"}</td>
                      <td>
                        {r.readCount} из {summary.bodyCount}
                      </td>
                      <td>{r.openedAt ? `${r.minutes} мин` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="muted small" style={{ margin: 0 }}>
            Абзац дочитан, когда пробыл в зоне чтения половину расчётного времени. Время в оценку не идёт.
          </p>
        </section>
      )}

      <section className="card">
        <h2 style={{ marginTop: 0 }}>Настройки</h2>
        <SettingsForm
          textId={text.id}
          title={text.title}
          wordsPerMinute={text.wordsPerMinute}
          displayMode={text.displayMode}
          deadline={text.deadline ? dateToLocalInput(text.deadline) : ""}
          timeZoneLabel={appTimeZone()}
        />
      </section>

      {text.status === "READY" && (
        <section className="card stack" id="tasks">
          <h2 style={{ margin: 0 }}>Спрятанные задания</h2>
          <p className="muted" style={{ margin: 0 }}>
            Задание открывается студенту, когда он дочитает нужный абзац. Задания дают до 8 баллов за текст, поровну:
            {tasks.length > 0
              ? ` сейчас по ${Math.round((8 / tasks.length) * 100) / 100} за каждое.`
              : " добавьте хотя бы одно."}
          </p>
          <TeacherTaskList textId={text.id} tasks={tasks} />
          <details>
            <summary>Новое задание</summary>
            <div style={{ marginTop: 12 }}>
              <TaskForm textId={text.id} paragraphs={paragraphs} sections={sections} pageCount={text.pageCount} />
            </div>
          </details>
        </section>
      )}

      {text.status === "READY" && (
        <section className="stack">
          <div className="row">
            <h2 style={{ margin: 0 }}>Разбивка на абзацы</h2>
            <span className="spacer" />
            {!published && <ReparseButton textId={text.id} label="Разобрать заново" />}
          </div>
          <p className="muted" style={{ margin: 0 }}>
            {published && <b>Текст опубликован, разбивку править нельзя. </b>}
            Проверьте, что каждый абзац — отдельный фрагмент. Абзац, разорванный страницей или колонкой, склейте; два
            абзаца в одном фрагменте разрежьте кнопкой ✂ между предложениями. Колонтитулы, номера страниц и сноски
            исключены автоматически: на них не попадут задания.
          </p>
          <FragmentList textId={text.id} fragments={fragments} locked={published} />
        </section>
      )}
    </main>
  );
}
