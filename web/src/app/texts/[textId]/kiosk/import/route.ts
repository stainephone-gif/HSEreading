import { NextResponse, type NextRequest } from "next/server";
import { AccessError } from "@/lib/courses";
import { importKioskReports } from "@/lib/kiosk";
import { getCurrentUser } from "@/lib/session";

const MAX_FILES = 200;

// Отчёты офлайн-читалки. Обработчик маршрута, а не server action: у server
// actions предел тела 1 МБ, а отчётов за раз бывает много.
export async function POST(request: NextRequest, { params }: { params: Promise<{ textId: string }> }) {
  const { textId } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Войдите заново." }, { status: 401 });

  const form = await request.formData().catch(() => null);
  const files = (form?.getAll("files") ?? []).filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length === 0) return NextResponse.json({ error: "Выберите файлы отчётов." }, { status: 400 });
  if (files.length > MAX_FILES) {
    return NextResponse.json({ error: `Не больше ${MAX_FILES} файлов за раз.` }, { status: 400 });
  }

  try {
    const results = await importKioskReports(
      textId,
      user.id,
      await Promise.all(files.map(async (f) => ({ name: f.name, content: await f.text() }))),
    );
    return NextResponse.json({ results });
  } catch (err) {
    if (err instanceof AccessError) return NextResponse.json({ error: err.message }, { status: 403 });
    throw err;
  }
}
