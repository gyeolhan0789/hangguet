import { z } from "zod";

import { MODE_VALUES } from "./modes";
import { PERSONA_VALUES } from "./personas";

// 기준: Swagger 5.1 SessionCreateRequest(applicationId 양수 · persona DEVIL | COFFEE_CHAT · mode VIDEO | CHAT, 모두 필수)
// · Idempotency-Key 헤더(UUID). 면접관 · 방식 값은 화면 목록(Record<Persona|Mode, …>)과 같은 곳에서 가져와 빠짐없이 맞춘다.

export const sessionCreateSchema = z.object({
  applicationId: z.number().int().positive(),
  persona: z.enum(PERSONA_VALUES),
  mode: z.enum(MODE_VALUES),
});

export const idempotencyKeySchema = z.uuid();

export type SessionCreateValues = z.infer<typeof sessionCreateSchema>;
