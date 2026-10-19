import { tierOf } from "@/lib/streak";

import type { HomeResponse } from "./types";

/**
 * 홈에 들어올 때마다(로그인 직후 포함) S02-1 인트로를 보여 줄지.
 * 기획 메모의 '하루 1회'는 쓰지 않고 매번 보여 준다. 첫 방문은 축하할 스트릭이 없어 생략한다.
 * S02-L 레벨업은 홈 진입이 아니라 면접을 마치고 스트릭이 올랐을 때(S08 흐름) 보여 주므로 여기서 다루지 않는다.
 */
export function shouldPlayIntro(home: HomeResponse) {
  return home.homeState !== "FIRST_VISIT";
}

export interface IntroCopy {
  /** 카운트업할 숫자. 없으면 text만 보여 준다. */
  count: number | null;
  /** 숫자 뒤에 붙는 말 (count가 없으면 문구 전체) */
  text: string;
  sub: string;
}

/** S02-1 인트로 문구 (기획 메모: 미완료 'N일째!' / 완료 'N일째 달성!' / 끊김 '다시 1일째부터!') */
export function introCopy(home: HomeResponse): IntroCopy {
  const n = home.currentStreak;
  switch (home.homeState) {
    case "DONE_TODAY":
      return { count: n, text: "일째 달성!", sub: "오늘도 해냈어요 — 내일 또 만나요" };
    case "BROKEN":
      return {
        count: null,
        text: "다시 1일째부터!",
        sub: `지난 최고 기록 ${home.bestStreak}일 · 다시 넘어봐요`,
      };
    default:
      return { count: n, text: "일째!", sub: `${tierOf(n).name}! 오늘도 태워볼까요?` };
  }
}
