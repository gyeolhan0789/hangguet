// @vitest-environment node
// 기준: Swagger 4.1 ApplicationCreateRequest(회사명 · 직무 1~100자, coverLetterItems 1~5개, 문항 1~255자 · 답변 1~20,000자)
// · ERD cover_letter_items(지원서당 최대 5개) · 사용자 결정(2026-10-29: 문항 · 답변이 하나라도 비면 거절)
import { describe, expect, it } from "vitest";

import { applicationSchema } from "./schemas";

// 예시 데이터: Swagger 4.1 요청 예시
const ITEM = { question: "지원 동기", answer: "저는 대용량 트래픽을 안정적으로 처리하고 싶어요." };
const VALUES = { companyName: "○○전자", jobTitle: "백엔드 개발자", coverLetterItems: [ITEM] };

type Field = "companyName" | "jobTitle" | "question" | "answer";

/** 한 칸만 바꾼 입력. 문항 · 답변은 첫 문항의 칸이다. */
function withField(field: Field, value: string) {
  if (field === "question" || field === "answer") {
    return { ...VALUES, coverLetterItems: [{ ...ITEM, [field]: value }] };
  }
  return { ...VALUES, [field]: value };
}

/** 거절 문구(통과하면 null) */
function rejection(input: unknown) {
  const result = applicationSchema.safeParse(input);
  return result.success ? null : result.error.issues[0].message;
}

const withItems = (count: number) => ({ ...VALUES, coverLetterItems: Array(count).fill(ITEM) });

describe("applicationSchema · 지원서 입력 규칙", () => {
  describe("정상 처리", () => {
    it("모든 칸을 채우면 통과하고 칸마다 앞뒤 공백을 지운다", () => {
      expect(
        applicationSchema.parse({
          companyName: " ○○전자 ",
          jobTitle: "백엔드 개발자\n",
          coverLetterItems: [{ question: " 지원 동기 ", answer: `${ITEM.answer}\n` }],
        }),
      ).toEqual(VALUES);
    });
  });

  describe("입력 검증", () => {
    it.each(
      (
        [
          { field: "companyName", message: "회사명을 입력해 주세요." },
          { field: "jobTitle", message: "직무를 입력해 주세요." },
          { field: "question", message: "문항을 입력해 주세요." },
          { field: "answer", message: "답변을 입력해 주세요." },
        ] as const
      ).flatMap((row) => [
        { ...row, label: "빈 값", input: "" },
        { ...row, label: "공백만", input: "  \n " },
      ]),
    )("'$field'가 '$label'이면 '$message' 문구로 거절한다", ({ field, input, message }) => {
      expect(rejection(withField(field, input))).toBe(message);
    });
  });

  describe("경계값", () => {
    it.each([
      { field: "companyName", max: 100, message: "회사명은 100자까지 쓸 수 있어요." },
      { field: "jobTitle", max: 100, message: "직무는 100자까지 쓸 수 있어요." },
      { field: "question", max: 255, message: "문항은 255자까지 쓸 수 있어요." },
      { field: "answer", max: 20000, message: "답변은 20,000자까지 쓸 수 있어요." },
    ] as const)(
      "'$field'는 '$max'자면 통과하고 하나 더 많으면 '$message' 문구로 거절한다",
      ({ field, max, message }) => {
        expect(rejection(withField(field, "가".repeat(max)))).toBeNull();
        expect(rejection(withField(field, "가".repeat(max + 1)))).toBe(message);
      },
    );

    it("앞뒤 공백을 뺀 길이가 100자면 회사명을 통과시킨다", () => {
      expect(rejection(withField("companyName", ` ${"가".repeat(100)} `))).toBeNull();
    });

    it("문항이 1개면 통과하고 0개면 거절한다", () => {
      expect(applicationSchema.safeParse(withItems(1)).success).toBe(true);
      expect(applicationSchema.safeParse(withItems(0)).success).toBe(false);
    });

    it("문항이 5개면 통과하고 6개면 거절한다", () => {
      expect(applicationSchema.safeParse(withItems(5)).success).toBe(true);
      expect(applicationSchema.safeParse(withItems(6)).success).toBe(false);
    });
  });
});
