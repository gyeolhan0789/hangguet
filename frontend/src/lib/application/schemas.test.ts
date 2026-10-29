import { describe, expect, expectTypeOf, it } from "vitest";

import type { ApplicationCreateRequest } from "@/types/api";

import { applicationSchema, type ApplicationValues } from "./schemas";

// 기준: Swagger 4.1 ApplicationCreateRequest(회사명 · 직무 1~100자, coverLetterItems 1~5개, 문항 1~255자 · 답변 1~20,000자)
// · ERD cover_letter_items(지원서당 최대 5개) · 사용자 결정(2026-10-29: 문항 · 답변이 하나라도 비면 거절)

const item = { question: "지원 동기", answer: "저는…" };
const values = { companyName: "○○전자", jobTitle: "백엔드 개발자", coverLetterItems: [item] };

describe("applicationSchema (Swagger 4.1 요청 본문 · 지원서 쓰기 폼)", () => {
  // 타입 검사는 tsc가 한다: 스키마나 4.1 요청 타입 어느 쪽이 바뀌어도 여기서 컴파일 오류가 난다.
  it("검증을 통과한 값의 타입이 4.1 요청 타입(ApplicationCreateRequest)과 같다", () => {
    expectTypeOf<ApplicationValues>().toEqualTypeOf<ApplicationCreateRequest>();
  });

  it("모두 채워져 있으면 통과하고, 칸마다 앞뒤 공백은 지운다", () => {
    expect(
      applicationSchema.parse({
        companyName: " ○○전자 ",
        jobTitle: "백엔드 개발자\n",
        coverLetterItems: [{ question: " 지원 동기 ", answer: "저는…\n" }],
      }),
    ).toEqual(values);
  });

  it.each(["companyName", "jobTitle"] as const)("%s가 비었거나 공백만 있으면 거절한다", (field) => {
    for (const blank of ["", "  \n "]) {
      expect(applicationSchema.safeParse({ ...values, [field]: blank }).success).toBe(false);
    }
  });

  it("회사명 · 직무는 100자까지만 받는다", () => {
    for (const field of ["companyName", "jobTitle"] as const) {
      expect(applicationSchema.safeParse({ ...values, [field]: "가".repeat(100) }).success).toBe(
        true,
      );
      expect(applicationSchema.safeParse({ ...values, [field]: "가".repeat(101) }).success).toBe(
        false,
      );
    }
  });

  it("문항은 1~5개만 받는다", () => {
    const of = (count: number) => ({ ...values, coverLetterItems: Array(count).fill(item) });
    expect(applicationSchema.safeParse(of(0)).success).toBe(false);
    expect(applicationSchema.safeParse(of(5)).success).toBe(true);
    expect(applicationSchema.safeParse(of(6)).success).toBe(false);
  });

  it.each(["question", "answer"] as const)(
    "어느 문항이든 %s가 비었거나 공백만 있으면 거절한다",
    (field) => {
      for (const blank of ["", "  \n "]) {
        const coverLetterItems = [item, { ...item, [field]: blank }];
        expect(applicationSchema.safeParse({ ...values, coverLetterItems }).success).toBe(false);
      }
    },
  );

  it("문항 질문은 255자, 답변은 문항마다 20,000자까지 받는다", () => {
    const withItem = (question: string, answer: string) => ({
      ...values,
      coverLetterItems: [item, { question, answer }],
    });
    expect(
      applicationSchema.safeParse(withItem("가".repeat(255), "가".repeat(20000))).success,
    ).toBe(true);
    expect(applicationSchema.safeParse(withItem("가".repeat(256), "답변")).success).toBe(false);
    expect(applicationSchema.safeParse(withItem("문항", "가".repeat(20001))).success).toBe(false);
  });
});
