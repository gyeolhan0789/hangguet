// 기준: API 명세 5.2("질문 3 / 5"의 전체 질문 수는 5개로 고정) · AI 명세(질문 seq 1~5로 정확히 5개)

/** 면접 한 번의 질문 수. S06 · S06-B 위 '질문 3 / 5'의 5 */
export const TOTAL_QUESTIONS = 5;

/** 면접 경과 시간(초)을 '08:42'처럼 분:초로 쓴다. 60분이 넘으면 분을 그대로 늘린다('61:05'). */
export function formatElapsed(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safe / 60);
  return `${String(minutes).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
}
