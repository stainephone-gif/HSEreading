import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { safeNextPath } from "@/lib/tokens";
import { LoginForm } from "./login-form";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const next = safeNextPath((await searchParams).next);
  if (await getCurrentUser()) redirect(next ?? "/");

  return (
    <main className="card stack">
      <h1 style={{ margin: 0 }}>Вход</h1>
      <p className="muted" style={{ margin: 0 }}>
        Пароль не нужен: пришлём на почту одноразовую ссылку.
      </p>
      <LoginForm next={next} />
    </main>
  );
}
