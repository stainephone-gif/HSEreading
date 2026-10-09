import Link from "next/link";
import { listCoursesForUser } from "@/lib/courses";
import { requireUser } from "@/lib/session";
import { createCourseAction, updateNameAction } from "./actions";

export default async function Home() {
  const user = await requireUser();
  const memberships = await listCoursesForUser(user.id);

  return (
    <main className="stack">
      {!user.name && (
        <section className="card stack">
          <h2 style={{ margin: 0 }}>Как вас зовут?</h2>
          <p className="muted" style={{ margin: 0 }}>
            Имя и фамилию увидит преподаватель в списке курса.
          </p>
          <form action={updateNameAction} className="row">
            <input type="text" name="name" placeholder="Имя Фамилия" required maxLength={120} />
            <button type="submit">Сохранить</button>
          </form>
        </section>
      )}

      <section className="card">
        <h2 style={{ marginTop: 0 }}>Мои курсы</h2>
        {memberships.length === 0 ? (
          <p className="muted">
            {user.isTeacher
              ? "Курсов пока нет. Создайте первый ниже."
              : "Вы ещё не записаны ни на один курс. Откройте ссылку-приглашение от преподавателя."}
          </p>
        ) : (
          <ul className="plain">
            {memberships.map(({ course, role }) => (
              <li key={course.id}>
                <Link href={`/courses/${course.id}`}>{course.title}</Link>{" "}
                <span className="muted">
                  · {role === "TEACHER" ? "преподаватель" : "студент"} · участников: {course._count.members}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {user.isTeacher && (
        <section className="card stack">
          <h2 style={{ margin: 0 }}>Новый курс</h2>
          <form action={createCourseAction} className="row">
            <input type="text" name="title" placeholder="Название курса" required maxLength={200} />
            <button type="submit">Создать</button>
          </form>
        </section>
      )}
    </main>
  );
}
