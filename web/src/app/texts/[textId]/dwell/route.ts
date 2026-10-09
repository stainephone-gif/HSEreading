import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { recordDwell } from "@/lib/reading";
import { getCurrentUser } from "@/lib/session";

const body = z.object({ claims: z.record(z.string().max(40), z.number().finite().nonnegative()) });

// Отчёт читалки о времени фрагментов в зоне чтения. Принимает и обычный fetch,
// и navigator.sendBeacon при закрытии вкладки (он присылает text/plain).
export async function POST(request: NextRequest, { params }: { params: Promise<{ textId: string }> }) {
  const { textId } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "bad_request" }, { status: 400 });

  const result = await recordDwell(textId, user.id, parsed.data.claims);
  if (!result.ok) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  return NextResponse.json({ readIds: result.readIds });
}
