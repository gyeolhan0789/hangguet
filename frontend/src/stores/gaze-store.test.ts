import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { GazeSample } from "@/lib/interview/gaze";

import { GAZE_STORAGE_KEY, SAVE_EVERY_MS, useGazeStore } from "./gaze-store";

// 기준: API 명세 5.8 gazeRatio(면접 동안 면접관을 바라본 시간 비율) · 사용자 결정(2026-11-09: 같은 탭에서 새로고침해도
// 잰 시선을 이어 쓰도록 sessionStorage에 둔다)

const SAMPLE: GazeSample = {
  headYaw: 1,
  headPitch: 2,
  eyeYaw: 0.1,
  eyePitch: 0.2,
  blinking: false,
};

function saved() {
  const raw = sessionStorage.getItem(GAZE_STORAGE_KEY);
  return raw ? JSON.parse(raw) : null;
}

beforeEach(() => {
  vi.useFakeTimers();
  sessionStorage.clear();
  useGazeStore.getState().reset();
});
afterEach(() => vi.useRealTimers());

describe("gaze-store (S06 시선 기록)", () => {
  it("잰 값을 정해진 간격마다 면접 id와 함께 저장한다", () => {
    useGazeStore.getState().start(55);
    useGazeStore.getState().addFrame(SAMPLE);
    expect(saved()).toBeNull();

    vi.advanceTimersByTime(SAVE_EVERY_MS);
    useGazeStore.getState().addFrame(null);

    expect(saved()).toEqual({ sessionId: 55, frames: [SAMPLE, null] });
  });

  it("같은 면접에 다시 들어오면(새로고침) 저장해 둔 값을 이어 쓴다", () => {
    sessionStorage.setItem(GAZE_STORAGE_KEY, JSON.stringify({ sessionId: 55, frames: [SAMPLE] }));

    useGazeStore.getState().start(55);
    useGazeStore.getState().addFrame(null);

    expect(useGazeStore.getState().frames).toEqual([SAMPLE, null]);
  });

  it("다른 면접에 들어오면 지난 면접의 값을 지우고 비운다", () => {
    sessionStorage.setItem(GAZE_STORAGE_KEY, JSON.stringify({ sessionId: 55, frames: [SAMPLE] }));

    useGazeStore.getState().start(56);

    expect(useGazeStore.getState().frames).toEqual([]);
    expect(saved()).toBeNull();
  });

  it("저장 공간을 쓸 수 없어도 메모리의 값으로 계속 잰다", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    useGazeStore.getState().start(55);
    vi.advanceTimersByTime(SAVE_EVERY_MS);

    expect(() => useGazeStore.getState().addFrame(SAMPLE)).not.toThrow();
    expect(useGazeStore.getState().frames).toEqual([SAMPLE]);
    vi.restoreAllMocks();
  });
});
