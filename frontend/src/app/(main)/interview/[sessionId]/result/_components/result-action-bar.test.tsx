// 기준: Figma S07 Sticky Bar(18:2695) · 기획 메모 S07-1(18:3638: S07 [면접 다시보기]로 진입)
// · 모션 메모 S07(18:2705: 페이지 끝에 닿으면 [오늘의 성장 리뷰 보기]가 한 번 통통)
import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ResultActionBar } from "./result-action-bar";

// 경계 mock: 연출(motion). 동작 줄이기 여부와 페이지 끝 도달 여부는 테스트가 정하고, 통통 튀기(animate)는 호출만 본다
const motionState = vi.hoisted(() => ({ reduce: false, inView: false, animate: vi.fn() }));
vi.mock("motion/react", async (importOriginal) => {
  const { useRef } = await import("react");
  return {
    ...(await (await import("@/test/motion")).reducedMotion(importOriginal)),
    useReducedMotion: () => motionState.reduce,
    useInView: () => motionState.inView,
    useAnimate: () => [useRef(null), motionState.animate],
  };
});

const END = { current: null };
const bar = () => <ResultActionBar sessionId={55} reviewDate="2026-10-15" end={END} />;

beforeEach(() => {
  motionState.reduce = false;
  motionState.inView = false;
});

describe("ResultActionBar · 결과 아래 버튼 막대", () => {
  describe("상태 변화", () => {
    it("페이지 끝에 닿으면 [오늘의 성장 리뷰 보기]를 튀긴다", () => {
      const { rerender } = render(bar());
      expect(motionState.animate).not.toHaveBeenCalled();

      motionState.inView = true;
      rerender(bar());

      expect(motionState.animate).toHaveBeenCalledTimes(1);
    });

    it("동작 줄이기면 끝에 닿아도 튀기지 않는다", () => {
      motionState.reduce = true;
      motionState.inView = true;

      render(bar());

      expect(motionState.animate).not.toHaveBeenCalled();
    });
  });

  describe("중복 · 경쟁 처리", () => {
    it("튀긴 뒤 동작 줄이기 설정이 켜졌다 꺼져도 다시 튀기지 않는다", () => {
      motionState.inView = true;
      const { rerender } = render(bar());

      motionState.reduce = true;
      rerender(bar());
      motionState.reduce = false;
      rerender(bar());

      expect(motionState.animate).toHaveBeenCalledTimes(1);
    });
  });
});
