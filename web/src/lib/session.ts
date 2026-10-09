import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { deleteSession, findUserBySessionToken } from "./auth";
import { env } from "./env";

const COOKIE_NAME = "polya_session";

export async function setSessionCookie(token: string, expiresAt: Date): Promise<void> {
  (await cookies()).set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    // По HTTPS cookie защищена. Сайт по http:// (тест в локальной сети) иначе не смог бы её сохранить.
    secure: env().APP_URL.startsWith("https://"),
    path: "/",
    expires: expiresAt,
  });
}

export async function clearSession(): Promise<void> {
  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;
  if (token) await deleteSession(token);
  store.delete(COOKIE_NAME);
}

// Один запрос к базе на рендер, сколько бы компонентов ни спросили пользователя.
export const getCurrentUser = cache(async () => {
  const token = (await cookies()).get(COOKIE_NAME)?.value;
  if (!token) return null;
  return findUserBySessionToken(token);
});

export async function requireUser(next?: string) {
  const user = await getCurrentUser();
  if (!user) redirect(next ? `/login?next=${encodeURIComponent(next)}` : "/login");
  return user;
}
