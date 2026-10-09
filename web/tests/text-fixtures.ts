import { acceptInvite, createCourse, getCourseForMember } from "@/lib/courses";
import { db } from "@/lib/db";
import type { ExtractResult } from "@/lib/pdf-service";
import { createTextFromPdf } from "@/lib/texts";

export const PDF = new TextEncoder().encode("%PDF-1.7 fake");

export function line(page: number, start: number, end: number) {
  return { page, bbox: [60, 60, 535, 72] as [number, number, number, number], start, end };
}

// Абзац, разорванный страницей: между половинами стоят колонтитул и номер страницы.
export const EXTRACTED: ExtractResult = {
  pageCount: 2,
  pages: [
    { width: 595, height: 842 },
    { width: 595, height: 842 },
  ],
  language: "ru",
  fragments: [
    { kind: "heading", text: "Введение", language: "ru", words: 1, lines: [line(0, 0, 8)], sentences: [[0, 8]] },
    {
      kind: "body",
      text: "Первая фраза. Вторая обрывается на",
      language: "ru",
      words: 6,
      lines: [line(0, 0, 34)],
      sentences: [
        [0, 13],
        [14, 34],
      ],
    },
    {
      kind: "excluded",
      text: "1",
      language: "ru",
      words: 1,
      lines: [line(0, 0, 1)],
      sentences: [[0, 1]],
      excludeReason: "колонтитул или номер страницы",
    },
    {
      kind: "body",
      text: "Середина кавычки. Конец абзаца.",
      language: "ru",
      words: 4,
      lines: [line(1, 0, 31)],
      sentences: [
        [0, 17],
        [18, 31],
      ],
    },
  ],
};

export async function setup() {
  const teacher = await db.user.create({ data: { email: "t@example.com", isTeacher: true } });
  const student = await db.user.create({ data: { email: "s@example.com", name: "Студент" } });
  const course = await createCourse(teacher.id, "Курс");
  const code = (await getCourseForMember(course.id, teacher.id))!.course.invites[0].code;
  await acceptInvite(code, student.id);
  return { teacher, student, course };
}

export async function upload(courseId: string, userId: string) {
  return createTextFromPdf({ courseId, userId, title: "", fileName: "Статья Инниса.pdf", bytes: PDF });
}
