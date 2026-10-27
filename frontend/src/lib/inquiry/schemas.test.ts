import { describe, expect, it } from "vitest";

import { guestInquirySchema, guestLookupSchema, inquirySchema } from "./schemas";

// 기준: Swagger 9.1 InquiryCreateRequest 검증 문구(서버 400 errors[].reason과 같은 문구)
// 칸마다 첫 문구만 본다(zodResolver도 칸마다 첫 오류를 보인다)
const issues = (result: {
  success: boolean;
  error?: { issues: { path: PropertyKey[]; message: string }[] };
}) =>
  Object.fromEntries(
    (result.error?.issues ?? []).map((i) => [String(i.path[0]), i.message]).reverse(),
  );

describe("inquirySchema (I01 회원)", () => {
  it("제목 · 내용은 필수, 제목은 최대 100자", () => {
    expect(issues(inquirySchema.safeParse({ title: " ", content: "" }))).toEqual({
      title: "필수 값입니다.",
      content: "필수 값입니다.",
    });
    expect(issues(inquirySchema.safeParse({ title: "가".repeat(101), content: "내용" }))).toEqual({
      title: "최대 100자입니다.",
    });
    expect(inquirySchema.safeParse({ title: "가".repeat(100), content: "내용" }).success).toBe(
      true,
    );
  });
});

describe("guestInquirySchema (I01-B 비회원)", () => {
  const base = { email: "a@ssafy.com", accessPassword: "1234", title: "제목", content: "내용" };

  it("이메일은 필수 · 형식, 조회 비밀번호는 4~20자", () => {
    expect(
      issues(guestInquirySchema.safeParse({ ...base, email: "", accessPassword: "" })),
    ).toEqual({
      email: "필수 값입니다.",
      accessPassword: "필수 값입니다.",
    });
    expect(
      issues(guestInquirySchema.safeParse({ ...base, email: "abc", accessPassword: "123" })),
    ).toEqual({
      email: "이메일 형식이 아닙니다.",
      accessPassword: "4~20자입니다.",
    });
    expect(
      issues(guestInquirySchema.safeParse({ ...base, accessPassword: "a".repeat(21) })),
    ).toEqual({
      accessPassword: "4~20자입니다.",
    });
    expect(
      issues(guestInquirySchema.safeParse({ ...base, email: `${"a".repeat(246)}@ssafy.com` })),
    ).toEqual({ email: "최대 255자입니다." });
    expect(guestInquirySchema.safeParse({ ...base, accessPassword: "a".repeat(20) }).success).toBe(
      true,
    );
    expect(guestInquirySchema.safeParse(base).success).toBe(true);
  });
});

describe("guestLookupSchema (I04)", () => {
  it("문의번호는 양의 정수만", () => {
    expect(issues(guestLookupSchema.safeParse({ inquiryId: "", accessPassword: "1234" }))).toEqual({
      inquiryId: "필수 값입니다.",
    });
    for (const inquiryId of ["0", "07", "a7", "-1"]) {
      expect(issues(guestLookupSchema.safeParse({ inquiryId, accessPassword: "1234" }))).toEqual({
        inquiryId: "문의를 찾을 수 없어요.",
      });
    }
    expect(guestLookupSchema.safeParse({ inquiryId: "7", accessPassword: "1234" }).success).toBe(
      true,
    );
  });
});
