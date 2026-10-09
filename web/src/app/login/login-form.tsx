"use client";

import { useActionState } from "react";
import { requestLoginAction, type LoginState } from "./actions";

export function LoginForm({ next }: { next: string | null }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(requestLoginAction, { status: "idle" });

  if (state.status === "sent") {
    return (
      <p>
        Ссылка для входа отправлена на <b>{state.email}</b>. Она действует 15 минут.
      </p>
    );
  }

  return (
    <form action={action} className="stack">
      {next && <input type="hidden" name="next" value={next} />}
      <div className="row">
        <input type="email" name="email" placeholder="Почта" required autoComplete="email" defaultValue={state.email} />
        <button type="submit" disabled={pending}>
          {pending ? "Отправляем…" : "Получить ссылку"}
        </button>
      </div>
      {state.status === "error" && <p className="error">{state.message}</p>}
    </form>
  );
}
