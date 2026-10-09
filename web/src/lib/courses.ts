import { CourseRole } from "@prisma/client";
import { db } from "./db";
import { generateInviteCode } from "./tokens";

export class AccessError extends Error {}

export async function createCourse(userId: string, rawTitle: string) {
  const title = rawTitle.trim();
  if (!title) throw new Error("Название курса не может быть пустым.");
  const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
  if (!user.isTeacher) throw new AccessError("Создавать курсы могут только преподаватели.");

  return db.course.create({
    data: {
      title,
      ownerId: userId,
      members: { create: { userId, role: CourseRole.TEACHER } },
      invites: { create: { code: generateInviteCode() } },
    },
  });
}

export async function listCoursesForUser(userId: string) {
  return db.courseMember.findMany({
    where: { userId },
    include: { course: { include: { _count: { select: { members: true } } } } },
    orderBy: { joinedAt: "desc" },
  });
}

export async function getMembership(courseId: string, userId: string) {
  return db.courseMember.findUnique({ where: { courseId_userId: { courseId, userId } } });
}

export async function requireCourseTeacher(courseId: string, userId: string) {
  const m = await getMembership(courseId, userId);
  if (m?.role !== CourseRole.TEACHER) throw new AccessError("Нет доступа к настройкам курса.");
  return m;
}

export async function getCourseForMember(courseId: string, userId: string) {
  const membership = await getMembership(courseId, userId);
  if (!membership) return null;
  const course = await db.course.findUniqueOrThrow({
    where: { id: courseId },
    include: {
      members: { include: { user: true }, orderBy: { joinedAt: "asc" } },
      invites: { where: { revokedAt: null }, orderBy: { createdAt: "desc" } },
    },
  });
  return { course, membership };
}

// Отзывает действующие ссылки и выпускает новую.
export async function regenerateInvite(courseId: string, userId: string) {
  await requireCourseTeacher(courseId, userId);
  return db.$transaction(async (tx) => {
    await tx.invite.updateMany({ where: { courseId, revokedAt: null }, data: { revokedAt: new Date() } });
    return tx.invite.create({ data: { courseId, code: generateInviteCode() } });
  });
}

export async function findActiveInvite(code: string) {
  return db.invite.findFirst({ where: { code, revokedAt: null }, include: { course: true } });
}

// Добавляет пользователя в курс по приглашению. Повторный вход по ссылке
// ничего не меняет, роль преподавателя не понижается.
export async function acceptInvite(code: string, userId: string) {
  const invite = await findActiveInvite(code);
  if (!invite) return null;
  await db.courseMember.upsert({
    where: { courseId_userId: { courseId: invite.courseId, userId } },
    create: { courseId: invite.courseId, userId, role: invite.role },
    update: {},
  });
  return invite.course;
}

export async function updateUserName(userId: string, rawName: string) {
  const name = rawName.trim().slice(0, 120);
  return db.user.update({ where: { id: userId }, data: { name: name || null } });
}
