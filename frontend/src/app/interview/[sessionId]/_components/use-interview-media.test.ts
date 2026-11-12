// 기준: 기획 메모 S06(18:757: 내 카메라(WebRTC)는 우측 상단 작게) · 기획 메모 S06-F(18:3575) · MDN getUserMedia · MediaStreamTrack ended · MediaDevices devicechange · 사용자 결정(2026-11-09: 마이크를 껐다 켜면 다시 연결될 때 자동으로 새로 받는다)
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { deferred } from "@/test/deferred";

import { useInterviewMedia } from "./use-interview-media";

// 경계 mock: 미디어 장치(navigator.mediaDevices · MediaStream · 트랙)는 가짜로 바꾸고, 소리 크기(AudioContext)는 고정 값을 돌려준다.
// 다시 받는 간격은 가짜 타이머로 진행한다
vi.mock("@/components/use-mic-level", async () => {
  const { motionValue } = await import("motion/react");
  return { useMicLevel: () => motionValue(0) };
});

/** 브라우저 트랙처럼 ended · mute · unmute 이벤트를 보낼 수 있는 가짜 트랙 */
function fakeTrack(kind: "audio" | "video", groupId = "built-in") {
  return Object.assign(new EventTarget(), {
    kind,
    readyState: "live" as MediaStreamTrackState,
    muted: false,
    stop: vi.fn(),
    getSettings: () => ({ groupId }),
  });
}
type FakeTrack = ReturnType<typeof fakeTrack>;

/** 브라우저 MediaStream처럼 트랙을 종류별로 꺼내 주는 가짜 스트림 */
class FakeMediaStream {
  constructor(readonly tracks: FakeTrack[]) {}
  getTracks = () => this.tracks;
  getAudioTracks = () => this.tracks.filter((track) => track.kind === "audio");
  getVideoTracks = () => this.tracks.filter((track) => track.kind === "video");
}

function fakeStream(...kinds: ("audio" | "video")[]) {
  const tracks = kinds.map((kind) => fakeTrack(kind));
  return { stream: new FakeMediaStream(tracks) as unknown as MediaStream, tracks };
}

const DENIED = new DOMException("denied", "NotAllowedError");

/** 마이크 트랙이 끝난다(장치를 빼거나 끔) */
function endTrack(track: FakeTrack) {
  track.readyState = "ended";
  track.dispatchEvent(new Event("ended"));
}
/** 소리를 받지 못하게 된다(운영체제가 마이크 접근을 막음 등) · 다시 받는다 */
function muteTrack(track: FakeTrack, muted: boolean) {
  track.muted = muted;
  track.dispatchEvent(new Event(muted ? "mute" : "unmute"));
}

const getUserMedia = vi.fn();
/** 운영체제 기본 마이크(deviceId "default")가 가리키는 장치 */
let defaultGroup = "built-in";
let devices: EventTarget & {
  getUserMedia: typeof getUserMedia;
  enumerateDevices: () => Promise<{ kind: string; deviceId: string; groupId: string }[]>;
};

function setMediaDevices(value: unknown) {
  Object.defineProperty(navigator, "mediaDevices", { value, configurable: true });
}
const flush = () => act(async () => {});
const advance = (ms: number) => act(async () => vi.advanceTimersByTimeAsync(ms));
const deviceChange = () =>
  act(async () => {
    devices.dispatchEvent(new Event("devicechange"));
  });

/** 처음 카메라 · 마이크를 받은 상태로 훅을 그린다 */
async function renderWithStream() {
  const first = fakeStream("video", "audio");
  getUserMedia.mockResolvedValueOnce(first.stream);
  const view = renderHook(() => useInterviewMedia());
  await flush();
  const [camera, microphone] = first.tracks;
  return { ...view, first, camera, microphone };
}

beforeEach(() => {
  vi.useFakeTimers();
  defaultGroup = "built-in";
  devices = Object.assign(new EventTarget(), {
    getUserMedia,
    enumerateDevices: async () => [
      { kind: "audioinput", deviceId: "default", groupId: defaultGroup },
    ],
  });
  setMediaDevices(devices);
  vi.stubGlobal("MediaStream", FakeMediaStream);
});
afterEach(() => {
  Reflect.deleteProperty(navigator, "mediaDevices");
});

