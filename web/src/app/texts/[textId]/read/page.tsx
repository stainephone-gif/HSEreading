import Link from "next/link";
import { notFound } from "next/navigation";
import { getReaderData } from "@/lib/reading";
import { requireUser } from "@/lib/session";
import { Reader } from "./reader";

export default async function ReadPage({ params }: { params: Promise<{ textId: string }> }) {
  const { textId } = await params;
  const user = await requireUser(`/texts/${textId}/read`);
  const data = await getReaderData(textId, user.id);
  if (!data) notFound();

  return (
    <main className="stack">
      <p style={{ margin: 0 }}>
        <Link href={data.preview ? `/texts/${data.textId}` : `/courses/${data.courseId}`}>← Назад</Link>
      </p>
      <h1 style={{ margin: 0 }}>{data.title}</h1>
      {data.preview && (
        <p className="muted" style={{ margin: 0 }}>
          Предпросмотр: так текст увидят студенты. Рамками показаны абзацы, затемнены края экрана вне зоны чтения,
          счётчик показывает, сколько абзац пробыл в зоне. Ничего не записывается.
        </p>
      )}
      <Reader data={data} pdfUrl={`/texts/${data.textId}/pdf`} />
    </main>
  );
}
