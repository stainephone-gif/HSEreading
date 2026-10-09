"use server";

import { redirect } from "next/navigation";
import { acceptInvite, updateUserName } from "@/lib/courses";
import { requireUser } from "@/lib/session";

export async function acceptInviteAction(formData: FormData) {
  const code = String(formData.get("code") ?? "");
  const user = await requireUser(`/invite/${code}`);
  // Имя спрашиваем при вступлении: иначе преподаватель увидит в списках только почту.
  const name = String(formData.get("name") ?? "").trim();
  if (name) await updateUserName(user.id, name);
  const course = await acceptInvite(code, user.id);
  if (!course) redirect(`/invite/${code}`);
  redirect(`/courses/${course.id}`);
}
