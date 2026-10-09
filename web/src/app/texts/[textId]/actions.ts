"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { createTask, deleteTask, gradeAnswer } from "@/lib/tasks";
import {
  mergeWithNext,
  reparseText,
  setFragmentKind,
  setPublished,
  splitAtSentence,
  updateTextSettings,
  UploadError,
} from "@/lib/texts";

export type ActionResult = { error?: string };

async function run(textId: string, fn: (userId: string) => Promise<void>): Promise<ActionResult> {
  const user = await requireUser();
  try {
    await fn(user.id);
  } catch (err) {
    if (err instanceof UploadError) return { error: err.message };
    throw err;
  }
  revalidatePath(`/texts/${textId}`);
  return {};
}

export async function mergeAction(textId: string, fragmentId: string) {
  return run(textId, (userId) => mergeWithNext(fragmentId, userId));
}

export async function splitAction(textId: string, fragmentId: string, sentenceIndex: number) {
  return run(textId, (userId) => splitAtSentence(fragmentId, userId, sentenceIndex));
}

export async function setKindAction(textId: string, fragmentId: string, kind: string) {
  return run(textId, (userId) => setFragmentKind(fragmentId, userId, kind));
}

export async function createTaskAction(textId: string, input: unknown) {
  return run(textId, async (userId) => {
    await createTask(textId, userId, input);
  });
}

export async function deleteTaskAction(textId: string, taskId: string) {
  return run(textId, (userId) => deleteTask(taskId, userId));
}

export async function gradeAction(textId: string, taskId: string, studentId: string, grade: "PASS" | "FAIL" | null) {
  return run(textId, (userId) => gradeAnswer(taskId, studentId, userId, grade));
}

export async function publishAction(textId: string, published: boolean) {
  return run(textId, (userId) => setPublished(textId, userId, published));
}

export async function reparseAction(textId: string) {
  return run(textId, (userId) => reparseText(textId, userId));
}

export async function settingsAction(textId: string, _prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return run(textId, (userId) =>
    updateTextSettings(textId, userId, {
      title: String(formData.get("title") ?? ""),
      wordsPerMinute: Number(formData.get("wordsPerMinute")),
      displayMode: String(formData.get("displayMode") ?? "PDF"),
      deadline: String(formData.get("deadline") ?? ""),
    }),
  );
}
