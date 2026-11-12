// 기준: API 명세 5.8 「직전 답변 저장 확인」(answeredCount가 그 답변의 seq 이상이 되면 5.8, 10초(임시 값)가 지나도 반영되지 않으면 그대로 5.8) · S15P31A301-257
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useSaveConfirmed } from "./use-save-confirmed";

// 경계 mock: 기다리는 시간은 가짜 타이머로 진행한다
beforeEach(() => {
  vi.useFakeTimers();
});

const hook = (waiting: boolean, saved: boolean) =>
  renderHook((props) => useSaveConfirmed(props.waiting, props.saved), {
    initialProps: { waiting, saved },
  });

describe("useSaveConfirmed · 직전 답변 저장 확인", () => {
  describe("상태 변화", () => {
    it("기다리지 않으면 저장 여부와 관계없이 확인되지 않은 것으로 둔다", () => {
      const { result } = hook(false, true);

      expect(result.current).toBe(false);
    });

    it("기다리는 중에 저장이 보이면 바로 확인된다", () => {
      const { result, rerender } = hook(true, false);

      rerender({ waiting: true, saved: true });

      expect(result.current).toBe(true);
    });

    it("기다림을 그쳤다가 다시 시작하면 10초를 처음부터 센다", () => {
      const { result, rerender } = hook(true, false);
      act(() => vi.advanceTimersByTime(10_000));

      rerender({ waiting: false, saved: false });
      rerender({ waiting: true, saved: false });
      act(() => vi.advanceTimersByTime(9_999));
      expect(result.current).toBe(false);

      act(() => vi.advanceTimersByTime(1));
      expect(result.current).toBe(true);
    });
  });

  describe("시간 경과", () => {
    it("저장이 보이지 않아도 10초가 되면 확인된 것으로 본다", () => {
      const { result } = hook(true, false);

      act(() => vi.advanceTimersByTime(9_999));
      expect(result.current).toBe(false);

      act(() => vi.advanceTimersByTime(1));
      expect(result.current).toBe(true);
    });
  });
});
