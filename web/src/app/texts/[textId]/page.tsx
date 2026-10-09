import Link from "next/link";
import { notFound } from "next/navigation";
import { unlockSeconds } from "@/lib/fragments";
import type { FragmentLine } from "@/lib/pdf-service";
import { getReadingSummary } from "@/lib/reading";
import { requireUser } from "@/lib/session";
import { getTextForTeacher } from "@/lib/texts";
import { FragmentList, type FragmentView } from "./fragment-list";
import { PublishButton } from "./publish-button";
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
        />
      </section>

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
