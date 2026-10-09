import nodemailer from "nodemailer";
import { env } from "./env";

export async function sendMail(to: string, subject: string, text: string): Promise<void> {
  if (!env.SMTP_URL) {
    // Без SMTP (разработка, тесты) письмо выводится в лог сервера.
    console.info(`[mail] to=${to} subject=${subject}\n${text}`);
    return;
  }
  const transport = nodemailer.createTransport(env.SMTP_URL);
  await transport.sendMail({ from: env.MAIL_FROM, to, subject, text });
}
