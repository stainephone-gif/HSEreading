import Link from "next/link";
import { notFound } from "next/navigation";
import { getCourseForMember } from "@/lib/courses";
import { env } from "@/lib/env";
import { requireUser } from "@/lib/session";
import { listTexts } from "@/lib/texts";
import { regenerateInviteAction } from "./actions";

export default async function CoursePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser(`/courses/${id}`);
  const data = await getCourseForMember(id, user.id);
  if (!data) notFound();
  const { course, membership } = data;
  const isTeacher = membership.role === "TEACHER";
  const invite = course.invites[0];
  const texts = await listTexts(course.id, user.id);

  return (
    <main className="stack">
      <h1 style={{ margin: 0 }}>{course.title}</h1>

      <section className="card stack">
        <h2 style={{ margin: 0 }}>Тексты</h2>
        {texts.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            {isTeacher ? "Текстов пока нет." : "Тексты появятся здесь, когда преподаватель их опубликует."}
          </p>
        ) : !isTeacher ? (
          <ul className="plain">
            {texts.map((t) => (
              <li key={t.id}>
                <Link href={`/texts/${t.id}/read`}>{t.title}</Link>
              </li>
            ))}
          </ul>
        ) : (
          <ul className="plain">
            {texts.map((t) => (
              <li key={t.id}>
                <Link href={`/texts/${t.id}`}>{t.title}</Link>{" "}
                <span className="muted">
                  ·{" "}
                  {t.status === "READY"
                    ? `абзацев: ${t._count.fragments} · ${t.publishedAt ? "опубликован" : "черновик"}`
                    : t.status === "FAILED"
                      ? "ошибка разбора"
                      : "разбирается"}
                </span>
              </li>
            ))}
          </ul>
        )}
        {isTeacher && (
          <div>
            <Link href={`/courses/${course.id}/texts/new`}>+ Загрузить PDF</Link>
          </div>
        )}
      </section>

      {isTeacher && (
        <section className="card stack">
          <h2 style={{ margin: 0 }}>Приглашение студентов</h2>
          {invite ? (
            <>
              <p style={{ margin: 0 }}>Отправьте студентам ссылку. По ней они войдут и попадут в курс.</p>
              <code className="invite">
                {env.APP_URL}/invite/{invite.code}
              </code>
            </>
          ) : (
            <p className="muted" style={{ margin: 0 }}>
              Действующей ссылки нет.
            </p>
          )}
          <form action={regenerateInviteAction}>
            <input type="hidden" name="courseId" value={course.id} />
            <button type="submit" className="secondary">
              {invite ? "Заменить ссылку (старая перестанет работать)" : "Создать ссылку"}
            </button>
          </form>
        </section>
      )}

      {isTeacher && (
        <section className="card">
          <h2 style={{ marginTop: 0 }}>Участники ({course.members.length})</h2>
          <ul className="plain">
            {course.members.map((m) => (
              <li key={m.userId}>
                {m.user.name ?? <span className="muted">без имени</span>}{" "}
                <span className="muted">
                  · {m.user.email} · {m.role === "TEACHER" ? "преподаватель" : "студент"}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
