import { describe, expect, it } from "vitest";
import { generateInviteCode, generateToken, hashToken, safeNextPath } from "@/lib/tokens";

describe("tokens", () => {
  it("генерирует разные токены и стабильный хэш", () => {
    const a = generateToken();
    expect(a).not.toBe(generateToken());
    expect(hashToken(a)).toBe(hashToken(a));
    expect(hashToken(a)).not.toBe(a);
  });

  it("код приглашения без похожих символов", () => {
    const code = generateInviteCode();
    expect(code).toHaveLength(10);
    expect(code).toMatch(/^[a-hjkmnp-z2-9]+$/);
  });

  it.each([
    ["/courses/1", "/courses/1"],
    ["/invite/abc?x=1", "/invite/abc?x=1"],
    ["//evil.com", null],
    ["/\\evil.com", null],
    ["https://evil.com", null],
    ["", null],
    [undefined, null],
  ])("safeNextPath(%s) = %s", (input, expected) => {
    expect(safeNextPath(input)).toBe(expected);
  });
});
