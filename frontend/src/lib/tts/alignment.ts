// 기준: API 명세 5.12(글자별 발음 시각) · ElevenLabs stream-input 공식 API 문서(응답 alignment: chars · charStartTimesMs
// · charDurationsMs, 시각은 전체 음성이 아니라 그 응답 조각 기준). TTS는 timeline · 재생 시계 · 말하는 중 여부만 전달한다.

/** stream-input 응답 조각의 글자별 발음 시각. 시각은 그 조각 맨 앞이 0이다 */
export interface TtsAlignment {
  chars: string[];
  charStartTimesMs: number[];
  charDurationsMs: number[];
}

/** 질문 음성 맨 앞을 0으로 한 글자 하나의 발음 시각(ms) */
export interface TimelineChar {
  char: string;
  startMs: number;
  endMs: number;
}

/** 수신한 순서대로 누적한 음성 조각 하나 */
export interface AlignedChunk {
  /** 이 조각 음성의 길이(ms) */
  durationMs: number;
  /** 입력 글 기준 alignment. 없을 수 있다 */
  alignment: TtsAlignment | null;
}

function isUsable(alignment: TtsAlignment | null): alignment is TtsAlignment {
  if (!alignment) return false;
  const { chars, charStartTimesMs, charDurationsMs } = alignment;
  return chars.length === charStartTimesMs.length && chars.length === charDurationsMs.length;
}

/**
 * 조각별 발음 시각을 질문 전체 기준 timeline으로 이어 붙인다. 조각 시각에 앞 조각들의 길이를 더한다.
 * normalizedAlignment가 아니라 alignment(입력 글 기준)를 사용한다. 화면의 질문 글과 글자가 일치해야 하기 때문이다.
 * alignment가 없거나 세 배열 길이가 다른 조각은 글자를 추가하지 않고 길이만 더한다(timeline에 구멍이 생겨도 재생은 계속한다).
 */
export function buildTimeline(chunks: readonly AlignedChunk[]): TimelineChar[] {
  const timeline: TimelineChar[] = [];
  let offsetMs = 0;
  for (const { durationMs, alignment } of chunks) {
    if (isUsable(alignment)) {
      alignment.chars.forEach((char, i) => {
        const startMs = offsetMs + alignment.charStartTimesMs[i];
        timeline.push({ char, startMs, endMs: startMs + alignment.charDurationsMs[i] });
      });
    }
    offsetMs += durationMs;
  }
  return timeline;
}

/**
 * 음성 전체 길이를 조각 바이트 수에 비례해 나눈다. 수신한 조각을 모아 한 번에 디코드하므로 조각마다의 길이는 따로 알 수 없다.
 * 바이트 수가 재생 시간에 비례하는 형식(고정 비트레이트 MP3, PCM)을 전제한다. 기본 MP3는 로컬 실측(2026-10-21)에서 128kbps 고정 비트레이트였다.
 */
export function splitDurationByBytes(
  byteLengths: readonly number[],
  totalDurationMs: number,
): number[] {
  const totalBytes = byteLengths.reduce((sum, bytes) => sum + bytes, 0);
  if (totalBytes === 0) return byteLengths.map(() => 0);
  return byteLengths.map((bytes) => (totalDurationMs * bytes) / totalBytes);
}
