"use client";

import { useState, useTransition } from "react";
import { publishAction } from "./actions";

export function PublishButton({ textId, published }: { textId: string; published: boolean }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="row">
      <button
        type="button"
        className={published ? "secondary" : undefined}
        disabled={pending}
        onClick={() => {
          if (
            published &&
            !confirm("Студенты перестанут видеть текст. Накопленное время чтения сохранится. Продолжить?")
          )
            return;
          startTransition(async () => setError((await publishAction(textId, !published)).error ?? null));
        }}
      >
        {published ? "Снять с публикации" : "Опубликовать"}
      </button>
      {error && <span className="error">{error}</span>}
    </span>
  );
}
