import { db } from "@/lib/db";

export async function resetDb() {
  // Защита от очистки рабочей базы: тесты идут только на базе с именем *_test.
  if (!/_test(\?|$)/.test(process.env.DATABASE_URL ?? "")) {
    throw new Error("Тесты очищают таблицы: укажите TEST_DATABASE_URL с базой *_test.");
  }
  await db.$executeRawUnsafe(
    'TRUNCATE "Answer", "TaskPlacement", "Task", "Dwell", "ReadingCursor", "Fragment", "Text", "Invite", "CourseMember", "Course", "Session", "LoginToken", "User" CASCADE',
  );
}
