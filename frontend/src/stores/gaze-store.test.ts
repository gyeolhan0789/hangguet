// 기준: API 명세 5.8 gazeRatio(면접 동안 면접관을 바라본 시간 비율)
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { GazeSample } from "@/lib/interview/gaze";

// 경계 mock: 현재 시각은 vi.setSystemTime으로 고정한다. 저장 공간 막힘은 Storage.prototype.setItem spy로 바꾼다.
// 모듈 변수(current · savedAt)가 reset으로 다 지워지지 않아 테스트마다 모듈을 새로 불러온다
async function load() {
  vi.resetModules();
  return import("./gaze-store");
}

// 예시 데이터: 시선 한 프레임(GazeSample 필드)
const SAMPLE: GazeSample = {
  headYaw: 1,
  headPitch: 2,
  eyeYaw: 0.1,
  eyePitch: 0.2,
  blinking: false,
};
const STORAGE_KEY = "a301-gaze";
const START = new Date("2026-11-12T10:00:00+09:00");

function saved() {
  const raw = sessionStorage.getItem(STORAGE_KEY);
  return raw ? JSON.parse(raw) : null;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(START);
  sessionStorage.clear();
});

describe("useGazeStore · 시선 기록", () => {
  describe("정상 처리", () => {
    it("면접을 시작한 뒤 10초가 지나 잰 값을 쌓으면 면접 id와 함께 저장한다", async () => {
      const { useGazeStore } = await load();
      useGazeStore.getState().start(55);
      useGazeStore.getState().addFrame(SAMPLE);

      vi.advanceTimersByTime(10_000);
      useGazeStore.getState().addFrame(null);

      expect(saved()).toEqual({ sessionId: 55, frames: [SAMPLE, null] });
    });
  });

  describe("상태 변화", () => {
    it("같은 면접에 다시 들어오면 저장해 둔 값을 이어 쓴다", async () => {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ sessionId: 55, frames: [SAMPLE] }));
      const { useGazeStore } = await load();

      useGazeStore.getState().start(55);
      useGazeStore.getState().addFrame(null);

      expect(useGazeStore.getState().frames).toEqual([SAMPLE, null]);
    });

    it("다른 면접에 들어오면 저장한 값을 지우고 비운다", async () => {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ sessionId: 55, frames: [SAMPLE] }));
      const { useGazeStore } = await load();

      useGazeStore.getState().start(56);

      expect(useGazeStore.getState().frames).toEqual([]);
      expect(saved()).toBeNull();
    });

    it("reset하면 저장한 값을 지우고 그 뒤로는 저장하지 않는다", async () => {
      const { useGazeStore } = await load();
      useGazeStore.getState().start(55);
      vi.advanceTimersByTime(10_000);
      useGazeStore.getState().addFrame(SAMPLE);

      useGazeStore.getState().reset();
      vi.advanceTimersByTime(10_000);
      useGazeStore.getState().addFrame(SAMPLE);

      expect(useGazeStore.getState().frames).toEqual([SAMPLE]);
      expect(saved()).toBeNull();
    });
  });

  describe("입력 검증", () => {
    it("면접을 시작하기 전에는 잰 값을 저장하지 않는다", async () => {
      const { useGazeStore } = await load();

      useGazeStore.getState().addFrame(SAMPLE);

      expect(useGazeStore.getState().frames).toEqual([SAMPLE]);
      expect(saved()).toBeNull();
    });
  });

  describe("경계값", () => {
    it("마지막 저장 뒤 10초가 되기 전이면 저장하지 않는다", async () => {
      const { useGazeStore } = await load();
      useGazeStore.getState().start(55);

      vi.advanceTimersByTime(9_999);
      useGazeStore.getState().addFrame(SAMPLE);

      expect(saved()).toBeNull();
    });
  });

  describe("오류 처리", () => {
    it("저장한 값이 깨져 있으면(JSON 아님) 비우고 시작한다", async () => {
      sessionStorage.setItem(STORAGE_KEY, "{broken");
      const { useGazeStore } = await load();

      useGazeStore.getState().start(55);

      expect(useGazeStore.getState().frames).toEqual([]);
      expect(saved()).toBeNull();
    });

    it("저장한 frames가 배열이 아니면 비우고 시작한다", async () => {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ sessionId: 55, frames: "SAMPLE" }));
      const { useGazeStore } = await load();

      useGazeStore.getState().start(55);

      expect(useGazeStore.getState().frames).toEqual([]);
    });

    it("저장 공간을 쓸 수 없어도 메모리의 값으로 계속 잰다", async () => {
      vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
        throw new DOMException("full", "QuotaExceededError");
      });
      const { useGazeStore } = await load();
      useGazeStore.getState().start(55);
      vi.advanceTimersByTime(10_000);

      useGazeStore.getState().addFrame(SAMPLE);

      expect(useGazeStore.getState().frames).toEqual([SAMPLE]);
    });
  });
});
