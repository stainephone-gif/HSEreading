import Link from "next/link";
import { notFound } from "next/navigation";
import { getCourseForMember } from "@/lib/courses";
import { requireUser } from "@/lib/session";

export default async function NewTextPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { id } = await params;
  const { error } = await searchParams;
  const user = await requireUser(`/courses/${id}/texts/new`);
  const data = await getCourseForMember(id, user.id);
  if (!data || data.membership.role !== "TEACHER") notFound();

  return (
    <main className="stack">
      <p style={{ margin: 0 }}>
        <Link href={`/courses/${id}`}>← {data.course.title}</Link>
      </p>
      <section className="card stack">
        <h1 style={{ margin: 0 }}>Новый текст</h1>
        <p className="muted" style={{ margin: 0 }}>
          PDF должен содержать текстовый слой: сканы страниц картинками пока не поддерживаются. После загрузки сервис
          разделит текст на абзацы, и вы сможете поправить разбивку.
        </p>
        <form action={`/courses/${id}/texts/upload`} method="post" encType="multipart/form-data" className="stack">
          <input type="text" name="title" placeholder="Название (по умолчанию из имени файла)" maxLength={300} />
          <input type="file" name="file" accept="application/pdf,.pdf" required />
          <div>
            <button type="submit">Загрузить и разобрать</button>
          </div>
        </form>
        {error && <p className="error">{error}</p>}
      </section>
    </main>
  );
}
