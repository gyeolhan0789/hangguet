import { describe, expect, it } from "vitest";

import { REPLAY, RESULT } from "@/test/result-examples";

import {
  CRITERION_LABEL,
  GRADE_LABEL,
  durationMinutes,
  firstOpenQuestion,
  itemIndexAt,
  monthDayKst,
  questionOffset,
} from "./format";

// 기준: 기준 이름 · grade 문구는 화면이 바꾸고, 질문별 피드백은 첫 번째 WEAK · NORMAL 질문만 펼친다
// · 자막은 재생 위치가 속한 질문(questionCreatedAt ≤ 위치 < 다음 질문)의 answer · 웹 Swagger 6.3 · 6.4 200 예시

describe("S07 · S07-1 표시 규칙", () => {
  it("기준 이름 · 등급 문구를 화면 문구로 바꾼다", () => {
    expect(CRITERION_LABEL).toEqual({
      JOB_FIT: "직무 적합성",
      COVER_LETTER: "자소서 검증",
      LOGIC: "논리성",
      DELIVERY: "전달력",
    });
    expect(GRADE_LABEL).toEqual({ GOOD: "좋아요", NORMAL: "보통", WEAK: "아쉬워요" });
  });

  it("면접 시간은 시작 · 종료 차이를 분으로 내린다(예시 12:00 → 12:18 = 18분)", () => {
    expect(durationMinutes(RESULT.startedAt, RESULT.endedAt)).toBe(18);
    expect(durationMinutes("2026-10-15T12:00:00+09:00", "2026-10-15T12:18:59+09:00")).toBe(18);
    // 종료가 시작보다 앞서면(시각 오차) 0분
    expect(durationMinutes("2026-10-15T12:00:00+09:00", "2026-10-15T11:59:58+09:00")).toBe(0);
  });

  it("상단 날짜는 한국 시간 기준 'M월 D일'이다(UTC로 와도 한국 날짜)", () => {
    expect(monthDayKst(REPLAY.startedAt)).toBe("10월 15일");
    expect(monthDayKst("2026-10-15T15:30:00Z")).toBe("10월 16일");
  });

  it("처음 펼칠 질문은 첫 번째 '보통' · '아쉬워요' 질문이고, 모두 '좋아요'면 없다", () => {
    // 예시: Q1 · Q2 좋아요, Q3 보통, Q4 아쉬워요
    expect(firstOpenQuestion(RESULT.answers)).toBe(303);
    expect(
      firstOpenQuestion(RESULT.answers.map((answer) => ({ ...answer, grade: "GOOD" as const }))),
    ).toBeNull();
    expect(firstOpenQuestion([])).toBeNull();
  });

  it("질문 위치(초)는 녹화 시작과 질문을 낸 시각의 차이다(예시 마커 00:42 · 03:10 · 06:12 · 10:05 · 14:30)", () => {
    expect(REPLAY.items.map((item) => questionOffset(REPLAY.startedAt, item))).toEqual([
      42, 190, 372, 605, 870,
    ]);
  });

  it("질문 시각이 녹화 시작보다 앞서면(1~2초 오차) 위치는 0초다", () => {
    const early = { ...REPLAY.items[0], questionCreatedAt: "2026-10-15T11:59:59+09:00" };
    expect(questionOffset(REPLAY.startedAt, early)).toBe(0);
  });

  it("재생 위치가 속한 질문은 '질문 시각 ≤ 위치 < 다음 질문'이고, 첫 질문 전이면 -1", () => {
    const offsets = [42, 190, 372];
    expect(itemIndexAt(offsets, 0)).toBe(-1);
    expect(itemIndexAt(offsets, 41.9)).toBe(-1);
    expect(itemIndexAt(offsets, 42)).toBe(0);
    expect(itemIndexAt(offsets, 189.9)).toBe(0);
    expect(itemIndexAt(offsets, 190)).toBe(1);
    expect(itemIndexAt(offsets, 10_000)).toBe(2);
    expect(itemIndexAt([], 100)).toBe(-1);
  });
});
