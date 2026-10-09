import { db } from "@/lib/db";

export async function resetDb() {
  await db.$executeRawUnsafe(
    'TRUNCATE "Answer", "TaskPlacement", "Task", "Dwell", "ReadingCursor", "Fragment", "Text", "Invite", "CourseMember", "Course", "Session", "LoginToken", "User" CASCADE',
  );
}
