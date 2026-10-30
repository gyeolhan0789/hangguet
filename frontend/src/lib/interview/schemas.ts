import { z } from "zod";

import type { AnswerRequest } from "@/types/api";

import { MODE_VALUES } from "./modes";
import { PERSONA_VALUES } from "./personas";

// 기준: Swagger 5.1 SessionCreateRequest(applicationId 양수 · persona DEVIL | COFFEE_CHAT · mode VIDEO | CHAT, 모두 필수)
// · Idempotency-Key 헤더(UUID) · 5.3 · 5.4 경로 값 sessionId(SessionPath). 면접관 · 방식 값은 화면 목록(Record<Persona|Mode, …>)과 같은 곳에서 가져와 빠짐없이 맞춘다.

/** 지원서 · 면접 id(양의 정수) */
export const idSchema = z.number().int().positive();

export const sessionCreateSchema = z.object({
  applicationId: idSchema,
  persona: z.enum(PERSONA_VALUES),
  mode: z.enum(MODE_VALUES),
});

export const idempotencyKeySchema = z.uuid();

/** 5.8 시선 비율(%, 0~100). API 명세 5.8 gazeRatio */
export const gazeRatioSchema = z.number().min(0).max(100);

export type SessionCreateValues = z.infer<typeof sessionCreateSchema>;

// 기준: Swagger 5.7 AnswerRequest(TEXT: content 1~1,000자 필수) · 넘으면 공통 400 VALIDATION_FAILED
// Figma S06-B와 웹 Swagger 5.7 모두 검증 문구(400 예시)가 없어 FE 문구를 쓴다(공백만 넣어도 '필수 값입니다.').

/** 채팅 답변 최대 글자 수(5.7 TEXT). Figma S06-B 입력창 '0 / 1,000' */
export const ANSWER_TEXT_MAX = 1000;

/** S06-B 채팅 답변. 공백만 넣은 답변은 낼 수 없다(웹 Swagger AnswerRequest.content 1~1,000자). */
export const answerTextSchema = z.object({
  content: z
    .string()
    .refine((value) => value.trim().length > 0, "필수 값입니다.")
    .refine((value) => value.length <= ANSWER_TEXT_MAX, "채팅 답변은 1~1,000자입니다."),
}) satisfies z.ZodType<Pick<AnswerRequest, "content">>;

export type AnswerTextValues = z.infer<typeof answerTextSchema>;
