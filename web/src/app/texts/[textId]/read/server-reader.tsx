"use client";

import { useState } from "react";
import { submitAnswerAction } from "./actions";
import { Reader, type ReaderBackend } from "./reader";

// Читалка в приложении: отчитывается серверу. Сама Reader от сервера не
// зависит, чтобы её можно было собрать в офлайн-читалку.
export function serverBackend(textId: string): ReaderBackend {
  const url = `/texts/${textId}/dwell`;
  return {
    pdf: () => ({ url: `/texts/${textId}/pdf` }),
    beat: async (claims, beacon) => {
      const payload = JSON.stringify({ claims });
      if (beacon && navigator.sendBeacon) {
        navigator.sendBeacon(url, new Blob([payload], { type: "text/plain" }));
        return null;
      }
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
        keepalive: true,
      });
      return res.ok ? res.json() : null;
    },
    submit: (taskId, value) => submitAnswerAction(textId, taskId, value),
  };
}

export function ServerReader(props: Omit<Parameters<typeof Reader>[0], "backend">) {
  const [backend] = useState(() => serverBackend(props.data.textId));
  return <Reader {...props} backend={backend} />;
}
