import { db } from "@/lib/db";

export async function resetDb() {
  await db.$executeRawUnsafe(
    'TRUNCATE "Invite", "CourseMember", "Course", "Session", "LoginToken", "User" CASCADE',
  );
}
