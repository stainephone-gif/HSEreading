import { type NextRequest } from "next/server";
import { AccessError } from "@/lib/courses";
import { getTextResults, resultsToCsv } from "@/lib/results";
import { getCurrentUser } from "@/lib/session";
import { UploadError } from "@/lib/texts";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ textId: string }> }) {
  const { textId } = await params;
  const user = await getCurrentUser();
  if (!user) return new Response("Not found", { status: 404 });
  try {
    const csv = resultsToCsv(await getTextResults(textId, user.id));
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="results-${textId}.csv"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    if (err instanceof AccessError || err instanceof UploadError) return new Response("Not found", { status: 404 });
    throw err;
  }
}
