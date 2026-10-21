import type {
  QuestionTtsFailure,
  QuestionTtsStatus,
} from "@/components/interview/use-question-tts";
import type { VideoAnswerPhase } from "@/components/interview/video-answer-contract";

// 기준: API 명세 5.12(질문 음성이 실패해도 질문 글로 면접을 계속한다) · 화상 답변 상태(video-answer-contract)
// 질문 음성 재생이 끝나거나 실패할 때까지 화상 [답변 시작]을 잠근다(재생을 종료하고 녹음하는 안과 비교해 선택한 FE 임시 결정, 화면 담당 확정 전).
// 질문 음성 상태와 화상 답변 상태로 화면 버튼을 결정하는 순수 함수다.

/** [다시 듣기]를 활성화하는 화상 답변 상태(답변 전 · 60초 종료). 녹음 · 제출 중에는 비활성화한다 */
const REPLAY_OPEN_PHASES: ReadonlySet<VideoAnswerPhase> = new Set(["idle", "timedOut"]);

export interface QuestionVoiceGate {
  /** 화상 [답변 시작] 잠금. 질문 음성을 수신하거나 재생하는 동안만 잠그고, 실패하면 해제해 글로 진행한다 */
  answerStartLocked: boolean;
  /** [다시 듣기]를 활성화할지 */
  replayOpen: boolean;
  /** 자동재생 정책으로 소리를 재생하지 못했다. 사용자가 [질문 듣기]를 눌러 replay()하게 한다 */
  needsListenButton: boolean;
}

/**
 * answerPhase가 null이면 채팅(S06-B)이다. 채팅은 답변 녹음이 없어 [다시 듣기]를 언제든 활성화한다.
 */
export function questionVoiceGate(
  status: QuestionTtsStatus,
  failure: QuestionTtsFailure | null,
  answerPhase: VideoAnswerPhase | null,
): QuestionVoiceGate {
  const voiceBusy = status === "loading" || status === "playing";
  const isVideo = answerPhase !== null;
  const replayOpen = !isVideo || REPLAY_OPEN_PHASES.has(answerPhase);
  return {
    answerStartLocked: isVideo && voiceBusy,
    replayOpen,
    // 녹음 · 제출 중에는 [질문 듣기]도 보이지 않는다(질문 음성이 마이크에 녹음되지 않게).
    needsListenButton: status === "failed" && failure === "blocked" && replayOpen,
  };
}
