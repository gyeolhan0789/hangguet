// 기준: 사용자 결정(2026-11-04: 오리 면접 화면에 배경음을 작게 반복 재생, 결과 분석으로 넘어가면 천천히 줄이며 멈춤)
// · Chrome 자동 재생 정책(사용자 동작 전에 만든 AudioContext는 suspended — 누르거나 키를 누르면 resume)
import { fireEvent, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { deferred } from "@/test/deferred";
import { flushPromises } from "@/test/flush";

// 경계 mock: Web Audio(AudioContext)와 파일 받기(fetch). 오디오 · 받은 파일은 모듈 수준에 두므로 테스트마다 모듈을 새로 불러온다
const DECODED = { duration: 30 } as AudioBuffer;

function gainNode() {
  return {
    gain: {
      value: 1,
      setTargetAtTime: vi.fn(),
      cancelScheduledValues: vi.fn(),
      setValueAtTime: vi.fn(),
    },
    connect: vi.fn(),
    disconnect: vi.fn(),
  };
}
function sourceNode() {
  return {
    buffer: null as AudioBuffer | null,
    loop: false,
    connect: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    disconnect: vi.fn(),
  };
}

class FakeAudioContext {
  static created: FakeAudioContext[] = [];
  currentTime = 0;
  destination = {};
  gains: ReturnType<typeof gainNode>[] = [];
  sources: ReturnType<typeof sourceNode>[] = [];
  resume = vi.fn(() => Promise.resolve());
  decodeAudioData = vi.fn(() => Promise.resolve(DECODED));
  constructor() {
    FakeAudioContext.created.push(this);
  }
  createGain() {
    const gain = gainNode();
    this.gains.push(gain);
    return gain;
  }
  createBufferSource() {
    const source = sourceNode();
    this.sources.push(source);
    return source;
  }
}

const fetchFile = vi.fn();
const FILE = { ok: true, status: 200, arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) };

async function renderAmbience(active: boolean) {
  vi.resetModules();
  const { useDuckAmbience } = await import("./duck-ambience");
  const hook = renderHook(({ on }) => useDuckAmbience(on), { initialProps: { on: active } });
  await flushPromises();
  return hook;
}
const audio = () => FakeAudioContext.created[0];

beforeEach(() => {
  FakeAudioContext.created = [];
  vi.stubGlobal("AudioContext", FakeAudioContext);
  vi.stubGlobal("fetch", fetchFile);
  fetchFile.mockResolvedValue(FILE);
});

describe("useDuckAmbience · 오리 면접 배경음", () => {
  describe("사용자 조작", () => {
    it("화면이나 키를 누르면 멈춰 있던 소리를 다시 켠다", async () => {
      await renderAmbience(true);
      audio().resume.mockClear();

      fireEvent.pointerDown(window);
      fireEvent.keyDown(window, { key: "a" });

      expect(audio().resume).toHaveBeenCalledTimes(2);
    });
  });

  describe("정상 처리", () => {
    it("켜지면 배경음을 받아 튼다", async () => {
      await renderAmbience(true);

      expect(audio().sources).toHaveLength(1);
      expect(audio().sources[0].start).toHaveBeenCalledTimes(1);
    });
  });

  describe("입력 검증", () => {
    it("꺼져 있으면 오디오를 만들지 않는다", async () => {
      await renderAmbience(false);

      expect(FakeAudioContext.created).toHaveLength(0);
      expect(fetchFile).not.toHaveBeenCalled();
    });
  });

  describe("오류 처리", () => {
    it("파일을 받지 못하면 배경음 없이 진행하고 다음에 켤 때 다시 받는다", async () => {
      fetchFile.mockResolvedValueOnce({ ok: false, status: 404 });
      const { rerender } = await renderAmbience(true);
      expect(audio().sources).toHaveLength(0);

      rerender({ on: false });
      rerender({ on: true });
      await flushPromises();

      expect(fetchFile).toHaveBeenCalledTimes(2);
      expect(audio().sources).toHaveLength(1);
    });
  });

  describe("중복 · 경쟁 처리", () => {
    it("받아 둔 파일은 다시 켤 때 다시 받지 않는다", async () => {
      const { rerender } = await renderAmbience(true);

      rerender({ on: false });
      rerender({ on: true });
      await flushPromises();

      expect(fetchFile).toHaveBeenCalledTimes(1);
      expect(audio().sources).toHaveLength(2);
    });

    it("파일을 받는 중 꺼지면 늦게 받은 소리를 틀지 않는다", async () => {
      const response = deferred<typeof FILE>();
      fetchFile.mockReturnValue(response.promise);
      const { rerender } = await renderAmbience(true);

      rerender({ on: false });
      response.resolve(FILE);
      await flushPromises();

      expect(audio().sources).toHaveLength(0);
    });
  });

  describe("시간 경과", () => {
    it("꺼지고 2초가 지나면 소리를 멈추고 연결을 끊는다", async () => {
      vi.useFakeTimers();
      const { rerender } = await renderAmbience(true);
      const [source] = audio().sources;
      const [gain] = audio().gains;

      rerender({ on: false });
      vi.advanceTimersByTime(1999);
      expect(source.stop).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);

      expect(source.stop).toHaveBeenCalledTimes(1);
      expect(source.disconnect).toHaveBeenCalledTimes(1);
      expect(gain.disconnect).toHaveBeenCalledTimes(1);
    });
  });

  describe("정리", () => {
    it("꺼지면 누르기 · 키 리스너를 뗀다", async () => {
      const { rerender } = await renderAmbience(true);
      rerender({ on: false });
      audio().resume.mockClear();

      fireEvent.pointerDown(window);
      fireEvent.keyDown(window, { key: "a" });

      expect(audio().resume).not.toHaveBeenCalled();
    });
  });
});
