"use server";

import { redirect } from "next/navigation";
import { consumeLoginToken } from "@/lib/auth";
import { setSessionCookie } from "@/lib/session";

export async function verifyLoginAction(formData: FormData) {
  const token = String(formData.get("token") ?? "");
  const login = token ? await consumeLoginToken(token) : null;
  if (!login) redirect("/auth/verify?error=1");
  await setSessionCookie(login.sessionToken, login.expiresAt);
  redirect(login.next ?? "/");
}
