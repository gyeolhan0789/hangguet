import { z } from "zod";

// 기준: Swagger 4.1 지원서 작성(ApplicationCreateRequest: 셋 다 필수, 회사명 · 직무 최대 100자, coverLetterItems 1~5개
// · CoverLetterItemRequest 문항 1~255자 · 답변 1~20,000자) · ERD cover_letter_items(지원서당 최대 5개)
// · Figma 지원서 쓰기(회사명 · 직무 · 자기소개서 문항-답변) · 사용자 결정(2026-10-29: 문항 · 답변이 하나라도 비면
//   [저장하기] 비활성). 폼(클라이언트)과 서버 액션이 같이 쓴다.

export const COMPANY_NAME_MAX = 100;
export const JOB_TITLE_MAX = 100;
/** 지원서 하나의 최대 문항 수 */
export const COVER_LETTER_ITEMS_MAX = 5;
/** 문항 질문 최대 글자 수 */
export const QUESTION_MAX = 255;
/** 문항 하나의 답변 최대 글자 수 */
export const ANSWER_MAX = 20000;

/** 4.1 요청 본문이자 지원서 쓰기 폼. 서버 액션은 브라우저가 보낸 값을 이것으로 다시 검사한다. */
export const applicationSchema = z.object({
  companyName: z
    .string()
    .trim()
    .min(1, "회사명을 입력해 주세요.")
    .max(COMPANY_NAME_MAX, `회사명은 ${COMPANY_NAME_MAX}자까지 쓸 수 있어요.`),
  jobTitle: z
    .string()
    .trim()
    .min(1, "직무를 입력해 주세요.")
    .max(JOB_TITLE_MAX, `직무는 ${JOB_TITLE_MAX}자까지 쓸 수 있어요.`),
  coverLetterItems: z
    .array(
      z.object({
        question: z
          .string()
          .trim()
          .min(1, "문항을 입력해 주세요.")
          .max(QUESTION_MAX, `문항은 ${QUESTION_MAX}자까지 쓸 수 있어요.`),
        answer: z
          .string()
          .trim()
          .min(1, "답변을 입력해 주세요.")
          .max(ANSWER_MAX, `답변은 ${ANSWER_MAX.toLocaleString("ko-KR")}자까지 쓸 수 있어요.`),
      }),
    )
    .min(1)
    .max(COVER_LETTER_ITEMS_MAX),
});

export type ApplicationValues = z.infer<typeof applicationSchema>;

/** 폼에 있는 칸 이름. 서버가 돌려준 칸별 오류를 칸 아래에 보여 줄지 정할 때 쓴다. */
export const APPLICATION_FIELDS = applicationSchema.keyof().options;
