"use client";

import { useActionState } from "react";
import { settingsAction, type ActionResult } from "./actions";

export function SettingsForm({
  textId,
  title,
  wordsPerMinute,
  displayMode,
}: {
  textId: string;
  title: string;
  wordsPerMinute: number;
  displayMode: string;
}) {
  const [state, action, pending] = useActionState<ActionResult, FormData>(settingsAction.bind(null, textId), {});
  return (
    <form action={action} className="stack">
      <label className="stack" style={{ gap: 4 }}>
        <span>Название</span>
        <input type="text" name="title" defaultValue={title} required maxLength={300} />
      </label>
      <label className="stack" style={{ gap: 4 }}>
        <span>Норма чтения, слов в минуту</span>
        <input type="number" name="wordsPerMinute" defaultValue={wordsPerMinute} min={50} max={600} required />
        <span className="muted small">
          Маркер задания откроется, когда абзац пробудет в зоне чтения половину расчётного времени.
        </span>
      </label>
      <fieldset className="stack" style={{ gap: 4 }}>
        <legend>Режим показа</legend>
        <label>
          <input type="radio" name="displayMode" value="PDF" defaultChecked={displayMode === "PDF"} /> Страницы PDF:
          оригинальная вёрстка
        </label>
        <label>
          <input type="radio" name="displayMode" value="WEB" defaultChecked={displayMode === "WEB"} /> Веб-текст: текст
          свёрстан заново, доступны фразы-вставки. Не подходит для текстов со сложными таблицами и формулами
        </label>
      </fieldset>
      <div className="row">
        <button type="submit" disabled={pending}>
          Сохранить
        </button>
        {state.error && <span className="error">{state.error}</span>}
      </div>
    </form>
  );
}
