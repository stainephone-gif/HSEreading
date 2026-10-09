import { db } from "@/lib/db";

export async function resetDb() {
  await db.$executeRawUnsafe(
    'TRUNCATE "Fragment", "Text", "Invite", "CourseMember", "Course", "Session", "LoginToken", "User" CASCADE',
  );
}
