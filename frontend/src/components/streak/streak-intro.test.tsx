// 기준: 스트릭 불 전환 데모(이정복/S02-1-전환-데모) · 기획 메모 S02-1(미완료 'N일째!' · 끊김 '다시 1일째부터!' · 첫 방문 0일째)
// · 면접을 마친 뒤 'N일째 달성!'(StreakCelebration)은 덮은 채로 끝내고 레벨업을 잇는다
import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { tierOf } from "@/lib/streak";
import { deferred } from "@/test/deferred";
import { flushPromises } from "@/test/flush";

import { StreakIntro, type IntroCopy } from "./streak-intro";

// 경계 mock: 연출(motion). 동작 줄이기 여부는 테스트가 정하고, 움직임(animate)과 대기(delay)는
// 테스트가 끝내는 시점을 정한다(부른 순서대로 쌓아 둔다). 나머지(motion 요소 · 값)는 실제로 돈다.
const motionState = vi.hoisted(() => ({
  reduce: false,
  animations: [] as { finish: () => void; stop: () => void }[],
  delays: [] as { run: () => void; cancel: () => void }[],
}));
vi.mock("motion/react", async (importOriginal) => ({
  ...(await (await import("@/test/motion")).reducedMotion(importOriginal)),
  useReducedMotion: () => motionState.reduce,
  animate: () => {
    const done = deferred();
    const stop = vi.fn();
    motionState.animations.push({ finish: () => done.resolve(), stop });
    return {
      then: (onDone: () => void, onError: (reason: unknown) => void) =>
        done.promise.then(onDone, onError),
      stop,
    };
  },
  delay: (callback: () => void) => {
    const cancel = vi.fn();
    motionState.delays.push({ run: callback, cancel });
    return cancel;
  },
}));

// 예시 데이터: 홈 인트로 문구(lib/home/intro) — 8일째 · 끊김 · 첫 방문
const TIER = tierOf(8);
const DAY_8: IntroCopy = { count: 8, text: "일째!", sub: "푸른 불꽃! 오늘도 태워볼까요?" };
const BROKEN: IntroCopy = {
  count: null,
  text: "다시 1일째부터!",
  sub: "지난 최고 기록 7일 · 다시 넘어봐요",
};
const FIRST: IntroCopy = { count: 0, text: "일째!", sub: "첫 연습을 시작해볼까요?" };

const overlay = () => screen.queryByRole("status");

/** i번째 움직임을 끝낸다 */
const finishAnimation = (i: number) =>
  act(async () => {
    motionState.animations[i].finish();
  });

/** i번째 대기를 끝낸다 */
const endDelay = (i: number) =>
  act(async () => {
    motionState.delays[i].run();
  });

/** 남은 움직임 · 대기를 새로 생기지 않을 때까지 모두 끝낸다 */
async function playToEnd() {
  let finished = 0;
  let ended = 0;
  while (finished < motionState.animations.length || ended < motionState.delays.length) {
    if (finished < motionState.animations.length) await finishAnimation(finished++);
    else await endDelay(ended++);
  }
}

beforeEach(() => {
  motionState.reduce = false;
  motionState.animations = [];
  motionState.delays = [];
});

