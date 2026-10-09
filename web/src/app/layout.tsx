import type { Metadata } from "next";
import Link from "next/link";
import { getCurrentUser } from "@/lib/session";
import { logoutAction } from "./actions";
import "./globals.css";

export const metadata: Metadata = {
  title: "Поля",
  description: "Совместное чтение текстов курса",
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const user = await getCurrentUser();
  return (
    <html lang="ru">
      <body>
        <div className="shell">
          <header className="topbar">
            <Link href="/" className="brand">
              Поля
            </Link>
            {user && (
              <form action={logoutAction} className="row">
                <span className="muted">{user.name ?? user.email}</span>
                <button type="submit" className="link">
                  Выйти
                </button>
              </form>
            )}
          </header>
          {children}
        </div>
      </body>
    </html>
  );
}
