import { beforeEach, describe, expect, it } from "vitest";
import {
  acceptInvite,
  AccessError,
  createCourse,
  getCourseForMember,
  listCoursesForUser,
  regenerateInvite,
} from "@/lib/courses";
import { db } from "@/lib/db";
import { resetDb } from "./helpers";

async function makeUsers() {
  const teacher = await db.user.create({ data: { email: "t@example.com", isTeacher: true } });
  const student = await db.user.create({ data: { email: "s@example.com" } });
  return { teacher, student };
}

beforeEach(resetDb);

describe("курсы и приглашения", () => {
  it("преподаватель создаёт курс, студент входит по ссылке", async () => {
    const { teacher, student } = await makeUsers();
    const course = await createCourse(teacher.id, "  Теория медиа ");
    expect(course.title).toBe("Теория медиа");

    const data = await getCourseForMember(course.id, teacher.id);
    expect(data?.membership.role).toBe("TEACHER");
    const code = data!.course.invites[0].code;

    expect(await getCourseForMember(course.id, student.id)).toBeNull();
    expect((await acceptInvite(code, student.id))?.id).toBe(course.id);
    // Повторный переход по ссылке ничего не ломает.
    await acceptInvite(code, student.id);

    const memberships = await listCoursesForUser(student.id);
    expect(memberships).toHaveLength(1);
    expect(memberships[0].role).toBe("STUDENT");
    expect(memberships[0].course._count.members).toBe(2);
  });

  it("студент не может создать курс или сменить ссылку", async () => {
    const { teacher, student } = await makeUsers();
    await expect(createCourse(student.id, "Курс")).rejects.toBeInstanceOf(AccessError);

    const course = await createCourse(teacher.id, "Курс");
    const code = (await getCourseForMember(course.id, teacher.id))!.course.invites[0].code;
    await acceptInvite(code, student.id);
    await expect(regenerateInvite(course.id, student.id)).rejects.toBeInstanceOf(AccessError);
  });

  it("преподаватель не понижается до студента по своей же ссылке", async () => {
    const { teacher } = await makeUsers();
    const course = await createCourse(teacher.id, "Курс");
    const code = (await getCourseForMember(course.id, teacher.id))!.course.invites[0].code;
    await acceptInvite(code, teacher.id);
    expect((await getCourseForMember(course.id, teacher.id))?.membership.role).toBe("TEACHER");
  });

  it("новая ссылка отзывает старую", async () => {
    const { teacher, student } = await makeUsers();
    const course = await createCourse(teacher.id, "Курс");
    const oldCode = (await getCourseForMember(course.id, teacher.id))!.course.invites[0].code;

    const fresh = await regenerateInvite(course.id, teacher.id);
    expect(await acceptInvite(oldCode, student.id)).toBeNull();
    expect((await acceptInvite(fresh.code, student.id))?.id).toBe(course.id);
  });
});
