// Сеанс офлайн-читалки: состояние студента, его хранение в браузере и отчёт.
// Состояние меняется на месте (отчёты читалки идут каждую секунду), поэтому
// живёт в объекте вне React; интерфейс подписывается на изменения.

import { fromBase64, type KioskKeys, openLocal, parseReportFile, sealLocal, sealReport } from "@/lib/kiosk-crypto";
import {
  applyBeat,
  fillPlacements,
  type KioskData,
  type KioskState,
  type KioskStudent,
  newState,
  readIds,
  studentTasks,
  submitAnswer,
} from "@/lib/kiosk-engine";
import type { ReaderData, StudentTasks } from "@/lib/reader-types";

// Имя файла отчёта только латиницей: с кириллицей и даже с тире часть
// браузеров сохраняет файл под именем «download».
const TRANSLIT: Record<string, string> = Object.fromEntries(
  "а:a б:b в:v г:g д:d е:e ё:e ж:zh з:z и:i й:i к:k л:l м:m н:n о:o п:p р:r с:s т:t у:u ф:f х:kh ц:ts ч:ch ш:sh щ:shch ъ: ы:y ь: э:e ю:iu я:ia"
    .split(" ")
    .map((pair) => pair.split(":")),
);

export function latinSlug(text: string, max = 60): string {
  return [...text.toLowerCase()]
    .map((c) => TRANSLIT[c] ?? c)
    .join("")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, max)
    .replace(/-$/, "");
}

export function reportFileName(name: string, at: Date): string {
  const latin = latinSlug(name);
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}-${pad(at.getHours())}${pad(at.getMinutes())}`;
  return `polya-${latin || "report"}-${stamp}.polya`;
}

// Когда студент последний раз сохранял отчёт: в отчёт не уходит, только для подсказки.
type Stored = KioskState & { reportedAt?: number };

export class KioskStore {
  private key: string;

  constructor(
    readonly data: KioskData,
    readonly keys: KioskKeys,
  ) {
    this.key = `polya-kiosk:${data.exportId}`;
  }

  private parse(json: string | null): Stored | null {
    if (!json) return null;
    try {
      const state = JSON.parse(json) as Stored;
      if (state?.exportId !== this.data.exportId) return null;
      fillPlacements(state, this.data);
      return state;
    } catch {
      return null;
    }
  }

  load(): KioskSession | null {
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(this.key);
    } catch {
      // Хранилище недоступно: начинаем заново.
    }
    const state = this.parse(raw ? openLocal(this.keys.local, raw) : null);
    return state ? new KioskSession(this, state) : null;
  }

  start(student: KioskStudent): KioskSession {
    const session = new KioskSession(this, newState(this.data, student, Date.now()));
    session.persist();
    return session;
  }

  // Восстановление из файла отчёта: в нём лежит локальная копия прогресса.
  async restore(file: File): Promise<KioskSession | string> {
    const parsed = parseReportFile(await file.text());
    if (!parsed) return "Это не файл отчёта.";
    if (parsed.exportId !== this.data.exportId) return "Этот отчёт сохранён в другой читалке.";
    const state = this.parse(openLocal(this.keys.local, parsed.local));
    if (!state) return "Файл отчёта повреждён.";
    state.reportedAt = state.savedAt;
    const session = new KioskSession(this, state);
    session.persist();
    return session;
  }

  save(state: Stored): boolean {
    try {
      localStorage.setItem(this.key, sealLocal(this.keys.local, JSON.stringify(state)));
      return true;
    } catch {
      return false;
    }
  }

  clear() {
    try {
      localStorage.removeItem(this.key);
    } catch {
      // Хранилище недоступно: и так ничего не сохранено.
    }
  }
}

let sessions = 0;

export class KioskSession {
  // Новый сеанс (восстановление из отчёта) — новая читалка.
  readonly id = ++sessions;
  private lastBeat: number | null = null;
  private listeners = new Set<() => void>();
  // Сохраняет ли браузер прогресс (в частном режиме может не сохранять).
  storageOk = true;
  // Растёт при каждом изменении: снимок для useSyncExternalStore.
  version = 0;

  constructor(
    private store: KioskStore,
    private state: Stored,
  ) {}

  get student() {
    return this.state.student;
  }

  get reportedAt(): number | null {
    return this.state.reportedAt ?? null;
  }

  // Есть прогресс, которого нет в последнем сохранённом отчёте.
  get dirty(): boolean {
    return !this.state.reportedAt || this.state.savedAt > this.state.reportedAt;
  }

  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  persist() {
    this.storageOk = this.store.save(this.state);
    this.version++;
    this.listeners.forEach((l) => l());
  }

  tasks(): StudentTasks {
    return studentTasks(this.state, this.store.data, Date.now());
  }

  // Начальные данные читалки; дальше она живёт отчётами beat и submit.
  readerData(): ReaderData {
    const data = this.store.data;
    return {
      textId: data.textId,
      courseId: "",
      title: data.title,
      displayMode: data.displayMode,
      language: data.language,
      blocks: data.blocks,
      pages: data.pages,
      fragments: data.fragments,
      preview: false,
      dwellMs: { ...this.state.dwell },
      readIds: readIds(this.state),
      tasks: this.tasks(),
      previewTasks: [],
      taskFragments: data.tasks
        .map((t) => t.fragmentId ?? this.state.placements[t.id])
        .filter((id): id is string => Boolean(id)),
    };
  }

  // Время между отчётами — по монотонным часам страницы: перевод системных
  // часов не добавит чтения.
  beat(claims: Record<string, number>) {
    const now = performance.now();
    const elapsed = this.lastBeat === null ? 0 : now - this.lastBeat;
    this.lastBeat = now;
    const before = this.state.activeMs;
    applyBeat(this.state, this.store.data, claims, elapsed, Date.now());
    if (this.state.activeMs !== before) this.persist();
    return { readIds: readIds(this.state), tasks: this.tasks() };
  }

  submit(taskId: string, value: unknown): { error?: string; tasks?: StudentTasks } {
    const error = submitAnswer(this.state, this.store.data, taskId, value, Date.now());
    if (error) return { error };
    this.persist();
    return { tasks: this.tasks() };
  }

  // Файл отчёта для преподавателя.
  report(): string {
    const at = Date.now();
    this.state.savedAt = Math.max(this.state.savedAt, at);
    const { reportedAt, ...report } = this.state;
    void reportedAt;
    const payload = JSON.stringify(report);
    const file = sealReport({
      exportId: this.store.data.exportId,
      publicKey: fromBase64(this.store.data.publicKey),
      keys: this.store.keys,
      payload,
      localCopy: payload,
    });
    this.state.reportedAt = this.state.savedAt;
    this.persist();
    return file;
  }
}
