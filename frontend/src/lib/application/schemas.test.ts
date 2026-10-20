import { describe, expect, expectTypeOf, it } from "vitest";

import type { ApplicationCreateRequest } from "@/types/api";

import { applicationSchema, type ApplicationValues } from "./schemas";

const values = { companyName: "○○전자", jobTitle: "백엔드 개발자", coverLetter: "지원 동기" };

describe("applicationSchema (Swagger 4.1 · Figma 메모 S03)", () => {
  // 타입 검사는 tsc가 한다: 스키마나 4.1 요청 타입 어느 쪽이 바뀌어도 여기서 컴파일 오류가 난다.
  it("검증을 통과한 값의 타입이 4.1 요청 타입(ApplicationCreateRequest)과 같다", () => {
    expectTypeOf<ApplicationValues>().toEqualTypeOf<ApplicationCreateRequest>();
  });

  it("세 칸이 모두 있으면 통과하고, 앞뒤 공백은 지운다", () => {
    expect(applicationSchema.parse({ ...values, companyName: " ○○전자 " })).toEqual(values);
  });

  it.each(["companyName", "jobTitle", "coverLetter"] as const)(
    "%s가 비었거나 공백만 있으면 거절한다",
    (field) => {
      expect(applicationSchema.safeParse({ ...values, [field]: "" }).success).toBe(false);
      expect(applicationSchema.safeParse({ ...values, [field]: "  \n " }).success).toBe(false);
    },
  );

  it("최대 길이(회사명 · 직무 100자, 자기소개서 3,000자)까지만 받는다", () => {
    for (const [field, max] of [
      ["companyName", 100],
      ["jobTitle", 100],
      ["coverLetter", 3000],
    ] as const) {
      expect(applicationSchema.safeParse({ ...values, [field]: "가".repeat(max) }).success).toBe(
        true,
      );
      expect(
        applicationSchema.safeParse({ ...values, [field]: "가".repeat(max + 1) }).success,
      ).toBe(false);
    }
  });
});
