// Клиент сервиса разбора PDF (pdf-service/).

export type FragmentLine = { page: number; bbox: [number, number, number, number]; start: number; end: number };
export type Sentence = [number, number];

export type ExtractedFragment = {
  kind: "body" | "heading" | "excluded";
  text: string;
  language: string;
  words: number;
  lines: FragmentLine[];
  sentences: Sentence[];
  excludeReason?: string;
};

export type ExtractResult = {
  pageCount: number;
  pages: { width: number; height: number }[];
  language: string;
  fragments: ExtractedFragment[];
};

// Ошибка, которую стоит показать преподавателю как есть (нет текстового слоя и т. п.).
export class ExtractFailure extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export async function extractPdf(bytes: Uint8Array, fileName: string): Promise<ExtractResult> {
  const url = process.env.PDF_SERVICE_URL ?? "http://localhost:8000";
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(bytes)], { type: "application/pdf" }), fileName);

  let res: Response;
  try {
    res = await fetch(`${url}/extract`, { method: "POST", body: form, signal: AbortSignal.timeout(120_000) });
  } catch (err) {
    console.error("[pdf-service] недоступен", err);
    throw new ExtractFailure("unavailable", "Сервис разбора PDF недоступен. Попробуйте позже.");
  }
  if (res.ok) return (await res.json()) as ExtractResult;

  const body = await res.json().catch(() => null);
  const detail = body?.detail;
  if (detail?.code && detail?.message) throw new ExtractFailure(detail.code, detail.message);
  throw new ExtractFailure("unknown", `Сервис разбора PDF ответил ошибкой ${res.status}.`);
}
