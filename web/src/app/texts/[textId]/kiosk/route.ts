import { type NextRequest } from "next/server";
import { AccessError } from "@/lib/courses";
import { createKioskExport, kioskFileName, loadKioskBundle, renderKioskHtml } from "@/lib/kiosk";
import { getCurrentUser } from "@/lib/session";
import { UploadError } from "@/lib/texts";

// Офлайн-читалка: один HTML-файл с текстом и заданиями. Каждое скачивание —
// новая выгрузка со своими ключами.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ textId: string }> }) {
  const { textId } = await params;
  const user = await getCurrentUser();
  if (!user) return new Response("Not found", { status: 404 });
  try {
    const bundle = await loadKioskBundle();
    const { data, pdf } = await createKioskExport(textId, user.id);
    return new Response(renderKioskHtml({ data, pdf, ...bundle }), {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(kioskFileName(data.title))}`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    if (err instanceof AccessError) return new Response("Not found", { status: 404 });
    if (err instanceof UploadError) return new Response(err.message, { status: 409 });
    throw err;
  }
}
