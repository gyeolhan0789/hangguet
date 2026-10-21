import type { RealtimeToken } from "@soniox/client";

import type { TranscriptToken } from "@/types/api";

// 기준: Swagger 5.7 답변 제출 · AnswerRequest.content · AnswerRequest.tokens(TranscriptToken) · API 명세 5.7
// (확정 토큰을 그대로 전송하고 <end> · <fin>은 제외한다, 시각은 답변 음성 파일 시작 기준이며 음성 인식 시각에
// "음성 인식이 수신한 첫 음성의 시작 − 파일 시작"(음수 가능)을 연결마다 더한다, tokens 400 조건)
// 음성 인식 result를 입력받아 자막 · 5.7 content · 5.7 tokens를 만드는 순수 함수들이다. 상태는 변경하지 않고 새 값을 반환한다.

/** 5.7 tokens 최대 개수. 넘으면 400(API 명세 5.7) */
const MAX_ANSWER_TOKENS = 10_000;

/** Soniox 표시 토큰. 끝 감지(<end>) · 수동 확정(<fin>) 신호이므로 글이 아니다 */
const SPECIAL_TOKENS = new Set(["<end>", "<fin>"]);

interface FinalToken {
  text: string;
  /** 음성 인식 시각(그 연결의 음성 시작 기준). 없을 수 있다 */
  startMs: number | undefined;
  endMs: number | undefined;
  /** 이 토큰을 수신한 연결의 offset. 연결 전에 수신했으면 null */
  offsetMs: number | null;
}

export interface Transcript {
  /** 확정 토큰. 수신한 순서대로 쌓는다 */
  readonly finals: readonly FinalToken[];
  /** 현재 연결의 미확정 글. result마다 전체가 변경된다 */
  readonly partial: string;
  /** 현재 연결의 offset(음성 인식 녹음기 시작 − 파일 녹음기 시작, 밀리초). 음수일 수 있다 */
  readonly offsetMs: number | null;
  /** 현재 연결에서 수신한 비공백 토큰 end_ms 최댓값. 연결마다 새로 계산한다 */
  readonly speechEndMs: number | null;
}

export function createTranscript(): Transcript {
  return { finals: [], partial: "", offsetMs: null, speechEndMs: null };
}

/**
 * 새 연결(첫 연결 · 자동 재연결 · 다시 연결)을 시작한다. 확정 토큰은 유지하고, 앞 연결의 미확정 글과
 * end_ms 최댓값은 폐기한다. 새 연결의 음성 인식 시각은 0부터 다시 시작하므로 offset을 새로 설정한다.
 * offset을 모르면 null을 전달한다. 그 연결의 확정 토큰은 시각 없음으로 간주해 tokens를 전송하지 않게 된다.
 */
export function beginConnection(transcript: Transcript, offsetMs: number | null): Transcript {
  return { ...transcript, partial: "", offsetMs, speechEndMs: null };
}

/** result 하나를 반영한다. 확정 토큰은 이어 붙이고 미확정 글은 이번 result의 것으로 변경한다 */
export function applyResult(transcript: Transcript, tokens: readonly RealtimeToken[]): Transcript {
  const finals: FinalToken[] = [];
  let partial = "";
  let speechEndMs = transcript.speechEndMs;
  for (const token of tokens) {
    // SDK도 거르지만 명세 규칙(<end> · <fin>은 제외한다)을 여기서 한 번 더 적용한다.
    if (SPECIAL_TOKENS.has(token.text)) continue;
    if (token.is_final) {
      finals.push({
        text: token.text,
        startMs: token.start_ms,
        endMs: token.end_ms,
        offsetMs: transcript.offsetMs,
      });
    } else {
      partial += token.text;
    }
    if (token.text.trim() !== "" && token.end_ms !== undefined) {
      speechEndMs = speechEndMs === null ? token.end_ms : Math.max(speechEndMs, token.end_ms);
    }
  }
  return {
    ...transcript,
    finals: finals.length > 0 ? [...transcript.finals, ...finals] : transcript.finals,
    partial,
    speechEndMs,
  };
}

/** 확정 글. 토큰 글자를 합치지 않고 그대로 이어 붙인다(공백 토큰 · 앞에 공백이 붙은 토큰 포함) */
function finalText(transcript: Transcript): string {
  return transcript.finals.map((token) => token.text).join("");
}

/** 자막: 확정 글 뒤에 미확정 글을 붙인다 */
export function getCaption(transcript: Transcript): string {
  return finalText(transcript) + transcript.partial;
}

/** 5.7 content: 확정 글의 앞뒤 공백을 제거한다. 미확정 글은 포함하지 않는다 */
export function getContent(transcript: Transcript): string {
  return finalText(transcript).trim();
}

/**
 * 5.7 tokens를 만든다. 시각은 음성 인식 시각 + 그 연결의 offset을 반올림한 밀리초다.
 * 하나라도 400 조건(시각 없음, 0 미만, endMs < startMs, 빈 text, 10,000개 초과)에 해당하면 null을 반환한다.
 * 그대로 전송하면 5.7 전체가 400이 되므로 tokens만 전송하지 않는다(이 경우 말하기 지표만 비게 된다).
 */
export function toAnswerTokens(transcript: Transcript): TranscriptToken[] | null {
  if (transcript.finals.length > MAX_ANSWER_TOKENS) return null;
  const tokens: TranscriptToken[] = [];
  for (const token of transcript.finals) {
    if (token.startMs === undefined || token.endMs === undefined || token.offsetMs === null) {
      return null;
    }
    const startMs = Math.round(token.startMs + token.offsetMs);
    const endMs = Math.round(token.endMs + token.offsetMs);
    if (token.text === "" || startMs < 0 || endMs < startMs) return null;
    tokens.push({ text: token.text, startMs, endMs });
  }
  return tokens;
}
