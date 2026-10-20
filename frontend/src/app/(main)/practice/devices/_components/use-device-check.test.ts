import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CHECK_STAGGER_MS, useDeviceCheck } from "./use-device-check";

// 기준: 모션 메모 S05(18:2492: 위에서부터 하나씩 확인 stagger 0.25s · 마이크 레벨 requestAnimationFrame + Motion value)
// · Figma S05-E(권한 거부) · 기획 메모 S05-E([다시 확인하기] → 권한 재요청)
// 브라우저 경계(getUserMedia · AudioContext · requestAnimationFrame)만 가짜로 바꾸고 hook은 그대로 돌린다.

class FakeTrack extends EventTarget {
  stop = vi.fn();
  constructor(readonly kind: "video" | "audio") {
    super();
  }
}

function fakeStream() {
  const video = new FakeTrack("video");
  const audio = new FakeTrack("audio");
  const stream = {
    getTracks: () => [video, audio],
    getVideoTracks: () => [video],
    getAudioTracks: () => [audio],
  } as unknown as MediaStream;
  return { stream, video, audio };
}

const getUserMedia = vi.fn<(constraints: MediaStreamConstraints) => Promise<MediaStream>>();
const denied = () => new DOMException("Permission denied", "NotAllowedError");

/** 마이크 입력 크기를 정해 둘 수 있는 가짜 AudioContext */
let samples = 0;
const contexts: { close: ReturnType<typeof vi.fn> }[] = [];
class FakeAudioContext {
  close = vi.fn(async () => {});
  resume = vi.fn(async () => {});
  constructor() {
    contexts.push(this);
  }
  createAnalyser() {
    return {
      fftSize: 0,
      getFloatTimeDomainData: (target: Float32Array) => target.fill(samples),
    };
  }
  createMediaStreamSource() {
    return { connect: () => {} };
  }
}

let frames: FrameRequestCallback[] = [];
const nextFrame = () => {
  const pending = frames;
  frames = [];
  pending.forEach((callback) => callback(0));
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia },
  });
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  vi.stubGlobal("AudioContext", FakeAudioContext);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.push(callback);
    return frames.length;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});
  samples = 0;
  contexts.length = 0;
  frames = [];
});

afterEach(() => {
  // globals를 켜지 않아 Testing Library가 자동으로 정리하지 않는다. 앞 테스트의 hook(리스너 · 스트림)이 남지 않게 직접 정리한다.
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  getUserMedia.mockReset();
});

/** 받은 결과가 반영되고 다음 줄로 넘어가는 시간만큼 흘려보낸다. */
const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

