import { describe, expect, it } from "vitest";

import { addDays, todayKst, untilMidnightKst, weekdayOf } from "@/lib/date";
import { nextTierOf, STREAK_TIERS, tierOf, withAlpha } from "@/lib/streak";

import { FIXTURE_TODAY, HOME_BROKEN, HOME_DONE, HOME_FIRST, HOME_NOT_DONE } from "./fixtures";
import { introCopy, shouldPlayIntro } from "./intro";
import { formatReviewImprovement } from "./format";
import { buildWeek } from "./week";

describe("스트릭 단계", () => {
  it.each([
    [0, "스트릭 끊김"],
    [1, "불씨"],
    [2, "불씨"],
    [3, "활활 불꽃"],
    [6, "황금 불꽃"],
    [7, "황금 불꽃"],
    [8, "푸른 불꽃"],
    [13, "푸른 불꽃"],
    [14, "전설의 불꽃"],
    [40, "전설의 불꽃"],
  ])("%i일은 %s", (days, name) => {
    expect(tierOf(days).name).toBe(name);
  });

  it("다음 단계는 순서대로, 마지막 단계 다음은 없다", () => {
    expect(nextTierOf(tierOf(6))?.name).toBe("푸른 불꽃");
    expect(nextTierOf(STREAK_TIERS.at(-1)!)).toBeNull();
  });

  it("색에 투명도를 붙인다", () => {
    expect(withAlpha("#F5A000", 0.4)).toBe("#F5A00066");
  });
});

describe("날짜 (한국 시간)", () => {
  it("UTC 15시 이후는 한국 날짜로 다음 날", () => {
    expect(todayKst(new Date("2026-10-14T15:30:00Z"))).toBe("2026-10-15");
  });

  it("날짜 더하기와 요일", () => {
    expect(addDays("2026-10-01", -1)).toBe("2026-09-30");
    expect(weekdayOf("2026-10-15")).toBe("목");
  });

  it("자정까지 남은 시간", () => {
    expect(untilMidnightKst(new Date("2026-10-15T14:00:00Z"))).toBe("01:00:00");
  });
});

describe("buildWeek", () => {
  const statuses = (home: typeof HOME_NOT_DONE) =>
    buildWeek(home, FIXTURE_TODAY).map((day) => day.status);

  it("오늘 미완료 7일째: 지난 6일 모두 연습, 오늘은 아직", () => {
    expect(statuses(HOME_NOT_DONE)).toEqual([
      "done",
      "done",
      "done",
      "done",
      "done",
      "done",
      "today",
    ]);
    expect(buildWeek(HOME_NOT_DONE, FIXTURE_TODAY).map((day) => day.label)).toEqual([
      "금",
      "토",
      "일",
      "월",
      "화",
      "수",
      "오늘",
    ]);
  });

  it("오늘 완료: 오늘 칸도 체크", () => {
    expect(statuses(HOME_DONE).at(-1)).toBe("today-done");
  });

  it("끊김: 연습한 날만 체크, 나머지는 빠짐", () => {
    expect(statuses(HOME_BROKEN)).toEqual([
      "missed",
      "done",
      "done",
      "done",
      "missed",
      "missed",
      "today",
    ]);
  });

  it("첫 방문: 모두 빈칸, 오늘만 링", () => {
    expect(statuses(HOME_FIRST)).toEqual([
      "empty",
      "empty",
      "empty",
      "empty",
      "empty",
      "empty",
      "today",
    ]);
  });
});

describe("shouldPlayIntro", () => {
  it("오늘 미완료 · 끊김 · 첫 방문은 홈에 들어올 때마다 인트로", () => {
    expect(shouldPlayIntro(HOME_NOT_DONE)).toBe(true);
    expect(shouldPlayIntro(HOME_BROKEN)).toBe(true);
    expect(shouldPlayIntro(HOME_FIRST)).toBe(true);
  });

  it("오늘 완료는 생략 ('N일째 달성!'은 면접을 마친 순간에 띄울 연출)", () => {
    expect(shouldPlayIntro(HOME_DONE)).toBe(false);
  });
});

describe("introCopy", () => {
  it("상태별 문구", () => {
    expect(introCopy(HOME_NOT_DONE)).toMatchObject({
      count: 7,
      text: "일째!",
      sub: "황금 불꽃! 오늘도 태워볼까요?",
    });
    expect(introCopy(HOME_BROKEN)).toMatchObject({ count: null, text: "다시 1일째부터!" });
    expect(introCopy(HOME_FIRST)).toEqual({
      count: 0,
      text: "일째!",
      sub: "첫 연습을 시작해볼까요?",
    });
  });
});

describe("formatReviewImprovement", () => {
  it("오른 기준이 있으면 '전달력 +8'", () => {
    expect(formatReviewImprovement(HOME_BROKEN.recentReviews[0])).toBe("전달력 +8");
  });

  it("첫 연습일(criterion · delta null)이면 null", () => {
    expect(
      formatReviewImprovement({ ...HOME_BROKEN.recentReviews[0], criterion: null, delta: null }),
    ).toBeNull();
  });
});
