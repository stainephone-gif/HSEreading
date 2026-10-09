import Link from "next/link";
import { verifyLoginAction } from "./actions";

// Вход подтверждается кнопкой, а не самим открытием ссылки: почтовые
// сканеры открывают ссылки из писем и иначе сжигали бы токен.
export default async function VerifyPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; error?: string }>;
}) {
  const { token, error } = await searchParams;

  if (error || !token) {
    return (
      <main className="card stack">
        <h1 style={{ margin: 0 }}>Ссылка не сработала</h1>
        <p style={{ margin: 0 }}>Она устарела или уже использована.</p>
        <p style={{ margin: 0 }}>
          <Link href="/login">Запросить новую ссылку</Link>
        </p>
      </main>
    );
  }

  return (
    <main className="card stack">
      <h1 style={{ margin: 0 }}>Вход в «Поля»</h1>
      <form action={verifyLoginAction}>
        <input type="hidden" name="token" value={token} />
        <button type="submit">Войти</button>
      </form>
    </main>
  );
}
