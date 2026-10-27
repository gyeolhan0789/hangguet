import { describe, expect, it } from "vitest";

import {
  nicknameSchema,
  objectKeySchema,
  passwordChangeSchema,
  profileImageUploadSchema,
  withdrawSchema,
} from "./schemas";

// 기준: 웹 Swagger 2.2 NicknameRequest(최대 50자 · 앞뒤 공백 제거) · 2.3 PasswordChangeRequest(currentPassword 최대 64자,
// newPassword 8~64자 · 영문 · 숫자) · 2.4 ProfileImageUploadUrlRequest(JPG · PNG, 1~5,242,880) · 2.5 objectKey 1자 이상
// · 2.7 WithdrawRequest(password 최대 64자). 빈 값은 화면에서 먼저 막는다.

const firstMessage = (result: { success: boolean; error?: { issues: { message: string }[] } }) =>
  result.success ? null : result.error!.issues[0].message;

describe("nicknameSchema (2.2)", () => {
  it.each([
    ["가", "가"],
    ["  면접왕  ", "면접왕"],
    ["가".repeat(50), "가".repeat(50)],
  ])("%j → %j로 통과(앞뒤 공백 제거 · 50자까지)", (input, output) => {
    expect(nicknameSchema.parse({ nickname: input })).toEqual({ nickname: output });
  });

  it.each([
    ["", "필수 값입니다."],
    ["   ", "필수 값입니다."],
    ["가".repeat(51), "1~50자입니다."],
  ])("%j → %s", (input, message) => {
    expect(firstMessage(nicknameSchema.safeParse({ nickname: input }))).toBe(message);
  });
});

describe("passwordChangeSchema (2.3)", () => {
  const RULE = "8~64자, 영문과 숫자를 모두 포함해야 합니다.";

  it.each(["abcdefg1", `a1${"x".repeat(62)}`])(
    "새 비밀번호 %j(8 · 64자, 영문 · 숫자)는 통과",
    (pw) => {
      expect(
        passwordChangeSchema.safeParse({ currentPassword: "now", newPassword: pw }).success,
      ).toBe(true);
    },
  );

  it.each([
    ["7자", "abcdef1"],
    ["65자", `a1${"x".repeat(63)}`],
    ["숫자 없음", "abcdefgh"],
    ["영문 없음", "12345678"],
  ])("새 비밀번호 %s는 '%s'", (_, pw) => {
    expect(
      firstMessage(passwordChangeSchema.safeParse({ currentPassword: "now", newPassword: pw })),
    ).toBe(RULE);
  });

  it.each([
    ["", "필수 값입니다."],
    ["   ", "필수 값입니다."],
    ["x".repeat(65), "최대 64자입니다."],
  ])("지금 비밀번호 %j → %s", (current, message) => {
    expect(
      firstMessage(
        passwordChangeSchema.safeParse({ currentPassword: current, newPassword: "abcdefg1" }),
      ),
    ).toBe(message);
  });

  it("지금 비밀번호 64자는 통과", () => {
    expect(
      passwordChangeSchema.safeParse({ currentPassword: "x".repeat(64), newPassword: "abcdefg1" })
        .success,
    ).toBe(true);
  });
});

describe("profileImageUploadSchema (2.4)", () => {
  it.each([
    ["image/jpeg", 1],
    ["image/png", 5_242_880],
  ])("%s · %i바이트는 통과", (contentType, size) => {
    expect(profileImageUploadSchema.safeParse({ contentType, size }).success).toBe(true);
  });

  it.each([
    ["image/gif", 1000, "JPG·PNG만 올릴 수 있습니다."],
    ["image/png", 0, "1바이트 이상입니다."],
    ["image/png", 5_242_881, "5MB 이하만 올릴 수 있습니다."],
  ])("%s · %i바이트 → %s", (contentType, size, message) => {
    expect(firstMessage(profileImageUploadSchema.safeParse({ contentType, size }))).toBe(message);
  });
});

describe("objectKeySchema (2.5) · withdrawSchema (2.7)", () => {
  it("비었거나 공백뿐이면 '필수 값입니다.'", () => {
    expect(firstMessage(objectKeySchema.safeParse("  "))).toBe("필수 값입니다.");
    expect(firstMessage(withdrawSchema.safeParse({ password: "" }))).toBe("필수 값입니다.");
    expect(firstMessage(withdrawSchema.safeParse({ password: "   " }))).toBe("필수 값입니다.");
  });

  it("탈퇴 비밀번호는 64자까지 통과, 65자는 '최대 64자입니다.'(웹 Swagger WithdrawRequest maxLength 64)", () => {
    expect(withdrawSchema.safeParse({ password: "x".repeat(64) }).success).toBe(true);
    expect(firstMessage(withdrawSchema.safeParse({ password: "x".repeat(65) }))).toBe(
      "최대 64자입니다.",
    );
  });
});
