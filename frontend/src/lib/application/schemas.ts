import { z } from "zod";

// 기준: Swagger 4.1 지원서 작성(ApplicationCreateRequest: 셋 다 필수, 최대 100 · 100 · 3,000자)
// · Figma 메모 S03(필수: 회사 · 직무 · 자소서, 빈칸이면 [다음] 비활성). 폼(클라이언트)과 서버 액션이 같이 쓴다.

export const COMPANY_NAME_MAX = 100;
export const JOB_TITLE_MAX = 100;
export const COVER_LETTER_MAX = 3000;

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
  coverLetter: z
    .string()
    .trim()
    .min(1, "자기소개서를 입력해 주세요.")
    .max(
      COVER_LETTER_MAX,
      `자기소개서는 ${COVER_LETTER_MAX.toLocaleString("ko-KR")}자까지 쓸 수 있어요.`,
    ),
});

export type ApplicationValues = z.infer<typeof applicationSchema>;

/** 폼에 있는 칸 이름. 서버가 돌려준 칸별 오류를 칸 아래에 보여 줄지 정할 때 쓴다. */
export const APPLICATION_FIELDS = applicationSchema.keyof().options;
