import { db } from "./db";
import { env, normalizeEmail, teacherEmails } from "./env";
import { sendMail } from "./mail";
import { generateToken, hashToken, safeNextPath } from "./tokens";

export const LOGIN_TOKEN_TTL_MS = 15 * 60 * 1000;
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
// Не больше стольких писем на один адрес за время жизни токена.
export const LOGIN_RATE_LIMIT = 5;

export type LoginRequestResult = { ok: true } | { ok: false; error: string };

export async function requestLoginLink(
  rawEmail: string,
  next?: string | null,
  now = new Date(),
): Promise<LoginRequestResult> {
  const email = normalizeEmail(rawEmail);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, error: "Проверьте адрес почты." };
  }

  const recent = await db.loginToken.count({
    where: { email, createdAt: { gt: new Date(now.getTime() - LOGIN_TOKEN_TTL_MS) } },
  });
  if (recent >= LOGIN_RATE_LIMIT) {
    return { ok: false, error: "Слишком много запросов. Попробуйте через 15 минут." };
  }

  const token = generateToken();
  await db.loginToken.create({
    data: {
      email,
      tokenHash: hashToken(token),
      next: safeNextPath(next),
      expiresAt: new Date(now.getTime() + LOGIN_TOKEN_TTL_MS),
    },
  });

  const link = `${env.APP_URL}/auth/verify?token=${encodeURIComponent(token)}`;
  await sendMail(
    email,
    "Вход в «Поля»",
    `Чтобы войти, откройте ссылку:\n\n${link}\n\nСсылка действует 15 минут. Если вы не запрашивали вход, просто удалите это письмо.`,
  );
  return { ok: true };
}

export type ConsumedLogin = { sessionToken: string; expiresAt: Date; next: string | null };

// Гасит одноразовый токен и создаёт сессию. Возвращает null, если токен
// неизвестен, истёк или уже использован.
export async function consumeLoginToken(token: string, now = new Date()): Promise<ConsumedLogin | null> {
  const tokenHash = hashToken(token);

  return db.$transaction(async (tx) => {
    // updateMany с условием usedAt = null защищает от двойного использования.
    const { count } = await tx.loginToken.updateMany({
      where: { tokenHash, usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    });
    if (count === 0) return null;

    const login = await tx.loginToken.findUniqueOrThrow({ where: { tokenHash } });
    const isTeacher = teacherEmails().has(login.email);
    const user = await tx.user.upsert({
      where: { email: login.email },
      create: { email: login.email, isTeacher },
      // Право создавать курсы только добавляем: снять его можно вручную в базе.
      update: isTeacher ? { isTeacher: true } : {},
    });

    const sessionToken = generateToken();
    const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
    await tx.session.create({
      data: { tokenHash: hashToken(sessionToken), userId: user.id, expiresAt },
    });
    return { sessionToken, expiresAt, next: login.next };
  });
}

export async function findUserBySessionToken(sessionToken: string, now = new Date()) {
  const session = await db.session.findUnique({
    where: { tokenHash: hashToken(sessionToken) },
    include: { user: true },
  });
  if (!session || session.expiresAt <= now) return null;
  return session.user;
}

export async function deleteSession(sessionToken: string): Promise<void> {
  await db.session.deleteMany({ where: { tokenHash: hashToken(sessionToken) } });
}
