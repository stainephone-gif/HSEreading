"use client";

import { useTransition } from "react";
import { reparseAction } from "./actions";

export function ReparseButton({ textId, label }: { textId: string; label: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      className="secondary"
      disabled={pending}
      onClick={() => {
        if (label.includes("заново") && !confirm("Все правки разбивки будут потеряны. Продолжить?")) return;
        startTransition(async () => {
          await reparseAction(textId);
        });
      }}
    >
      {pending ? "Разбираем…" : label}
    </button>
  );
}
