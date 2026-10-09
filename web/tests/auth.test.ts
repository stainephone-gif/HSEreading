import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  consumeLoginToken,
  deleteSession,
  findUserBySessionToken,
  LOGIN_RATE_LIMIT,
  LOGIN_TOKEN_TTL_MS,
  requestLoginLink,
} from "@/lib/auth";
import { db } from "@/lib/db";
import * as mail from "@/lib/mail";
import { resetDb } from "./helpers";

// Достаёт токен из текста письма, как это сделал бы студент.
function captureToken() {
  const spy = vi.spyOn(mail, "sendMail").mockResolvedValue();
  return () => {
    const text = spy.mock.calls.at(-1)?.[2] ?? "";
    return decodeURIComponent(/token=([^\s]+)/.exec(text)![1]);
  };
}

beforeEach(async () => {
  vi.restoreAllMocks();
  await resetDb();
});

describe("вход по ссылке", () => {
  it("создаёт пользователя и сессию, токен одноразовый", async () => {
    const lastToken = captureToken();
    expect(await requestLoginLink("  Student@Example.com ", "/invite/abc")).toEqual({ ok: true });

    const token = lastToken();
    const login = await consumeLoginToken(token);
    expect(login?.next).toBe("/invite/abc");

    const user = await findUserBySessionToken(login!.sessionToken);
    expect(user?.email).toBe("student@example.com");
    expect(user?.isTeacher).toBe(false);

    expect(await consumeLoginToken(token)).toBeNull();
  });

  it("выдаёт право преподавателя по TEACHER_EMAILS", async () => {
    const lastToken = captureToken();
    await requestLoginLink("teacher@example.com");
    const login = await consumeLoginToken(lastToken());
    const user = await findUserBySessionToken(login!.sessionToken);
    expect(user?.isTeacher).toBe(true);
  });

  it("не принимает истёкший токен", async () => {
    const lastToken = captureToken();
    const issued = new Date("2026-01-01T10:00:00Z");
    await requestLoginLink("a@example.com", null, issued);
    const later = new Date(issued.getTime() + LOGIN_TOKEN_TTL_MS + 1);
    expect(await consumeLoginToken(lastToken(), later)).toBeNull();
  });

  it("отбрасывает внешний адрес возврата", async () => {
    const lastToken = captureToken();
    await requestLoginLink("a@example.com", "//evil.com");
    expect((await consumeLoginToken(lastToken()))?.next).toBeNull();
  });

  it("отклоняет кривой адрес и ограничивает частоту", async () => {
    captureToken();
    expect((await requestLoginLink("not-an-email")).ok).toBe(false);
    for (let i = 0; i < LOGIN_RATE_LIMIT; i++) {
      expect((await requestLoginLink("b@example.com")).ok).toBe(true);
    }
    expect((await requestLoginLink("b@example.com")).ok).toBe(false);
  });

  it("тестовый режим отдаёт ссылку сразу, обычный — нет", async () => {
    captureToken();
    expect(await requestLoginLink("d@example.com")).toEqual({ ok: true });
    process.env.DEV_LOGIN_LINKS = "true";
    try {
      const res = await requestLoginLink("d@example.com");
      expect(res.ok && res.devLink).toMatch(/\/auth\/verify\?token=/);
      const token = decodeURIComponent(new URL((res as { devLink: string }).devLink).searchParams.get("token")!);
      expect(await consumeLoginToken(token)).not.toBeNull();
    } finally {
      delete process.env.DEV_LOGIN_LINKS;
    }
  });

  it("выход удаляет сессию", async () => {
    const lastToken = captureToken();
    await requestLoginLink("c@example.com");
    const login = await consumeLoginToken(lastToken());
    await deleteSession(login!.sessionToken);
    expect(await findUserBySessionToken(login!.sessionToken)).toBeNull();
    expect(await db.session.count()).toBe(0);
  });
});
