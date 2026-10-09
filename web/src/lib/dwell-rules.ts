// Правила учёта дочитывания без обращения к базе: общие для сервера и
// офлайн-читалки (киоска).

import { unlockSeconds } from "./fragments";

// Читалка отчитывается раз в BEAT_INTERVAL_MS. За один отчёт засчитывается не
// больше, чем прошло по часам с прошлого отчёта (с небольшим допуском), и не
// больше MAX_CREDIT_MS: долгий перерыв не превращается в чтение.
export const BEAT_INTERVAL_MS = 5_000;
export const MAX_CREDIT_MS = 15_000;
export const TOLERANCE_MS = 1_000;

export function thresholdMs(wordCount: number, wordsPerMinute: number): number {
  return Math.max(1, unlockSeconds(wordCount, wordsPerMinute)) * 1000;
}

export function creditAllowance(elapsedMs: number): number {
  return Math.min(Math.max(0, elapsedMs) + TOLERANCE_MS, MAX_CREDIT_MS);
}

export function creditFor(claim: unknown, allowance: number): number {
  return Math.min(Math.max(Math.round(Number(claim) || 0), 0), allowance);
}
