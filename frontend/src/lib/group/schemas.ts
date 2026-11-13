import { z } from "zod";

import { MODE_VALUES } from "@/lib/interview/modes";
import { PERSONA_VALUES } from "@/lib/interview/personas";
import { idSchema } from "@/lib/interview/schemas";
import { ANSWER_TEXT_MAX } from "@/lib/interview/schemas";
import type { AnswerDraftRequest, GroupCreateRequest, GroupJoinRequest } from "@/types/api";

import { JOB_CATEGORY_VALUES } from "./job-categories";

// 기준: BE Swagger 10.1 GroupCreateRequest(capacity 2 · 3) · 10.3 GroupJoinRequest(inviteCode '초대 코드 6자리')
// · 10.9 DraftRequest(content 0~1,000자)

/** 정원(방장 포함). Figma G02 '인원' 2명 · 3명 */
export const GROUP_CAPACITIES = [2, 3] as const;

/** 초대 코드 6자리(BE Swagger 10.3 설명 · 예시 K7Q2ZP). 글자 종류는 Swagger에 없어 길이만 본다 */
export const inviteCodeSchema = z.string().length(6);

export const groupCreateSchema = z.object({
  mode: z.enum(MODE_VALUES),
  persona: z.enum(PERSONA_VALUES),
  capacity: z.union(GROUP_CAPACITIES.map((value) => z.literal(value))),
  jobCategory: z.enum(JOB_CATEGORY_VALUES),
  applicationId: idSchema,
}) satisfies z.ZodType<GroupCreateRequest>;

export const groupJoinSchema = z.object({
  inviteCode: inviteCodeSchema,
  applicationId: idSchema,
  jobCategory: z.enum(JOB_CATEGORY_VALUES),
}) satisfies z.ZodType<GroupJoinRequest>;

/** 10.9 작성 중인 답변. 빈 글도 저장한다(입력 칸을 다 지운 것도 마감 확정 재료다) */
export const answerDraftSchema = z.object({
  content: z.string().max(ANSWER_TEXT_MAX),
}) satisfies z.ZodType<AnswerDraftRequest>;

export type GroupCreateValues = z.infer<typeof groupCreateSchema>;
export type GroupJoinValues = z.infer<typeof groupJoinSchema>;
