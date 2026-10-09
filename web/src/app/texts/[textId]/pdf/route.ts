import { type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { getTextPdfForMember } from "@/lib/texts";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ textId: string }> }) {
  const { textId } = await params;
  const user = await getCurrentUser();
  const pdf = user ? await getTextPdfForMember(textId, user.id) : null;
  if (!pdf) return new Response("Not found", { status: 404 });

  return new Response(new Uint8Array(pdf.data), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(pdf.name)}`,
      "Cache-Control": "private, no-store",
    },
  });
}
