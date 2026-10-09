"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createCourse, updateUserName } from "@/lib/courses";
import { clearSession, requireUser } from "@/lib/session";

export async function logoutAction() {
  await clearSession();
  redirect("/login");
}

export async function createCourseAction(formData: FormData) {
  const user = await requireUser();
  const course = await createCourse(user.id, String(formData.get("title") ?? ""));
  redirect(`/courses/${course.id}`);
}

export async function updateNameAction(formData: FormData) {
  const user = await requireUser();
  await updateUserName(user.id, String(formData.get("name") ?? ""));
  revalidatePath("/", "layout");
}
