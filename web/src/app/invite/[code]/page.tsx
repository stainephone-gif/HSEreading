import { redirect } from "next/navigation";
import { findActiveInvite, getMembership } from "@/lib/courses";
import { requireUser } from "@/lib/session";
import { acceptInviteAction } from "./actions";

export default async function InvitePage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const user = await requireUser(`/invite/${code}`);
  const invite = await findActiveInvite(code);

  if (!invite) {
    return (
      <main className="card">
        <h1 style={{ marginTop: 0 }}>Приглашение недействительно</h1>
        <p>Попросите у преподавателя новую ссылку.</p>
      </main>
    );
  }

  if (await getMembership(invite.courseId, user.id)) redirect(`/courses/${invite.courseId}`);

  return (
    <main className="card stack">
      <h1 style={{ margin: 0 }}>Курс «{invite.course.title}»</h1>
      <p style={{ margin: 0 }}>
        Вы входите как <b>{user.email}</b>.
      </p>
      <form action={acceptInviteAction}>
        <input type="hidden" name="code" value={code} />
        <button type="submit">Присоединиться к курсу</button>
      </form>
    </main>
  );
}
