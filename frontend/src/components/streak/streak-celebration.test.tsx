// 기준: 기획 메모 S02-1(완료 'N일째 달성!') · S02-L 레벨업 · 면접 끝내기(5.8) 응답의 leveledUp을 화면이 기억해 넘긴다
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { deferred } from "@/test/deferred";
import { flushPromises } from "@/test/flush";

import { StreakCelebration } from "./streak-celebration";

// 경계 mock: 연출(motion)은 동작 줄이기로 건너뛰고, 덮개를 흐리게 하는 움직임(animate)만 테스트가 끝낸다
const motionState = vi.hoisted(() => ({ animations: [] as (() => void)[] }));
vi.mock("motion/react", async (importOriginal) => ({
  ...(await (await import("@/test/motion")).reducedMotion(importOriginal)),
  animate: () => {
    const done = deferred();
    motionState.animations.push(() => done.resolve());
    return {
      then: (onDone: () => void, onError: (reason: unknown) => void) =>
        done.promise.then(onDone, onError),
      stop: vi.fn(),
    };
  },
}));

const finishFade = () =>
  act(async () => {
    motionState.animations[0]();
  });

beforeEach(() => {
  motionState.animations = [];
});

describe("StreakCelebration · 면접 마친 뒤 스트릭 축하", () => {
  describe("화면 표시", () => {
    it("'N일째 달성!' 불 전환을 먼저 보여 준다", async () => {
      render(<StreakCelebration days={8} leveledUp={false} />);

      expect(
        screen.getByRole("status", { name: "8일째 달성! 오늘도 해냈어요 — 내일 또 만나요" }),
      ).toBeDefined();
      await finishFade();
    });
  });

  describe("사용자 조작", () => {
    it("레벨업에서 [계속하기]를 누르면 레벨업을 닫고 끝났다고 알린다", async () => {
      const onDone = vi.fn();
      render(<StreakCelebration days={8} leveledUp onDone={onDone} />);
      await flushPromises();

      fireEvent.click(screen.getByRole("button", { name: "계속하기" }));

      expect(screen.queryByRole("dialog")).toBeNull();
      expect(onDone).toHaveBeenCalledTimes(1);
    });
  });

  describe("상태 변화", () => {
    it("단계가 그대로면 불 전환이 끝난 뒤 아무것도 남기지 않고 끝났다고 알린다", async () => {
      const onDone = vi.fn();
      const { container } = render(
        <StreakCelebration days={7} leveledUp={false} onDone={onDone} />,
      );

      await finishFade();

      expect(container.firstChild).toBeNull();
      expect(onDone).toHaveBeenCalledTimes(1);
    });

    it("단계가 올랐으면 불 전환 뒤 레벨업을 띄우고 아직 끝났다고 알리지 않는다", async () => {
      const onDone = vi.fn();
      render(<StreakCelebration days={8} leveledUp onDone={onDone} />);

      await flushPromises();

      expect(screen.getByRole("dialog", { name: "푸른 불꽃 달성!" })).toBeDefined();
      expect(screen.queryByRole("status")).toBeNull();
      expect(onDone).not.toHaveBeenCalled();
    });
  });
});
