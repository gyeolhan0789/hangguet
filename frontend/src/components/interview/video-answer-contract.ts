import type { DeviceFailure } from "@/lib/devices/media";
import type { SpeechActionFailure } from "@/lib/interview/speech-failure";
import type { ReactionResponse } from "@/types/api";

import type { AnswerSttStatus } from "./use-answer-stt";

// 기준: API 명세 5.6 · 5.7(화상 자동 제출 7초 · 60초, 빈 답변은 제출하지 않음, Idempotency-Key로 같은 본문 재전송) · 5.11(화상 리액션)
// · 기획 메모 S06(화상 = 입력 폼 없음, STT 자막, [답변 완료] 또는 일정 시간 침묵 시 다음 질문)
// 화상 답변 훅(useVideoAnswer)이 화면(S06)에 제공하는 타입이다. 실제 구현과 화면 개발용 목 훅이 같은 타입을 따른다.

/**
 * idle: 답변 전 · starting: 시작 중(중복 클릭 잠금) · listening: 듣는 중(말 시작 전 · 말하는 중)
 * · submitting: 제출 중 · submitFailed: 제출 실패([다시 시도]) · submitted: 접수됨(다음 질문 대기)
 * · timedOut: 60초 무발화로 종료([다시 시작])
 */
export type VideoAnswerPhase =
  "idle" | "starting" | "listening" | "submitting" | "submitFailed" | "submitted" | "timedOut";

/** 답변을 시작하지 못한 이유. 녹음은 해제하고 답변 전으로 돌아간다 */
export type AnswerStartFailure =
  { kind: "device"; reason: DeviceFailure } | { kind: "uploadUrl"; failure: SpeechActionFailure };

/**
 * 5.7 제출 결과. accepted면 isLastQuestion으로 5.5(다음 질문) 또는 5.8(면접 종료)을 정한다.
 * alreadySubmitted(409 ANSWER_ALREADY_SUBMITTED)면 마지막 질문인지는 화면이 seq로 판단한다(API 명세 5.7).
 */
export type VideoAnswerResult =
  { kind: "accepted"; isLastQuestion: boolean } | { kind: "alreadySubmitted" };

export interface VideoAnswerOptions {
  sessionId: number;
  questionId: number;
  questionText: string;
  /** 5.7이 접수됐거나 이미 제출한 답변일 때. 화면은 결과로 5.5 또는 5.8을 호출한다 */
  onSubmitted: (result: VideoAnswerResult) => void;
  /** 답변 도중 문장 끝마다 전송한 5.11의 유효한 응답(API 명세 5.11). 리액션 표시는 화면 · 면접관 표현이 한다 */
  onReaction?: (response: ReactionResponse) => void;
}

export interface VideoAnswer {
  phase: VideoAnswerPhase;
  /** 자막(확정 글 + 미확정 글) */
  caption: string;
  /** 음성 인식 연결 상태. error면 화면이 [다시 연결]을 보여 준다(그동안 [답변 완료]도 활성화한다) */
  sttStatus: AnswerSttStatus;
  startFailure: AnswerStartFailure | null;
  /** 마지막 제출 실패. 업로드 실패면 null */
  submitFailure: SpeechActionFailure | null;
  /** 답변 시작. 화상 화면이 연 stream을 전달하면 그 오디오 트랙을 복제해 사용한다 */
  start: (stream?: MediaStream) => Promise<void>;
  /** [답변 완료]. 7초 자동 제출도 같은 함수를 호출한다 */
  submit: () => Promise<void>;
  /** 제출 실패 뒤 [다시 시도]. 같은 키 · 같은 본문으로 다시 전송한다 */
  retry: () => Promise<void>;
  /** 음성 인식 오류 뒤 [다시 연결] */
  reconnect: () => void;
}
