import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  APP_URL: z.string().url().default("http://localhost:3000"),
  // Адреса через запятую: эти пользователи могут создавать курсы.
  TEACHER_EMAILS: z.string().default(""),
  SMTP_URL: z.string().optional(),
  MAIL_FROM: z.string().default("Поля <no-reply@localhost>"),
});

export const env = schema.parse(process.env);

export function teacherEmails(): Set<string> {
  return new Set(
    env.TEACHER_EMAILS.split(",")
      .map((e) => normalizeEmail(e))
      .filter(Boolean),
  );
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