describe("useInterviewMedia · 내 카메라 · 마이크", () => {
  describe("장치 받기", () => {
    describe("정상 처리", () => {
      it("화면에 들어오면 카메라 · 마이크를 함께 받아 돌려준다", async () => {
        const { stream } = fakeStream("video", "audio");
        getUserMedia.mockResolvedValue(stream);

        const { result } = renderHook(() => useInterviewMedia());
        await flush();

        expect(getUserMedia).toHaveBeenCalledWith({ video: true, audio: true });
        expect(result.current.stream).toBe(stream);
        expect(result.current.unavailable).toBe(false);
      });
    });

    describe("오류 처리", () => {
      it("받지 못하면 스트림 없이 받지 못했다고 알린다", async () => {
        getUserMedia.mockRejectedValue(DENIED);

        const { result } = renderHook(() => useInterviewMedia());
        await flush();

        expect(result.current.stream).toBeNull();
        expect(result.current.unavailable).toBe(true);
      });

      it("브라우저가 카메라를 지원하지 않으면(mediaDevices 없음) 받지 못했다고 알린다", async () => {
        setMediaDevices(undefined);

        const { result } = renderHook(() => useInterviewMedia());
        await flush();

        expect(result.current.stream).toBeNull();
        expect(result.current.unavailable).toBe(true);
      });

      it("처음 받지 못했으면 장치가 바뀔 때(devicechange)도 다시 받는다", async () => {
        const later = fakeStream("video", "audio");
        getUserMedia.mockRejectedValueOnce(DENIED).mockResolvedValueOnce(later.stream);
        const { result } = renderHook(() => useInterviewMedia());
        await flush();

        await deviceChange();

        expect(result.current.stream).toBe(later.stream);
      });
    });

    describe("중복 · 경쟁 처리", () => {
      it("받기 전에 화면을 떠났으면 늦게 온 스트림을 바로 끈다", async () => {
        const late = fakeStream("video", "audio");
        const response = deferred<MediaStream>();
        getUserMedia.mockReturnValue(response.promise);
        const { unmount } = renderHook(() => useInterviewMedia());

        unmount();
        await act(async () => response.resolve(late.stream));

        expect(late.tracks.map((track) => track.stop.mock.calls.length)).toEqual([1, 1]);
      });

      it("받는 중에는 겹쳐 요청하지 않는다", async () => {
        const response = deferred<MediaStream>();
        getUserMedia.mockRejectedValueOnce(DENIED).mockReturnValueOnce(response.promise);
        renderHook(() => useInterviewMedia());
        await flush();
        await advance(2000);

        await advance(2000);
        await deviceChange();

        expect(getUserMedia).toHaveBeenCalledTimes(2);
        await act(async () => response.resolve(fakeStream("video", "audio").stream));
      });
    });

    describe("시간 경과", () => {
      it("받지 못하면 받을 때까지 2초마다 다시 받는다", async () => {
        getUserMedia.mockRejectedValue(DENIED);
        renderHook(() => useInterviewMedia());
        await flush();

        await advance(1999);
        expect(getUserMedia).toHaveBeenCalledTimes(1);

        await advance(1);
        expect(getUserMedia).toHaveBeenCalledTimes(2);
        await advance(2000);
        expect(getUserMedia).toHaveBeenCalledTimes(3);
      });

      it("다시 받는 데 성공하면 다시 받기를 멈추고 받지 못함 알림을 끈다", async () => {
        const later = fakeStream("video", "audio");
        getUserMedia.mockRejectedValueOnce(DENIED).mockResolvedValueOnce(later.stream);
        const { result } = renderHook(() => useInterviewMedia());
        await flush();

        await advance(2000);
        await advance(6000);

        expect(result.current.stream).toBe(later.stream);
        expect(result.current.unavailable).toBe(false);
        expect(getUserMedia).toHaveBeenCalledTimes(2);
      });
    });

    describe("정리", () => {
      it("화면을 떠나면 받은 장치를 끈다", async () => {
        const { unmount, first } = await renderWithStream();

        unmount();

        expect(first.tracks.map((track) => track.stop.mock.calls.length)).toEqual([1, 1]);
      });

      it("다시 받는 중에 화면을 떠나면 더 받지 않는다", async () => {
        getUserMedia.mockRejectedValue(DENIED);
        const { unmount } = renderHook(() => useInterviewMedia());
        await flush();

        unmount();
        await advance(6000);
        await deviceChange();

        expect(getUserMedia).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe("마이크 다시 받기", () => {
    describe("상태 변화", () => {
      it("마이크 트랙이 끝나면 마이크만 새로 받아 카메라 트랙과 묶은 새 스트림으로 바꾸고 지난 마이크를 놓는다", async () => {
        const again = fakeStream("audio");
        const { result, first, camera, microphone } = await renderWithStream();
        getUserMedia.mockResolvedValueOnce(again.stream);

        await act(async () => endTrack(microphone));

        expect(getUserMedia).toHaveBeenLastCalledWith({ audio: true });
        expect(result.current.stream).not.toBe(first.stream);
        expect(result.current.stream?.getVideoTracks()).toEqual([camera]);
        expect(result.current.stream?.getAudioTracks()).toEqual([again.tracks[0]]);
        expect(microphone.stop).toHaveBeenCalledTimes(1);
        expect(camera.stop).not.toHaveBeenCalled();
      });

      it("소리를 받지 못하게 되면(mute) 마이크를 새로 받는다", async () => {
        const again = fakeStream("audio");
        const { result, microphone } = await renderWithStream();
        getUserMedia.mockResolvedValueOnce(again.stream);

        await act(async () => muteTrack(microphone, true));

        expect(result.current.stream?.getAudioTracks()).toEqual([again.tracks[0]]);
      });

      it("새로 받은 마이크도 소리를 받지 못하면 바꾸지 않고 그 마이크를 끈다", async () => {
        const blocked = fakeStream("audio");
        blocked.tracks[0].muted = true;
        const { result, first, microphone } = await renderWithStream();
        getUserMedia.mockResolvedValueOnce(blocked.stream);

        await act(async () => muteTrack(microphone, true));

        expect(result.current.stream).toBe(first.stream);
        expect(blocked.tracks[0].stop).toHaveBeenCalledTimes(1);
      });

      it("마이크가 살아 있으면 장치가 바뀌어도 다시 받지 않는다", async () => {
        const { result, first } = await renderWithStream();

        await deviceChange();
        await flush();

        expect(getUserMedia).toHaveBeenCalledTimes(1);
        expect(result.current.stream).toBe(first.stream);
      });

      it("마이크가 살아 있어도 기본 마이크가 다른 장치로 바뀌면 그 장치로 옮긴다", async () => {
        const headset = fakeStream("audio");
        const { result } = await renderWithStream();
        getUserMedia.mockResolvedValueOnce(headset.stream);
        defaultGroup = "headset";

        await deviceChange();
        await flush();

        expect(getUserMedia).toHaveBeenLastCalledWith({ audio: true });
        expect(result.current.stream?.getAudioTracks()).toEqual([headset.tracks[0]]);
      });

      it("마이크가 끊긴 채 장치가 바뀌면 다시 받는다", async () => {
        const again = fakeStream("audio");
        const { result, microphone } = await renderWithStream();
        getUserMedia
          .mockRejectedValueOnce(new DOMException("no device", "NotFoundError"))
          .mockResolvedValueOnce(again.stream);
        await act(async () => endTrack(microphone));

        await deviceChange();

        expect(getUserMedia).toHaveBeenCalledTimes(3);
        expect(result.current.stream?.getAudioTracks()).toEqual([again.tracks[0]]);
      });
    });

    describe("중복 · 경쟁 처리", () => {
      it("마이크를 받는 중에는 겹쳐 요청하지 않는다", async () => {
        const response = deferred<MediaStream>();
        const { microphone } = await renderWithStream();
        getUserMedia.mockReturnValueOnce(response.promise);
        await act(async () => endTrack(microphone));

        await deviceChange();
        await advance(4000);

        expect(getUserMedia).toHaveBeenCalledTimes(2);
        await act(async () => response.resolve(fakeStream("audio").stream));
      });
    });

    describe("시간 경과", () => {
      it("마이크를 다시 받지 못하면 2초마다 다시 받는다", async () => {
        const { microphone } = await renderWithStream();
        getUserMedia.mockRejectedValue(new DOMException("blocked", "NotReadableError"));
        await act(async () => muteTrack(microphone, true));

        await advance(1999);
        expect(getUserMedia).toHaveBeenCalledTimes(2);

        await advance(1);
        expect(getUserMedia).toHaveBeenCalledTimes(3);
      });

      it("다시 받는 사이에 소리가 다시 들어오면(unmute) 그만 받는다", async () => {
        const { result, first, microphone } = await renderWithStream();
        getUserMedia.mockRejectedValue(new DOMException("blocked", "NotReadableError"));
        await act(async () => muteTrack(microphone, true));

        await act(async () => muteTrack(microphone, false));
        await advance(6000);

        expect(getUserMedia).toHaveBeenCalledTimes(2);
        expect(result.current.stream).toBe(first.stream);
      });
    });

    describe("정리", () => {
      it("마이크를 새로 받은 뒤 화면을 떠나면 새 마이크까지 끈다", async () => {
        const again = fakeStream("audio");
        const { unmount, microphone } = await renderWithStream();
        getUserMedia.mockResolvedValueOnce(again.stream);
        await act(async () => endTrack(microphone));

        unmount();

        expect(again.tracks[0].stop).toHaveBeenCalledTimes(1);
      });

      it("다시 받기 전에 화면을 떠났으면 늦게 온 마이크를 끈다", async () => {
        const again = fakeStream("audio");
        const response = deferred<MediaStream>();
        const { unmount, microphone } = await renderWithStream();
        getUserMedia.mockReturnValueOnce(response.promise);
        await act(async () => endTrack(microphone));

        unmount();
        await act(async () => response.resolve(again.stream));

        expect(again.tracks[0].stop).toHaveBeenCalledTimes(1);
      });

      it("화면을 떠나면 마이크 · 장치 이벤트 듣기를 멈춘다", async () => {
        const { unmount, microphone } = await renderWithStream();

        unmount();
        await act(async () => endTrack(microphone));
        await deviceChange();
        await advance(6000);

        expect(getUserMedia).toHaveBeenCalledTimes(1);
      });
    });
  });
});
