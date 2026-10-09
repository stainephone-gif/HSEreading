"use server";

import { requireUser } from "@/lib/session";
import { getStudentTasks, submitAnswer, type StudentTasks } from "@/lib/tasks";
import { UploadError } from "@/lib/texts";

export async function submitAnswerAction(
  textId: string,
  taskId: string,
  value: unknown,
): Promise<{ error?: string; tasks?: StudentTasks }> {
  const user = await requireUser();
  try {
    await submitAnswer(taskId, user.id, value);
  } catch (err) {
    if (err instanceof UploadError) return { error: err.message };
    throw err;
  }
  return { tasks: await getStudentTasks(textId, user.id) };
}
