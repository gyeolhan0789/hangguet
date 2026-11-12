// 기준: Figma S05(18:2333) 카메라 · 마이크 · 네트워크 체크 줄 · S05-E(18:4013) 권한 거부 · 기획 메모 S05-E(18:3468: [다시 확인하기] → 권한 재요청)
// · 모션 메모 S05(18:2492: 위에서부터 하나씩 확인 stagger 0.25s)
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { deferred } from "@/test/deferred";

import { CHECK_STAGGER_MS, useDeviceCheck } from "./use-device-check";

// 경계 mock: 브라우저 getUserMedia(navigator.mediaDevices 속성만) · navigator.onLine(getter만) · 시간(가짜 타이머)
// · 마이크 소리 크기 훅(use-mic-level.test 소관, 고정 값)
vi.mock("@/components/use-mic-level", async () => {
  const { motionValue } = await import("motion/react");
  const level = motionValue(0);
  return { useMicLevel: () => level };
});

class FakeTrack extends EventTarget {
  stop = vi.fn();
  constructor(readonly kind: "video" | "audio") {
    super();
  }
}

/** 카메라 · 마이크 트랙을 고를 수 있는 가짜 스트림 */
function fakeStream({ video = true, audio = true } = {}) {
  const videoTrack = new FakeTrack("video");
  const audioTrack = new FakeTrack("audio");
  const videos = video ? [videoTrack] : [];
  const audios = audio ? [audioTrack] : [];
  const stream = {
    getTracks: () => [...videos, ...audios],
    getVideoTracks: () => videos,
    getAudioTracks: () => audios,
  } as unknown as MediaStream;
  return { stream, video: videoTrack, audio: audioTrack };
}

const getUserMedia = vi.fn<(constraints: MediaStreamConstraints) => Promise<MediaStream>>();
const denied = () => new DOMException("Permission denied", "NotAllowedError");
let online: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.useFakeTimers();
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia },
  });
  online = vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
});

afterEach(() => {
  Reflect.deleteProperty(navigator, "mediaDevices");
});

/** 받은 결과가 반영되고 ms만큼 시간이 흐르게 한다 */
const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

/** 처음 확인(카메라 → 마이크 → 네트워크)을 끝낸 훅 */
async function checkedHook(stream: MediaStream) {
  getUserMedia.mockResolvedValueOnce(stream);
  const hook = renderHook(() => useDeviceCheck());
  await advance(CHECK_STAGGER_MS * 2);
  return hook;
}

