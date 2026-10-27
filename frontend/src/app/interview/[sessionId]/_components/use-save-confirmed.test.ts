import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { SAVE_WAIT_MS, useSaveConfirmed } from "./use-save-confirmed";

// 기준: API 명세 5.8 「직전 답변 저장 확인」(answeredCount가 그 답변의 seq 이상이 되면 5.8, 10초(임시 값)가 지나도 반영되지 않으면 그대로 5.8)

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const hook = (waiting: boolean, saved: boolean) =>
  renderHook((props) => useSaveConfirmed(props.waiting, props.saved), {
    initialProps: { waiting, saved },
  });

it("기다리지 않으면 확인되지 않은 것으로 둔다(저장 여부와 무관)", () => {
  const { result } = hook(false, true);
  expect(result.current).toBe(false);
});

it("기다리는 중에 저장이 보이면 바로 확인된다", () => {
  const { result, rerender } = hook(true, false);
  expect(result.current).toBe(false);
  rerender({ waiting: true, saved: true });
  expect(result.current).toBe(true);
});

it("저장이 보이지 않아도 기다린 지 10초가 지나면 확인된 것으로 본다", () => {
  const { result } = hook(true, false);
  act(() => vi.advanceTimersByTime(SAVE_WAIT_MS - 1));
  expect(result.current).toBe(false);
  act(() => vi.advanceTimersByTime(1));
  expect(result.current).toBe(true);
});

it("기다림을 그쳤다가 다시 시작하면 10초를 처음부터 다시 센다", () => {
  const { result, rerender } = hook(true, false);
  act(() => vi.advanceTimersByTime(SAVE_WAIT_MS));
  expect(result.current).toBe(true);

  rerender({ waiting: false, saved: false });
  expect(result.current).toBe(false);
  rerender({ waiting: true, saved: false });
  expect(result.current).toBe(false);
  act(() => vi.advanceTimersByTime(SAVE_WAIT_MS - 1));
  expect(result.current).toBe(false);
  act(() => vi.advanceTimersByTime(1));
  expect(result.current).toBe(true);
});
