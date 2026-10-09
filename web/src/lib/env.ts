import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  APP_URL: z.string().url().default("http://localhost:3000"),
  // Адреса через запятую: эти пользователи могут создавать курсы.
  TEACHER_EMAILS: z.string().default(""),
  SMTP_URL: z.string().optional(),
  MAIL_FROM: z.string().default("Поля <no-reply@localhost>"),
});

type Env = z.infer<typeof schema>;
let cached: Env | null = null;

// Проверка при первом обращении, а не при импорте: при сборке (в том числе в
// Docker) переменных окружения ещё нет, они появляются при запуске.
export function env(): Env {
  cached ??= schema.parse(process.env);
  return cached;
}

// Абсолютный адрес страницы сайта. Не из request.url: за прокси (Caddy, Docker)
// там внутренний адрес вроде 0.0.0.0:3000.
export function appUrl(path: string): URL {
  return new URL(path, env().APP_URL);
}

export function teacherEmails(): Set<string> {
  return new Set(
    env()
      .TEACHER_EMAILS.split(",")
      .map((e) => normalizeEmail(e))
      .filter(Boolean),
  );
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
