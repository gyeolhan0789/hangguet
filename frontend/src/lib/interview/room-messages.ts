import { z } from "zod";

// 기준: API 명세 면접방 메시지(answer.state · answer.submit) · 5.7(채팅은 202 또는 409 ANSWER_ALREADY_SUBMITTED를
// 받으면 answer.submit을 보낸다) · AI 명세 6.3(interview.answerState · interview.answerSubmit).
// 면접방 메시지는 웹 Swagger에 없는, 같은 면접방의 에이전트와 주고받는 LiveKit RPC 본문이다.
export const ANSWER_STATE_METHOD = "interview.answerState";
export const ANSWER_SUBMIT_METHOD = "interview.answerSubmit";
export const QUESTION_METHOD = "interview.question";
export const CHAT_INPUT_METHOD = "interview.chatInput";

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

export function answerSubmitPayload(sessionId: number, seq: number) {
  return JSON.stringify({ type: "answer.submit", sessionId, seq });
}
