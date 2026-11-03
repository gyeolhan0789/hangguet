import { z } from "zod";

// 기준: API 명세 면접방 메시지(answer.state · answer.submit) · 5.7(채팅은 202 또는 409 ANSWER_ALREADY_SUBMITTED를
// 받으면 answer.submit을 보낸다) · AI 명세 6.3(interview.answerState · interview.answerSubmit).
// 면접방 메시지는 웹 Swagger에 없는, 같은 면접방의 에이전트와 주고받는 LiveKit RPC 본문이다.
export const ANSWER_STATE_METHOD = "interview.answerState";
export const ANSWER_SUBMIT_METHOD = "interview.answerSubmit";
export const QUESTION_METHOD = "interview.question";
export const CHAT_INPUT_METHOD = "interview.chatInput";
export const REACTION_METHOD = "interview.reaction";
// 기준: AI 명세 6.3 interview.frame(바이트 스트림, 화면 → 에이전트). 인상 판단용 카메라 사진(JPEG)과 속성 ageMs
export const FRAME_TOPIC = "interview.frame";
// 기준: AI 명세 6.3 reaction.durationMs(2,400ms).
// 표시 시간은 수신한 값을 사용하고, 명세 값보다 긴 리액션은 폐기한다.
export const REACTION_MAX_DURATION_MS = 2400;

export const reactionMessageSchema = z.object({
  type: z.literal("reaction"),
  sessionId: z.number().int().positive(),
  questionSeq: z.number().int().min(1).max(5),
  seq: z.number().int().positive(),
  reaction: z
    .discriminatedUnion("type", [
      z.object({
        type: z.literal("expression"),
        expression: z.enum(["smile", "frown", "smirk"]),
        gesture: z.null(),
        intensity: z.number().min(0).max(1),
        durationMs: z.number().int().positive().max(REACTION_MAX_DURATION_MS),
      }),
      z.object({
        type: z.literal("gesture"),
        expression: z.null(),
        gesture: z.enum(["small_nod", "nod", "tilt"]),
        intensity: z.null(),
        durationMs: z.number().int().positive().max(REACTION_MAX_DURATION_MS),
      }),
    ])
    .nullable(),
  attitude: z.object({ interest: z.number().min(0).max(1), trust: z.number().min(0).max(1) }),
  interrupt: z
    .object({ reason: z.enum(["OFF_TOPIC", "TOO_LONG"]), text: z.string().min(1) })
    .nullable(),
});
export type ReactionMessage = z.infer<typeof reactionMessageSchema>;
export interface ReactionSnapshot {
  message: ReactionMessage;
  receivedAt: number;
}

export function chatInputPayload(
  sessionId: number,
  questionSeq: number,
  seq: number,
  text: string,
  pauseMs: number,
) {
  return JSON.stringify({ type: "chat.input", sessionId, questionSeq, seq, text, pauseMs });
}

// 기준: AI 명세 6.3 interview.question. 질문 ID는 포함하지 않는다.
export const questionMessageSchema = z.object({
  type: z.literal("question"),
  sessionId: z.number().int().positive(),
  seq: z.number().int().min(1).max(5),
  content: z.string().min(1),
  speech: z.enum(["started", "ended", "failed"]),
  alignment: z
    .object({
      chars: z.array(
        z.object({
          char: z.string(),
          startMs: z.number().int().nonnegative(),
          endMs: z.number().int().nonnegative(),
        }),
      ),
    })
    .nullable(),
});

export type QuestionMessage = z.infer<typeof questionMessageSchema>;

/** 에이전트가 [답변 완료]를 거절하는 RPC 오류(AI 명세 6.3): 한마디도 안 함 · 답변 중이 아님 */
export const ANSWER_REJECTED_CODES = [2001, 2002] as const;

export const answerStateSchema = z.object({
  type: z.literal("answer.state"),
  sessionId: z.number().int().positive(),
  seq: z.number().int().min(1).max(5),
  state: z.enum([
    "autoSubmitted",
    "timedOut",
    "sttReconnecting",
    "sttFailed",
    "submitted",
    "submitFailed",
  ]),
});

export type AnswerStateMessage = z.infer<typeof answerStateSchema>;

export const answerSubmitResponseSchema = z.object({ accepted: z.boolean() });

/** content는 채팅이 5.7로 낸 답변 글(꼬리질문 생성용), 화상은 null */
export function answerSubmitPayload(sessionId: number, seq: number, content: string | null) {
  return JSON.stringify({ type: "answer.submit", sessionId, seq, content });
}
