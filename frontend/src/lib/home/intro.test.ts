// @vitest-environment node
// 기준: 기획 메모 S02-1(미완료 'N일째!' · 끊김 '다시 1일째부터!' · 첫 방문은 0일째) · 웹 Swagger 3.1 homeState
// · 오늘 완료는 면접을 마친 순간(StreakCelebration)에 한 번 보여 주므로 홈에서는 생략한다
import { describe, expect, it } from "vitest";

import { HOME_BROKEN, HOME_DONE, HOME_FIRST, HOME_NOT_DONE } from "./fixtures";
import { introCopy, shouldPlayIntro } from "./intro";

describe("shouldPlayIntro · 홈 인트로 여부", () => {
  describe("정상 처리", () => {
    it("오늘 아직이면 인트로를 보여 준다", () => {
      expect(shouldPlayIntro(HOME_NOT_DONE)).toBe(true);
    });

    it("오늘 연습을 마쳤으면(DONE_TODAY) 인트로를 건너뛴다", () => {
      expect(shouldPlayIntro(HOME_DONE)).toBe(false);
    });
  });
});

describe("introCopy · 홈 인트로 문구", () => {
  describe("정상 처리", () => {
    it("오늘 아직이면 연속 일수를 세고 그 단계 이름으로 부른다", () => {
      expect(introCopy(HOME_NOT_DONE)).toEqual({
        count: 7,
        text: "일째!",
        sub: "황금 불꽃! 오늘도 태워볼까요?",
      });
    });

    it("끊겼으면 숫자 없이 '다시 1일째부터!'와 지난 최고 기록을 보여 준다", () => {
      expect(introCopy(HOME_BROKEN)).toEqual({
        count: null,
        text: "다시 1일째부터!",
        sub: "지난 최고 기록 7일 · 다시 넘어봐요",
      });
    });

    it("첫 방문이면 0일째와 첫 연습 안내를 보여 준다", () => {
      expect(introCopy(HOME_FIRST)).toEqual({
        count: 0,
        text: "일째!",
        sub: "첫 연습을 시작해볼까요?",
      });
    });
  });
});
