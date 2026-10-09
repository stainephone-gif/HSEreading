"use server";

import { requestLoginLink } from "@/lib/auth";

export type LoginState = { status: "idle" | "sent" | "error"; message?: string; email?: string };

export async function requestLoginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "");
  const next = formData.get("next");
  const result = await requestLoginLink(email, typeof next === "string" ? next : null);
  if (!result.ok) return { status: "error", message: result.error, email };
  return { status: "sent", email };
}
