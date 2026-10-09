import { NextResponse, type NextRequest } from "next/server";
import { AccessError } from "@/lib/courses";
import { appUrl } from "@/lib/env";
import { getCurrentUser } from "@/lib/session";
import { createTextFromPdf, UploadError } from "@/lib/texts";

// Загрузка идёт через обработчик маршрута, а не server action: у server actions
// ограничение на размер тела в 1 МБ, а статьи весят больше.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: courseId } = await params;
  const back = (error: string) =>
    NextResponse.redirect(appUrl(`/courses/${courseId}/texts/new?error=${encodeURIComponent(error)}`), 303);

  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(appUrl("/login"), 303);

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File) || file.size === 0) return back("Выберите PDF-файл.");

  try {
    const text = await createTextFromPdf({
      courseId,
      userId: user.id,
      title: String(form?.get("title") ?? ""),
      fileName: file.name,
      bytes: new Uint8Array(await file.arrayBuffer()),
    });
    return NextResponse.redirect(appUrl(`/texts/${text.id}`), 303);
  } catch (err) {
    if (err instanceof UploadError || err instanceof AccessError) return back(err.message);
    throw err;
  }
}
