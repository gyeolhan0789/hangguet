import type { RealtimeToken } from "@soniox/client";

// 기준: API 명세 5.11 화상 문장 끝(끝 감지 <end>를 수신했을 때 확정된 글이 종결어미 -다·-요·-까·-죠로 끝나면 문장 끝,
// 글 끝 마침표 · 물음표 · 느낌표 · 말줄임표와 공백은 제외하고 판단하며 쉼표로 끝나면 아님, 미확정 토큰이 남아 있으면 아님,
// 아니면 다음 끝 감지까지 이어 붙임,
// pauseMs = 끝 감지 응답의 total_audio_proc_ms − 문장 마지막 확정 토큰 end_ms, 음수면 0)
// · Swagger 5.11 ReactionRequest(text 1~1,000자 · 공백만 불가, pauseMs 0 이상)
// 음성 인식 result와 끝 감지를 입력받아 5.11로 전송할 문장을 만드는 순수 함수들이다. 상태는 변경하지 않고 새 값을 반환한다.

/** 종결어미(API 명세 5.11). 문장부호를 제외한 글의 마지막 글자로 판단한다 */
const SENTENCE_ENDINGS = new Set(["다", "요", "까", "죠"]);

/** 글 끝에서 제외하고 판단하는 문장부호. 쉼표는 이어지는 말이므로 제외하지 않는다 */
const TRAILING_MARKS = /[.?!…\s]+$/u;

/** 5.11 text 최대 글자 수(mock ReactionRequest @Size(max = 1_000)). 넘는 경우의 처리는 명세에 없다 */
const MAX_SENTENCE_LENGTH = 1_000;

export interface SentenceState {
  /** 아직 문장 끝을 만나지 않은 확정 글. 끝 감지를 지나도 문장 끝이 아니면 이어 붙인다 */
  readonly text: string;
  /** text 마지막 비공백 확정 토큰의 end_ms(현재 연결 기준). 모르면 null */
  readonly lastEndMs: number | null;
  /** 현재 result에 미확정 토큰이 남아 있는지 */
  readonly pending: boolean;
}

export interface Sentence {
  text: string;
  pauseMs: number;
}

export function createSentenceState(): SentenceState {
  return { text: "", lastEndMs: null, pending: false };
}

/**
 * 새 연결을 시작한다. 음성 인식 시각이 0부터 다시 시작하므로 앞 연결의 end_ms는 폐기하고 글은 유지한다.
 * 그 글이 다음 끝 감지에서 문장 끝이 되면 쉰 시간을 알 수 없으므로 pauseMs는 0이다.
 */
export function beginSentenceConnection(state: SentenceState): SentenceState {
  return { ...state, lastEndMs: null, pending: false };
}

/** result 하나를 반영한다. 확정 토큰만 이어 붙이고, 미확정 토큰이 남았는지 기록한다 */
export function applySentenceResult(
  state: SentenceState,
  tokens: readonly RealtimeToken[],
): SentenceState {
  let { text, lastEndMs } = state;
  let pending = false;
  for (const token of tokens) {
    if (!token.is_final) {
      pending = true;
      continue;
    }
    text += token.text;
    if (token.text.trim() !== "" && token.end_ms !== undefined) lastEndMs = token.end_ms;
  }
  return { text, lastEndMs, pending };
}

/** 문장부호와 공백을 제외한 글이 종결어미로 끝나는지 판단한다. 쉼표로 끝나면 문장 끝이 아니다 */
export function endsWithSentenceEnding(text: string): boolean {
  const body = text.replace(TRAILING_MARKS, "");
  const last = body.at(-1);
  return last !== undefined && SENTENCE_ENDINGS.has(last);
}

/**
 * 끝 감지(<end>)를 수신했을 때 호출한다. 문장 끝이면 전송할 문장을 반환하고 글을 초기화한다.
 * 미확정 토큰이 남았거나 종결어미로 끝나지 않으면 문장 끝이 아니며, 글은 다음 끝 감지까지 유지한다.
 */
export function handleEndpoint(
  state: SentenceState,
  totalAudioProcMs: number,
): { state: SentenceState; sentence: Sentence | null } {
  if (state.pending || !endsWithSentenceEnding(state.text)) return { state, sentence: null };
  const next = createSentenceState();
  const text = state.text.trim();
  if (text === "") return { state: next, sentence: null };
  const pauseMs = state.lastEndMs === null ? 0 : Math.max(0, totalAudioProcMs - state.lastEndMs);
  // FE 임시 처리, 명세 미정: 1,000자를 넘으면 문장 끝 쪽 1,000자만 전송한다(리액션은 끝맺은 말을 대상으로 하므로).
  return { state: next, sentence: { text: text.slice(-MAX_SENTENCE_LENGTH).trim(), pauseMs } };
}