describe("useDeviceCheck (S05 장치 점검)", () => {
  it("카메라 · 마이크를 한 번에 요청하고, 카메라 → 0.25초 → 마이크 → 0.25초 → 네트워크 순서로 확인한다", async () => {
    const { stream } = fakeStream();
    getUserMedia.mockResolvedValue(stream);
    const { result } = renderHook(() => useDeviceCheck());
    expect(result.current).toMatchObject({
      camera: "checking",
      mic: "checking",
      network: "checking",
    });

    await advance(0);
    expect(getUserMedia).toHaveBeenCalledWith({ video: true, audio: true });
    expect(result.current).toMatchObject({ camera: "ok", mic: "checking", network: "checking" });
    expect(result.current.stream).toBe(stream);

    await advance(CHECK_STAGGER_MS);
    expect(result.current).toMatchObject({ mic: "ok", network: "checking" });

    await advance(CHECK_STAGGER_MS);
    expect(result.current.network).toBe("ok");
  });

  it("권한을 거부하면(NotAllowedError) 카메라 · 마이크 모두 denied다", async () => {
    getUserMedia.mockRejectedValue(denied());
    const { result } = renderHook(() => useDeviceCheck());

    await advance(CHECK_STAGGER_MS * 2);

    expect(result.current).toMatchObject({ camera: "denied", mic: "denied", network: "ok" });
    expect(result.current.stream).toBeNull();
  });

  it("[다시 확인하기]: 다시 요청해 받으면 두 줄이 확인되고 true를 돌려준다. 그동안 rechecking이다", async () => {
    getUserMedia.mockRejectedValueOnce(denied());
    const { result } = renderHook(() => useDeviceCheck());
    await advance(CHECK_STAGGER_MS * 2);

    const { stream } = fakeStream();
    let resolve!: (value: MediaStream) => void;
    getUserMedia.mockReturnValueOnce(new Promise((r) => (resolve = r)));
    let recheck!: Promise<boolean>;
    act(() => {
      recheck = result.current.recheck();
    });
    expect(result.current.rechecking).toBe(true);
    // 결과가 오기 전까지는 실패 표시를 그대로 둔다(성공하면 초록으로 바뀐다 — 모션 메모 S05-E).
    expect(result.current.camera).toBe("denied");

    resolve(stream);
    await advance(CHECK_STAGGER_MS);

    await expect(recheck).resolves.toBe(true);
    expect(result.current).toMatchObject({ camera: "ok", mic: "ok", rechecking: false });
  });

  it("[다시 확인하기]를 눌러도 여전히 거부되면 false를 돌려주고 두 줄은 denied로 남는다", async () => {
    getUserMedia.mockRejectedValue(denied());
    const { result } = renderHook(() => useDeviceCheck());
    await advance(CHECK_STAGGER_MS * 2);

    let recheck!: Promise<boolean>;
    act(() => {
      recheck = result.current.recheck();
    });
    await advance(CHECK_STAGGER_MS);

    await expect(recheck).resolves.toBe(false);
    expect(result.current).toMatchObject({ camera: "denied", mic: "denied", rechecking: false });
  });

  it("처음 요청이 끝나기 전에 다시 요청하면, 늦게 온 처음 결과는 버리고 그 스트림을 끈다", async () => {
    const first = fakeStream();
    const second = fakeStream();
    let resolveFirst!: (value: MediaStream) => void;
    getUserMedia
      .mockReturnValueOnce(new Promise((r) => (resolveFirst = r)))
      .mockResolvedValueOnce(second.stream);
    const { result } = renderHook(() => useDeviceCheck());

    act(() => void result.current.recheck());
    await advance(0);
    resolveFirst(first.stream);
    await advance(CHECK_STAGGER_MS * 2);

    expect(result.current.stream).toBe(second.stream);
    expect(first.video.stop).toHaveBeenCalled();
    expect(second.video.stop).not.toHaveBeenCalled();
  });

  it("스트림에 카메라 트랙이 없으면 카메라 줄은 missing이다", async () => {
    const audio = new FakeTrack("audio");
    getUserMedia.mockResolvedValue({
      getTracks: () => [audio],
      getVideoTracks: () => [],
      getAudioTracks: () => [audio],
    } as unknown as MediaStream);
    const { result } = renderHook(() => useDeviceCheck());

    await advance(CHECK_STAGGER_MS);

    expect(result.current).toMatchObject({ camera: "missing", mic: "ok" });
  });

  it("HTTPS가 아니어서 mediaDevices가 없으면 두 줄 모두 unsupported다", async () => {
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: undefined });
    const { result } = renderHook(() => useDeviceCheck());

    await advance(CHECK_STAGGER_MS);

    expect(result.current).toMatchObject({ camera: "unsupported", mic: "unsupported" });
  });

  it("점검 중 카메라 연결이 끊기면(track ended) 카메라 줄만 ended로 바뀐다", async () => {
    const { stream, video } = fakeStream();
    getUserMedia.mockResolvedValue(stream);
    const { result } = renderHook(() => useDeviceCheck());
    await advance(CHECK_STAGGER_MS * 2);

    act(() => {
      video.dispatchEvent(new Event("ended"));
    });

    expect(result.current).toMatchObject({ camera: "ended", mic: "ok" });
  });

  // 온라인 · 오프라인 전환 자체는 E2E(context.setOffline)가 본다.
  it("네트워크 줄이 차례가 되어 확인되기 전에 온 온라인 · 오프라인 이벤트는 무시한다", async () => {
    getUserMedia.mockResolvedValue(fakeStream().stream);
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    const { result } = renderHook(() => useDeviceCheck());
    await advance(0);

    act(() => {
      window.dispatchEvent(new Event("offline"));
    });
    expect(result.current.network).toBe("checking");

    await advance(CHECK_STAGGER_MS * 2);
    expect(result.current.network).toBe("offline");
  });

  it("마이크 소리 크기를 매 프레임 level에 넣는다(크기 계산 자체는 media.test.ts)", async () => {
    getUserMedia.mockResolvedValue(fakeStream().stream);
    const { result } = renderHook(() => useDeviceCheck());
    await advance(0);

    samples = 0.1;
    nextFrame();
    expect(result.current.level.get()).toBeGreaterThan(0);

    samples = 0;
    nextFrame();
    expect(result.current.level.get()).toBe(0);
  });

  it("화면을 떠나면 카메라 · 마이크를 끄고 AudioContext를 닫는다", async () => {
    const { stream, video, audio } = fakeStream();
    getUserMedia.mockResolvedValue(stream);
    const { unmount } = renderHook(() => useDeviceCheck());
    await advance(0);

    unmount();

    expect(video.stop).toHaveBeenCalled();
    expect(audio.stop).toHaveBeenCalled();
    expect(contexts[0].close).toHaveBeenCalled();
  });

  it("허용을 기다리는 사이 화면을 떠났다면, 늦게 받은 스트림은 바로 끈다(카메라 켜짐 표시가 남지 않게)", async () => {
    const { stream, video, audio } = fakeStream();
    let resolve!: (value: MediaStream) => void;
    getUserMedia.mockReturnValue(new Promise((r) => (resolve = r)));
    const { unmount } = renderHook(() => useDeviceCheck());

    unmount();
    resolve(stream);
    await advance(0);

    expect(video.stop).toHaveBeenCalled();
    expect(audio.stop).toHaveBeenCalled();
  });
});
