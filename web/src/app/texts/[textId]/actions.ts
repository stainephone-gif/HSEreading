"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { mergeWithNext, reparseText, setFragmentKind, splitAtSentence, updateTextSettings, UploadError } from "@/lib/texts";

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

export async function reparseAction(textId: string) {
  return run(textId, (userId) => reparseText(textId, userId));
}

export async function settingsAction(textId: string, _prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return run(textId, (userId) =>
    updateTextSettings(textId, userId, {
      title: String(formData.get("title") ?? ""),
      wordsPerMinute: Number(formData.get("wordsPerMinute")),
      displayMode: String(formData.get("displayMode") ?? "PDF"),
    }),
  );
}
