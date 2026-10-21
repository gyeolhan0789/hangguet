"use client";

import { useEffect, useRef } from "react";

import { useQuestionTts, type QuestionTts } from "./use-question-tts";

// 기준: API 명세 5.12(질문을 수신하면 질문 음성을 재생하고, 실패하면 질문 글만 보여 주고 면접을 계속한다)
// · 기획 메모 S06(질문은 TTS 음성 + 말풍선)
// 화면이 수신한 질문(5.4 · 5.5)을 전달하면 질문이 변경될 때마다 질문 음성을 처음부터 재생한다. 글 표시는 화면이 담당한다.

export interface InterviewQuestion {
  id: number;
  content: string;
}

/**
 * question이 null이면(다음 질문을 기다리는 중) 재생하지 않는다. 같은 질문으로 다시 렌더링해도 다시 재생하지 않는다.
 * 실패해도 스스로 다시 시도하지 않는다(useQuestionTts). [다시 듣기]는 반환값의 replay()다.
 */
export function useInterviewQuestionVoice(
  sessionId: number,
  question: InterviewQuestion | null,
): QuestionTts {
  const tts = useQuestionTts();
  // 재생 함수가 다시 생성돼도 같은 질문을 다시 재생하지 않도록 질문 값에만 반응한다.
  const controls = useRef(tts);
  useEffect(() => {
    controls.current = tts;
  });
  const questionId = question?.id ?? null;
  const content = question?.content ?? null;

  useEffect(() => {
    if (questionId === null || content === null) {
      controls.current.stop();
      return;
    }
    controls.current.play({ sessionId, questionId, content });
  }, [sessionId, questionId, content]);

  return tts;
}
