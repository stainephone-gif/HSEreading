"use server";

import { revalidatePath } from "next/cache";
import { regenerateInvite } from "@/lib/courses";
import { requireUser } from "@/lib/session";

export async function regenerateInviteAction(formData: FormData) {
  const user = await requireUser();
  const courseId = String(formData.get("courseId") ?? "");
  await regenerateInvite(courseId, user.id);
  revalidatePath(`/courses/${courseId}`);
}
