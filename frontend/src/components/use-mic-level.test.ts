// 기준: 모션 메모 S05(18:2492: 마이크 레벨은 requestAnimationFrame + Motion value) · 모션 메모 S06(18:2569) · MDN AnalyserNode.getFloatTimeDomainData
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useMicLevel } from "./use-mic-level";

// 경계 mock: 브라우저 AudioContext(분석기가 테스트가 정한 표본으로 채운다) · 프레임은 가짜 타이머로 진행
let sample = 0;
let contexts: FakeAudioContext[] = [];
class FakeAudioContext {
  resume = vi.fn(async () => {});
  close = vi.fn(async () => {});
  constructor() {
    contexts.push(this);
  }
  createAnalyser() {
    return {
      fftSize: 0,
      getFloatTimeDomainData: (target: Float32Array) => target.fill(sample),
    };
  }
  createMediaStreamSource() {
    return { connect: () => {} };
  }
}

/** 마이크 트랙이 count개인 스트림(테스트마다 한 번 만든다) */
const streamWith = (count: number) =>
  ({
    getAudioTracks: () => Array.from({ length: count }, () => ({ kind: "audio" })),
  }) as unknown as MediaStream;

/** RMS가 -35dB인 표본 값(소리 크기 0.5) */
const HALF = 10 ** (-35 / 20);

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("AudioContext", FakeAudioContext);
  sample = 0;
  contexts = [];
});

describe("useMicLevel · 마이크 소리 크기", () => {
  describe("사용자 조작", () => {
    it("화면을 처음 누르면 멈춰 있던 소리 재기를 다시 깨운다", () => {
      const stream = streamWith(1);
      renderHook(() => useMicLevel(stream));
      expect(contexts[0].resume).toHaveBeenCalledTimes(1);

      window.dispatchEvent(new Event("pointerdown"));

      expect(contexts[0].resume).toHaveBeenCalledTimes(2);
    });
  });

  describe("정상 처리", () => {
    it("마이크 스트림이 있으면 매 프레임 소리 크기를 값에 넣는다", () => {
      const stream = streamWith(1);
      const { result } = renderHook(() => useMicLevel(stream));
      sample = HALF;

      vi.advanceTimersToNextFrame();

      expect(result.current.get()).toBeCloseTo(0.5, 5);
    });
  });

  describe("경계값", () => {
    it.each([
      { label: "없음", stream: null },
      { label: "마이크 트랙 0개", stream: streamWith(0) },
    ])("스트림이 '$label'이면 소리를 재지 않고 0이다", ({ stream }) => {
      const { result } = renderHook(() => useMicLevel(stream));
      sample = HALF;

      vi.advanceTimersToNextFrame();

      expect(result.current.get()).toBe(0);
      expect(contexts).toHaveLength(0);
    });
  });

  describe("정리", () => {
    it("화면을 떠나면 프레임을 멈추고 값을 0으로 돌리고 AudioContext를 닫으며, 눌러도 다시 깨우지 않는다", () => {
      const stream = streamWith(1);
      const { result, unmount } = renderHook(() => useMicLevel(stream));
      sample = HALF;
      vi.advanceTimersToNextFrame();
      const level = result.current;

      unmount();
      vi.advanceTimersToNextFrame();
      window.dispatchEvent(new Event("pointerdown"));

      expect(level.get()).toBe(0);
      expect(contexts[0].close).toHaveBeenCalledTimes(1);
      expect(contexts[0].resume).toHaveBeenCalledTimes(1);
    });

    it("스트림이 바뀌면 앞 스트림의 소리 재기를 닫고 새로 잰다", () => {
      const { result, rerender } = renderHook(({ stream }) => useMicLevel(stream), {
        initialProps: { stream: streamWith(1) },
      });

      rerender({ stream: streamWith(1) });
      sample = HALF;
      vi.advanceTimersToNextFrame();

      expect(contexts[0].close).toHaveBeenCalledTimes(1);
      expect(contexts).toHaveLength(2);
      expect(contexts[1].close).not.toHaveBeenCalled();
      expect(result.current.get()).toBeCloseTo(0.5, 5);
    });
  });
});
