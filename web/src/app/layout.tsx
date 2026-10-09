import type { Metadata } from "next";
import Link from "next/link";
import { LogoMark } from "@/components/logo";
import { getCurrentUser } from "@/lib/session";
import { logoutAction } from "./actions";
// Inter из npm, а не из Google Fonts: сборка и работа не зависят от доступа к Google.
import "@fontsource-variable/inter";
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
              <LogoMark />
              Поля
            </Link>
            {user && (
              <form action={logoutAction} className="row">
                <span className="nav-label">{user.name ?? user.email}</span>
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
