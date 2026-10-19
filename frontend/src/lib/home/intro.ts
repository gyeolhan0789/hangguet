import type { IntroCopy } from "@/components/streak/streak-intro";
import { tierOf } from "@/lib/streak";

import type { HomeResponse } from "./types";

/**
 * 홈에 들어올 때마다(로그인 직후 포함) S02-1 인트로를 보여 줄지.
 * 기획 메모의 '하루 1회'는 쓰지 않고 매번 보여 준다. 첫 방문도 끊김처럼 0일 전환을 보여 준다.
 * 오늘 완료는 'N일째 달성!'을 면접을 마친 순간(StreakCelebration, S08 흐름)에 한 번 보여 주므로,
 * 홈에 다시 들어올 때마다 되풀이하지 않도록 생략한다. S02-L 레벨업도 그때 함께 띄운다.
 */
export function shouldPlayIntro(home: HomeResponse) {
  return home.homeState !== "DONE_TODAY";
}

/** S02-1 인트로 문구 (기획 메모: 미완료 'N일째!' / 끊김 '다시 1일째부터!' · 첫 방문은 0일째에 아래 문구만 다르게) */
export function introCopy(home: HomeResponse): IntroCopy {
  const n = home.currentStreak;
  switch (home.homeState) {
    case "BROKEN":
      return {
        count: null,
        text: "다시 1일째부터!",
        sub: `지난 최고 기록 ${home.bestStreak}일 · 다시 넘어봐요`,
      };
    case "FIRST_VISIT":
      return { count: 0, text: "일째!", sub: "첫 연습을 시작해볼까요?" };
    default:
      return { count: n, text: "일째!", sub: `${tierOf(n).name}! 오늘도 태워볼까요?` };
  }
}