describe("useDeviceCheck · S05 장치 점검 상태", () => {
  describe("사용자 조작", () => {
    it("다시 확인해 둘 다 받으면 true를 돌려주고 두 줄이 ok가 된다", async () => {
      getUserMedia.mockRejectedValueOnce(denied());
      const { result } = renderHook(() => useDeviceCheck());
      await advance(CHECK_STAGGER_MS * 2);
      getUserMedia.mockResolvedValueOnce(fakeStream().stream);

      let recheck!: Promise<boolean>;
      act(() => {
        recheck = result.current.recheck();
      });
      await advance(CHECK_STAGGER_MS);

      await expect(recheck).resolves.toBe(true);
      expect(result.current.camera).toBe("ok");
      expect(result.current.mic).toBe("ok");
    });

    it("다시 확인해도 거부되면 false를 돌려주고 두 줄은 denied로 남는다", async () => {
      getUserMedia.mockRejectedValue(denied());
      const { result } = renderHook(() => useDeviceCheck());
      await advance(CHECK_STAGGER_MS * 2);

      let recheck!: Promise<boolean>;
      act(() => {
        recheck = result.current.recheck();
      });
      await advance(CHECK_STAGGER_MS);

      await expect(recheck).resolves.toBe(false);
      expect(result.current.camera).toBe("denied");
      expect(result.current.mic).toBe("denied");
    });

    it("다시 확인하면 이전 스트림의 트랙을 끈다", async () => {
      const first = fakeStream();
      const second = fakeStream();
      const { result } = await checkedHook(first.stream);
      getUserMedia.mockResolvedValueOnce(second.stream);

      act(() => void result.current.recheck());
      await advance(CHECK_STAGGER_MS);

      expect(first.video.stop).toHaveBeenCalledTimes(1);
      expect(first.audio.stop).toHaveBeenCalledTimes(1);
      expect(second.video.stop).not.toHaveBeenCalled();
      expect(result.current.stream).toBe(second.stream);
    });
  });

  describe("정상 처리", () => {
    it("화면에 들어오면 카메라 · 마이크를 한 번에 요청하고 받은 스트림을 돌려준다", async () => {
      const { stream } = fakeStream();
      getUserMedia.mockResolvedValueOnce(stream);
      const { result } = renderHook(() => useDeviceCheck());

      await advance(0);

      expect(getUserMedia).toHaveBeenCalledTimes(1);
      expect(getUserMedia).toHaveBeenCalledWith({ video: true, audio: true });
      expect(result.current.stream).toBe(stream);
    });
  });

  describe("상태 변화", () => {
    it("다시 확인하는 동안 rechecking이고 끝나면 풀린다", async () => {
      getUserMedia.mockRejectedValueOnce(denied());
      const { result } = renderHook(() => useDeviceCheck());
      await advance(CHECK_STAGGER_MS * 2);
      const media = deferred<MediaStream>();
      getUserMedia.mockReturnValueOnce(media.promise);

      act(() => void result.current.recheck());
      expect(result.current.rechecking).toBe(true);

      media.resolve(fakeStream().stream);
      await advance(CHECK_STAGGER_MS);
      expect(result.current.rechecking).toBe(false);
    });

    it("점검 중 카메라 연결이 끊기면 카메라 줄만 ended로 바뀐다", async () => {
      const { stream, video } = fakeStream();
      const { result } = await checkedHook(stream);

      act(() => void video.dispatchEvent(new Event("ended")));

      expect(result.current.camera).toBe("ended");
      expect(result.current.mic).toBe("ok");
    });

    it("점검 중 마이크 연결이 끊기면 마이크 줄만 ended로 바뀐다", async () => {
      const { stream, audio } = fakeStream();
      const { result } = await checkedHook(stream);

      act(() => void audio.dispatchEvent(new Event("ended")));

      expect(result.current.mic).toBe("ended");
      expect(result.current.camera).toBe("ok");
    });

    it("네트워크를 확인한 뒤 오프라인 · 온라인이 되면 네트워크 줄이 따라 바뀐다", async () => {
      const { result } = await checkedHook(fakeStream().stream);

      online.mockReturnValue(false);
      act(() => void window.dispatchEvent(new Event("offline")));
      expect(result.current.network).toBe("offline");

      online.mockReturnValue(true);
      act(() => void window.dispatchEvent(new Event("online")));
      expect(result.current.network).toBe("ok");
    });
  });

  describe("경계값", () => {
    it("네트워크 줄이 확인되기 전에 온 오프라인 · 온라인 이벤트는 무시한다", async () => {
      getUserMedia.mockResolvedValueOnce(fakeStream().stream);
      const { result } = renderHook(() => useDeviceCheck());
      await advance(0);

      online.mockReturnValue(false);
      act(() => void window.dispatchEvent(new Event("offline")));
      expect(result.current.network).toBe("checking");

      online.mockReturnValue(true);
      act(() => void window.dispatchEvent(new Event("online")));
      expect(result.current.network).toBe("checking");
    });

    it("다시 확인할 때는 네트워크를 다시 기다리지 않는다", async () => {
      const { result } = await checkedHook(fakeStream().stream);
      getUserMedia.mockResolvedValueOnce(fakeStream().stream);
      let finished = false;

      act(() => {
        void result.current.recheck().then(() => (finished = true));
      });
      await advance(CHECK_STAGGER_MS);

      expect(finished).toBe(true);
    });
  });

  describe("오류 처리", () => {
    it("권한을 거부하면 카메라 · 마이크 모두 denied다", async () => {
      getUserMedia.mockRejectedValueOnce(denied());
      const { result } = renderHook(() => useDeviceCheck());

      await advance(CHECK_STAGGER_MS);

      expect(result.current.camera).toBe("denied");
      expect(result.current.mic).toBe("denied");
      expect(result.current.stream).toBeNull();
    });

    it("스트림에 카메라 트랙이 없으면 카메라는 missing이다", async () => {
      getUserMedia.mockResolvedValueOnce(fakeStream({ video: false }).stream);
      const { result } = renderHook(() => useDeviceCheck());

      await advance(CHECK_STAGGER_MS);

      expect(result.current.camera).toBe("missing");
      expect(result.current.mic).toBe("ok");
    });

    it("스트림에 마이크 트랙이 없으면 마이크는 missing이다", async () => {
      getUserMedia.mockResolvedValueOnce(fakeStream({ audio: false }).stream);
      const { result } = renderHook(() => useDeviceCheck());

      await advance(CHECK_STAGGER_MS);

      expect(result.current.mic).toBe("missing");
      expect(result.current.camera).toBe("ok");
    });

    it("브라우저에 mediaDevices가 없으면 카메라 · 마이크 모두 unsupported다", async () => {
      Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: undefined });
      const { result } = renderHook(() => useDeviceCheck());

      await advance(CHECK_STAGGER_MS);

      expect(result.current.camera).toBe("unsupported");
      expect(result.current.mic).toBe("unsupported");
    });

    it("처음 확인할 때 오프라인이면 네트워크는 offline이다", async () => {
      online.mockReturnValue(false);

      const { result } = await checkedHook(fakeStream().stream);

      expect(result.current.network).toBe("offline");
    });
  });

  describe("중복 · 경쟁 처리", () => {
    it("처음 요청이 끝나기 전에 다시 요청하면 늦게 온 처음 결과는 버리고 그 스트림을 끈다", async () => {
      const first = fakeStream();
      const second = fakeStream();
      const firstMedia = deferred<MediaStream>();
      const secondMedia = deferred<MediaStream>();
      getUserMedia.mockReturnValueOnce(firstMedia.promise).mockReturnValueOnce(secondMedia.promise);
      const { result } = renderHook(() => useDeviceCheck());
      act(() => void result.current.recheck());

      secondMedia.resolve(second.stream);
      await advance(0);
      firstMedia.resolve(first.stream);
      await advance(CHECK_STAGGER_MS * 2);

      expect(result.current.stream).toBe(second.stream);
      expect(first.video.stop).toHaveBeenCalledTimes(1);
      expect(first.audio.stop).toHaveBeenCalledTimes(1);
      expect(second.video.stop).not.toHaveBeenCalled();
    });

    it("확인 간격을 기다리는 중 다시 요청하면 이전 요청은 남은 줄을 바꾸지 않는다", async () => {
      getUserMedia.mockResolvedValueOnce(fakeStream().stream);
      const { result } = renderHook(() => useDeviceCheck());
      await advance(0);
      const media = deferred<MediaStream>();
      getUserMedia.mockReturnValueOnce(media.promise);

      act(() => void result.current.recheck());
      await advance(CHECK_STAGGER_MS * 2);

      expect(result.current.mic).toBe("checking");
      expect(result.current.network).toBe("checking");
      media.reject(denied());
      await advance(CHECK_STAGGER_MS * 2);
    });
  });

  describe("시간 경과", () => {
    it("카메라를 먼저 확인하고 0.25초 뒤 마이크, 다시 0.25초 뒤 네트워크를 확인한다", async () => {
      getUserMedia.mockResolvedValueOnce(fakeStream().stream);
      const { result } = renderHook(() => useDeviceCheck());

      await advance(0);
      expect([result.current.camera, result.current.mic, result.current.network]).toEqual([
        "ok",
        "checking",
        "checking",
      ]);

      await advance(CHECK_STAGGER_MS - 1);
      expect(result.current.mic).toBe("checking");
      await advance(1);
      expect([result.current.mic, result.current.network]).toEqual(["ok", "checking"]);

      await advance(CHECK_STAGGER_MS - 1);
      expect(result.current.network).toBe("checking");
      await advance(1);
      expect(result.current.network).toBe("ok");
    });
  });

  describe("정리", () => {
    it("화면을 떠나면 카메라 · 마이크 트랙을 끈다", async () => {
      const { stream, video, audio } = fakeStream();
      getUserMedia.mockResolvedValueOnce(stream);
      const { unmount } = renderHook(() => useDeviceCheck());
      await advance(0);

      unmount();

      expect(video.stop).toHaveBeenCalledTimes(1);
      expect(audio.stop).toHaveBeenCalledTimes(1);
    });

    it("허용을 기다리는 사이 화면을 떠났으면 늦게 받은 스트림을 바로 끈다", async () => {
      const { stream, video, audio } = fakeStream();
      const media = deferred<MediaStream>();
      getUserMedia.mockReturnValueOnce(media.promise);
      const { unmount } = renderHook(() => useDeviceCheck());

      unmount();
      media.resolve(stream);
      await advance(0);

      expect(video.stop).toHaveBeenCalledTimes(1);
      expect(audio.stop).toHaveBeenCalledTimes(1);
    });

    it("화면을 떠나면 온라인 · 오프라인 리스너를 해제한다", async () => {
      getUserMedia.mockResolvedValueOnce(fakeStream().stream);
      const { unmount } = renderHook(() => useDeviceCheck());
      await advance(0);
      const remove = vi.spyOn(window, "removeEventListener");

      unmount();

      const removed = remove.mock.calls.map(([type]) => type);
      expect(removed).toContain("online");
      expect(removed).toContain("offline");
    });

    it("다시 확인한 뒤 이전 스트림의 트랙이 끝나도 줄을 바꾸지 않는다", async () => {
      const first = fakeStream();
      const { result } = await checkedHook(first.stream);
      getUserMedia.mockResolvedValueOnce(fakeStream().stream);
      act(() => void result.current.recheck());
      await advance(CHECK_STAGGER_MS);

      act(() => void first.video.dispatchEvent(new Event("ended")));

      expect(result.current.camera).toBe("ok");
    });
  });
});
