// Правила проверки ответов без обращения к базе: ими пользуются и сервер, и
// офлайн-читалка (киоск).

import type { Sentence } from "./pdf-service";

export const MAX_SHORT_ANSWER = 1000;

// Засчитывается выделение, которое пересекается с эталоном больше чем наполовину.
export function selectionMatches(selected: Sentence, reference: Sentence): boolean {
  const overlap = Math.min(selected[1], reference[1]) - Math.max(selected[0], reference[0]);
  const longest = Math.max(selected[1] - selected[0], reference[1] - reference[0]);
  return overlap > 0 && overlap * 2 > longest;
}

export function countSentences(text: string): number {
  return text.split(/[.!?…]+(?:["»”)]*)(?:\s+|$)/).filter((s) => s.trim()).length;
}

// Ошибка в коротком ответе (уже обрезанном по краям) или null.
export function shortAnswerError(text: string): string | null {
  if (!text) return "Напишите ответ.";
  if (text.length > MAX_SHORT_ANSWER) return `Ответ длиннее ${MAX_SHORT_ANSWER} знаков.`;
  if (countSentences(text) > 3) return "Ответ должен уложиться в три предложения.";
  return null;
}
