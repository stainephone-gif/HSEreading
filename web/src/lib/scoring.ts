// Оценка за текст по концепции: задания дают до 8 баллов поровну, засчитываются
// только принятые ответы. Пасхалки (до 2 баллов) добавятся вместе с ними.
export const TASK_POINTS = 8;

export function taskPoints(passed: number, taskCount: number): number {
  if (taskCount === 0) return 0;
  return Math.round(((TASK_POINTS * passed) / taskCount) * 100) / 100;
}

export function formatPoints(points: number): string {
  return points.toLocaleString("ru-RU", { maximumFractionDigits: 2 });
}