describe("StreakIntro · 스트릭 불 전환", () => {
  describe("덮개와 문구", () => {
    describe("화면 표시", () => {
      it("처음에는 하루 전 숫자를 보이고 상태 알림은 바뀐 뒤 문구 전체로 읽어 준다", async () => {
        render(<StreakIntro tier={TIER} copy={DAY_8} />);

        const status = screen.getByRole("status", {
          name: "8일째! 푸른 불꽃! 오늘도 태워볼까요?",
        });
        expect(status.textContent).toContain("7일째!");
        await playToEnd();
      });
    });

    describe("경계값", () => {
      it("0일째면 하루 전 숫자를 음수 대신 0으로 보인다", async () => {
        render(<StreakIntro tier={tierOf(0)} copy={FIRST} />);

        expect(overlay()?.textContent).toContain("0일째!");
        expect(overlay()?.textContent).not.toContain("-1");
        await playToEnd();
      });
    });
  });

  describe("연출 순서", () => {
    describe("상태 변화", () => {
      it("원이 화면을 다 덮으면 뒤 화면을 걷어 낸다", async () => {
        render(<StreakIntro tier={TIER} copy={DAY_8} backdrop={<p>홈 스켈레톤</p>} />);

        await finishAnimation(0);

        expect(screen.queryByText("홈 스켈레톤")).toBeNull();
        await playToEnd();
      });

      it("배지가 뜨고 첫 대기가 끝나면 숫자를 N으로 바꾼다", async () => {
        render(<StreakIntro tier={TIER} copy={DAY_8} />);
        await finishAnimation(0);
        await finishAnimation(1);
        expect(overlay()?.textContent).toContain("7일째!");

        await endDelay(0);

        expect(overlay()?.textContent).toContain("8일째!");
        await playToEnd();
      });

      it("숫자가 없는 문구면 숫자 대기 없이 멈춤 대기 한 번만 한다", async () => {
        render(<StreakIntro tier={TIER} copy={BROKEN} />);

        await playToEnd();

        expect(motionState.delays).toHaveLength(1);
      });

      it("연출이 끝나면 원을 걷고 덮개를 없앤 뒤 끝났다고 알린다", async () => {
        const onDone = vi.fn();
        render(<StreakIntro tier={TIER} copy={DAY_8} onDone={onDone} />);
        await finishAnimation(0);
        await finishAnimation(1);
        await endDelay(0);
        await endDelay(1);
        await endDelay(2);
        await finishAnimation(2);
        expect(motionState.animations).toHaveLength(4);
        expect(onDone).not.toHaveBeenCalled();

        await finishAnimation(3);

        expect(overlay()).toBeNull();
        expect(onDone).toHaveBeenCalledTimes(1);
      });

      it("덮은 채로 끝내기면 원을 걷지 않고 덮개를 둔 채 끝났다고 알린다", async () => {
        const onDone = vi.fn();
        render(<StreakIntro tier={TIER} copy={DAY_8} stayCovered onDone={onDone} />);

        await playToEnd();

        expect(motionState.animations).toHaveLength(3);
        expect(overlay()).not.toBeNull();
        expect(onDone).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe("동작 줄이기", () => {
    describe("상태 변화", () => {
      it("동작 줄이기면 덮개를 흐리게 한 뒤 없애고 끝났다고 알린다", async () => {
        motionState.reduce = true;
        const onDone = vi.fn();
        render(<StreakIntro tier={TIER} copy={DAY_8} onDone={onDone} />);
        expect(motionState.animations).toHaveLength(1);
        expect(onDone).not.toHaveBeenCalled();

        await finishAnimation(0);

        expect(overlay()).toBeNull();
        expect(onDone).toHaveBeenCalledTimes(1);
      });

      it("동작 줄이기에 덮은 채로 끝내기면 흐리게 하지 않고 바로 끝났다고 알린다", async () => {
        motionState.reduce = true;
        const onDone = vi.fn();
        render(<StreakIntro tier={TIER} copy={DAY_8} stayCovered onDone={onDone} />);
        await flushPromises();

        expect(motionState.animations).toHaveLength(0);
        expect(onDone).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe("중단과 정리", () => {
    describe("중복 · 경쟁 처리", () => {
      it("연출 중에 끝났을 때 할 일이 바뀌면 끝날 때 새 것을 부른다", async () => {
        const before = vi.fn();
        const after = vi.fn();
        const { rerender } = render(<StreakIntro tier={TIER} copy={DAY_8} onDone={before} />);
        await finishAnimation(0);

        rerender(<StreakIntro tier={TIER} copy={DAY_8} onDone={after} />);
        await playToEnd();

        expect(before).not.toHaveBeenCalled();
        expect(after).toHaveBeenCalledTimes(1);
      });
    });

    describe("정리", () => {
      it("연출 중에 화면을 벗어나면 진행 중인 움직임 · 대기를 멈추고 끝났다고 알리지 않는다", async () => {
        const onDone = vi.fn();
        const { unmount } = render(<StreakIntro tier={TIER} copy={DAY_8} onDone={onDone} />);
        await finishAnimation(0);
        await finishAnimation(1);

        unmount();
        await playToEnd();

        expect(motionState.animations[1].stop).toHaveBeenCalledTimes(1);
        expect(motionState.delays[0].cancel).toHaveBeenCalledTimes(1);
        expect(onDone).not.toHaveBeenCalled();
      });

      it("보이는 동안 뒤 페이지 스크롤을 잠그고 덮개를 없애면 푼다", async () => {
        render(<StreakIntro tier={TIER} copy={DAY_8} />);
        expect(document.documentElement.style.overflow).toBe("hidden");

        await playToEnd();

        expect(document.documentElement.style.overflow).toBe("");
      });
    });
  });
});
