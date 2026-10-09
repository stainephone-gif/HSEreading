"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ImportResult } from "@/lib/kiosk";

export function KioskImport({ textId }: { textId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<ImportResult[] | null>(null);

  const upload = async (form: HTMLFormElement) => {
    setPending(true);
    setError(null);
    setResults(null);
    try {
      const res = await fetch(`/texts/${textId}/kiosk/import`, { method: "POST", body: new FormData(form) });
      const body = (await res.json().catch(() => null)) as { error?: string; results?: ImportResult[] } | null;
      if (!res.ok || !body?.results) {
        setError(body?.error ?? "Не удалось загрузить отчёты.");
        return;
      }
      setResults(body.results);
      form.reset();
      router.refresh();
    } catch {
      setError("Не удалось загрузить отчёты. Проверьте соединение.");
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="stack" style={{ gap: 12 }}>
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          upload(e.currentTarget);
        }}
      >
        <input type="file" name="files" accept=".polya,text/plain" multiple required />
        <button type="submit" className="secondary" disabled={pending}>
          {pending ? "Загружаю…" : "Загрузить отчёты"}
        </button>
      </form>
      {error && <p className="error small">{error}</p>}
      {results && (
        <ul className="stack small" style={{ gap: 4, margin: 0, paddingLeft: 18 }}>
          {results.map((r, i) => (
            <li key={i}>
              <b>{r.student ? `${r.student.name} (${r.student.email})` : r.file}</b>
              {": "}
              {r.ok && !r.message ? (
                <>
                  дочитано абзацев: {r.readCount}, ответов: {r.answers}
                  {r.late ? <span className="error">, после дедлайна (не засчитаны): {r.late}</span> : null}
                </>
              ) : (
                <span className={r.ok ? "muted" : "error"}>{r.message}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
