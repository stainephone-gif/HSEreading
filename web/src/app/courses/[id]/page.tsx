import { notFound } from "next/navigation";
import { getCourseForMember } from "@/lib/courses";
import { env } from "@/lib/env";
import { requireUser } from "@/lib/session";
import { regenerateInviteAction } from "./actions";

export default async function CoursePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser(`/courses/${id}`);
  const data = await getCourseForMember(id, user.id);
  if (!data) notFound();
  const { course, membership } = data;
  const isTeacher = membership.role === "TEACHER";
  const invite = course.invites[0];

  return (
    <main className="stack">
      <h1 style={{ margin: 0 }}>{course.title}</h1>

      <section className="card">
        <h2 style={{ marginTop: 0 }}>Тексты</h2>
        <p className="muted">Загрузка текстов появится на следующем этапе.</p>
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
