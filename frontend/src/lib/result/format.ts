import type { AnswerFeedback, Criterion, Grade, OffsetDateTime, ReplayItem } from "@/types/api";

// S07 · S07-1 화면 표시 규칙.
// 기준: 기준 이름 JOB_FIT → 직무 적합성 · COVER_LETTER → 자소서 검증 · LOGIC → 논리성 · DELIVERY → 전달력,
// grade 문구는 화면이 바꾼다, 질문별 피드백은 첫 번째 WEAK · NORMAL 질문만 펼친다 · 기획 메모 S07(18:762: 좋아요 · 보통 · 아쉬워요)
// · ResultResponse.startedAt('18분'은 endedAt과의 차이) · ReplayItem.questionCreatedAt(startedAt과의 차이(초)가 영상 속 질문 위치)
// · ReplayResponse.startedAt(상단 날짜) · 자막은 재생 위치가 속한 질문(questionCreatedAt ≤ 위치 < 다음 질문)의 answer

export const CRITERION_LABEL: Record<Criterion, string> = {
  JOB_FIT: "직무 적합성",
  COVER_LETTER: "자소서 검증",
  LOGIC: "논리성",
  DELIVERY: "전달력",
};

/** 답하지 않은 질문의 답변 자리 안내. S07-1 펼친 답변 칸 · 자막(사용자 결정 2026-10-28) */
export const NO_ANSWER = "답변하지 않은 질문이에요";

export const GRADE_LABEL: Record<Grade, string> = {
  GOOD: "좋아요",
  NORMAL: "보통",
  WEAK: "아쉬워요",
};

/** 면접 시간(분). '18분' */
export function durationMinutes(startedAt: OffsetDateTime, endedAt: OffsetDateTime): number {
  return Math.max(0, Math.floor((Date.parse(endedAt) - Date.parse(startedAt)) / 60_000));
}

const KST_MONTH_DAY = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  month: "long",
  day: "numeric",
});

/** 한국 시간 '10월 15일' */
export function monthDayKst(at: OffsetDateTime): string {
  return KST_MONTH_DAY.format(new Date(at));
}

/** 처음에 펼쳐 둘 질문: 첫 번째 '보통' · '아쉬워요' 질문. 없으면 null */
export function firstOpenQuestion(answers: AnswerFeedback[]): number | null {
  return answers.find((answer) => answer.grade !== "GOOD")?.questionId ?? null;
}

/** 영상 속 질문 위치(초). 녹화 시작(startedAt)과 질문을 낸 시각의 차이 */
export function questionOffset(startedAt: OffsetDateTime, item: ReplayItem): number {
  return Math.max(0, (Date.parse(item.questionCreatedAt) - Date.parse(startedAt)) / 1000);
}

/** 재생 위치(초)가 속한 질문의 순번(0부터). 첫 질문 전이면 -1 */
export function itemIndexAt(offsets: number[], time: number): number {
  let index = -1;
  offsets.forEach((offset, i) => {
    if (offset <= time) index = i;
  });
  return index;
}
