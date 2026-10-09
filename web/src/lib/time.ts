// Время в часовом поясе сайта. Сервер живёт в UTC, а преподаватель вводит и
// читает дедлайн по местному времени курса.

export function appTimeZone(): string {
  return process.env.APP_TIMEZONE ?? "Europe/Moscow";
}

function zoneParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  return { y: get("year"), m: get("month"), d: get("day"), h: get("hour"), min: get("minute"), s: get("second") };
}

// Смещение пояса относительно UTC в данный момент, мс.
function offsetMs(date: Date, timeZone: string): number {
  const p = zoneParts(date, timeZone);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.min, p.s) - Math.floor(date.getTime() / 1000) * 1000;
}

// "2026-10-20T23:59" по местному времени пояса → момент в UTC.
export function localInputToDate(value: string, timeZone = appTimeZone()): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!m) return null;
  const asUtc = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  // Два шага: смещение берётся на момент, близкий к искомому (переход на летнее время).
  let guess = asUtc - offsetMs(new Date(asUtc), timeZone);
  guess = asUtc - offsetMs(new Date(guess), timeZone);
  return new Date(guess);
}

// Момент → значение для <input type="datetime-local"> в поясе сайта.
export function dateToLocalInput(date: Date, timeZone = appTimeZone()): string {
  const p = zoneParts(date, timeZone);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${p.y}-${pad(p.m)}-${pad(p.d)}T${pad(p.h)}:${pad(p.min)}`;
}

export function formatDateTime(date: Date, timeZone = appTimeZone()): string {
  return date.toLocaleString("ru-RU", { timeZone, dateStyle: "long", timeStyle: "short" });
}
