"use server";

import { redirect } from "next/navigation";
import { acceptInvite } from "@/lib/courses";
import { requireUser } from "@/lib/session";

export async function acceptInviteAction(formData: FormData) {
  const code = String(formData.get("code") ?? "");
  const user = await requireUser(`/invite/${code}`);
  const course = await acceptInvite(code, user.id);
  if (!course) redirect(`/invite/${code}`);
  redirect(`/courses/${course.id}`);
}
