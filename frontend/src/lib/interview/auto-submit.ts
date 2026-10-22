// 기준: API 명세 5.7 화상 자동 제출(7초는 마지막 말소리가 인식된 때부터 계산하고 그 안에 다시 말하면 처음부터, 한마디도 하지 않았으면
// 자동으로 제출하지 않음, 말을 시작하지 않은 채 60초면 음성 인식 연결을 닫음)
// 화상 답변을 자동 제출할지 · 종료할지 결정하는 순수 함수다. 시각은 호출하는 쪽이 전달하고(performance.now), 타이머는 화면이 설정한다.
// - 말소리(speech)는 음성 인식 훅 onSpeech: 한 연결 안에서 비공백 토큰 end_ms 최댓값이 늘어난 result를 수신한 시각
// - SDK 자동 재연결(reconnecting · reconnected) 동안 7초는 중지하고, 재연결 뒤 말을 시작했으면 새로 계산한다. 60초는 계속 계산한다
// - [다시 연결](manualReconnect) · 빈 답변 다시 듣기(relisten)는 새 녹음이라 SDK 재연결 이벤트가 발생하지 않는다.
//   그래서 60초를 새로 계산한다. 다시 설정하지 않으면 말이 없을 때 음성 인식 연결이 무한히 유지된다
// - 다시 듣기는 답변 글이 비었을 때이므로 발화 시작 상태를 초기화한다. [다시 연결]은 이미 인식된 글이 있으면 발화를 시작한 것으로 간주하고
//   7초를 그때부터 계산한다(글이 있는데 60초 종료로 폐기하지 않는다). 글이 없으면 다시 듣기와 같다

/** 마지막 말소리 뒤 자동 제출까지(API 명세 5.7, 임시 값) */
export const AUTO_SUBMIT_SILENCE_MS = 7_000;

/** 말을 시작하지 않은 채 음성 인식을 종료하기까지(API 명세 5.7, 임시 값) */
export const NO_SPEECH_TIMEOUT_MS = 60_000;

/**
 * - idle: 답변 전
 * - listening: 음성 인식 중(연결 중 포함)
 * - reconnecting: SDK 자동 재연결 중
 * - error: 음성 인식 오류. [다시 연결]을 기다린다
 * - submitting: 제출 중(수동 · 자동)
 * - ended: 60초 종료
 */
export type AutoSubmitPhase =
  "idle" | "listening" | "reconnecting" | "error" | "submitting" | "ended";

export interface AutoSubmitState {
  phase: AutoSubmitPhase;
  /** 이 녹음에서 말을 시작했는지 */
  spoke: boolean;
  /** 60초를 계산하기 시작한 시각: 답변 시작 · [다시 연결] · 다시 듣기 */
  listenStartedAt: number | null;
  /** 7초를 계산하기 시작한 시각: 마지막 말소리 또는 말을 시작한 뒤의 재연결. 7초를 계산하지 않으면 null */
  silenceStartedAt: number | null;
}

export type AutoSubmitEvent =
  | { type: "answerStarted"; at: number }
  | { type: "speech"; at: number }
  | { type: "reconnecting" }
  | { type: "reconnected"; at: number }
  /** hasAnswer: [다시 연결] 전에 인식된 글이 있는지 */
  | { type: "manualReconnect"; at: number; hasAnswer: boolean }
  | { type: "relisten"; at: number }
  | { type: "sttError" }
  | { type: "submitStarted" }
  | { type: "tick"; now: number };

/** submit: 7초 자동 제출 · timeout: 60초 종료 · wait: 할 일 없음 */
export type AutoSubmitDecision = "submit" | "timeout" | "wait";

export interface AutoSubmitStep {
  state: AutoSubmitState;
  decision: AutoSubmitDecision;
}

export const initialAutoSubmitState: AutoSubmitState = {
  phase: "idle",
  spoke: false,
  listenStartedAt: null,
  silenceStartedAt: null,
};

/** 새 녹음으로 듣기 시작한다. 발화 시작 상태를 초기화하고 60초를 at부터 계산한다 */
function listenFrom(at: number): AutoSubmitState {
  return { phase: "listening", spoke: false, listenStartedAt: at, silenceStartedAt: null };
}

function isActive(phase: AutoSubmitPhase): boolean {
  return phase === "listening" || phase === "reconnecting";
}

function wait(state: AutoSubmitState): AutoSubmitStep {
  return { state, decision: "wait" };
}

/** 이벤트 하나를 반영한 새 상태와 할 일을 반환한다. 그 상태에서 의미 없는 이벤트는 상태를 변경하지 않는다 */
export function nextAutoSubmit(state: AutoSubmitState, event: AutoSubmitEvent): AutoSubmitStep {
  switch (event.type) {
    case "answerStarted":
      return wait(listenFrom(event.at));

    case "speech":
      if (!isActive(state.phase)) return wait(state);
      // 재연결 중이면 7초는 중지 상태로 유지하고 발화 시작 상태만 기록한다.
      return wait({
        ...state,
        spoke: true,
        silenceStartedAt: state.phase === "listening" ? event.at : null,
      });

    case "reconnecting":
      if (state.phase !== "listening") return wait(state);
      return wait({ ...state, phase: "reconnecting", silenceStartedAt: null });

    case "reconnected":
      if (state.phase !== "reconnecting") return wait(state);
      // 60초(listenStartedAt)는 유지한다. 말을 시작하기 전이면 7초를 설정하지 않는다.
      return wait({
        ...state,
        phase: "listening",
        silenceStartedAt: state.spoke ? event.at : null,
      });

    case "manualReconnect":
      if (state.phase !== "error" && !isActive(state.phase)) return wait(state);
      if (!event.hasAnswer) return wait(listenFrom(event.at));
      return wait({
        phase: "listening",
        spoke: true,
        listenStartedAt: event.at,
        silenceStartedAt: event.at,
      });

    case "relisten":
      if (state.phase !== "submitting") return wait(state);
      return wait(listenFrom(event.at));

    case "sttError":
      if (!isActive(state.phase)) return wait(state);
      return wait({ ...state, phase: "error", silenceStartedAt: null });

    case "submitStarted":
      // 제출 중에 다시 발생해도(자동 · 수동이 겹침) 한 번만 진행한다.
      if (state.phase !== "error" && !isActive(state.phase)) return wait(state);
      return wait({ ...state, phase: "submitting", silenceStartedAt: null });

    case "tick":
      if (
        state.phase === "listening" &&
        state.silenceStartedAt !== null &&
        event.now - state.silenceStartedAt >= AUTO_SUBMIT_SILENCE_MS
      ) {
        return {
          state: { ...state, phase: "submitting", silenceStartedAt: null },
          decision: "submit",
        };
      }
      if (
        isActive(state.phase) &&
        !state.spoke &&
        state.listenStartedAt !== null &&
        event.now - state.listenStartedAt >= NO_SPEECH_TIMEOUT_MS
      ) {
        return { state: { ...state, phase: "ended", silenceStartedAt: null }, decision: "timeout" };
      }
      return wait(state);
  }
}
