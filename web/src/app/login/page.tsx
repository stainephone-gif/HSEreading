import { redirect } from "next/navigation";
import { Constellation } from "@/components/constellation";
import { devLoginLinks, teacherEmails } from "@/lib/env";
import { getCurrentUser } from "@/lib/session";
import { safeNextPath } from "@/lib/tokens";
import { LoginForm } from "./login-form";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const next = safeNextPath((await searchParams).next);
  if (await getCurrentUser()) redirect(next ?? "/");

  return (
    <main className="login">
      <div className="stack" style={{ gap: 24 }}>
        <span className="eyebrow">Совместное чтение</span>
        <h1>Читать, чтобы найти.</h1>
        <p className="muted" style={{ margin: 0, maxWidth: 480 }}>
          Задания спрятаны в тексте и открываются по ходу чтения. Пароль не нужен: пришлём на почту одноразовую ссылку
          для входа.
        </p>
        {devLoginLinks() && (
          <p className="small" style={{ margin: 0 }}>
            <span className="eyebrow">Тестовый режим</span>
            <br />
            Преподаватель: {[...teacherEmails()].join(", ") || "не задан"}. Любая другая почта — студент. Письма не
            нужны: ссылка для входа появится здесь.
          </p>
        )}
        <LoginForm next={next} />
      </div>
      <Constellation className="constellation" />
    </main>
  );
}
