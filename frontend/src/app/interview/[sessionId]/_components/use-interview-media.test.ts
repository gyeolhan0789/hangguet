import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MIC_RETRY_MS, useInterviewMedia } from "./use-interview-media";

// 소리 크기 계산(useMicLevel)은 S05 장치 점검 테스트가 본다. 여기서는 카메라 · 마이크를 켜고 끄는 것만 본다.
vi.mock("@/components/use-mic-level", async () => {
  const { motionValue } = await import("motion/react");
  return { useMicLevel: () => motionValue(0) };
});

// 기준: 기획 메모 S06(18:757: 내 카메라(WebRTC)는 우측 상단 작게) · MDN getUserMedia
// · 사용자 결정(2026-11-09: 마이크를 껐다 켜면(트랙이 끝나면) 다시 연결될 때 자동으로 새로 받는다)
// · MDN MediaStreamTrack ended · MediaDevices devicechange

/** 브라우저 트랙처럼 ended 이벤트를 보낼 수 있는 가짜 트랙 */
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
const enumerateDevices = vi.fn(async () => [
  { kind: "audioinput", deviceId: "default", groupId: defaultGroup },
]);
const devices = Object.assign(new EventTarget(), { getUserMedia, enumerateDevices });
beforeEach(() => {
  defaultGroup = "built-in";
  vi.stubGlobal("navigator", { mediaDevices: devices });
  vi.stubGlobal("MediaStream", FakeMediaStream);
});
afterEach(() => {
  // 앞 테스트의 훅이 같은 장치(devices) 이벤트를 듣지 않게 내린다
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
  getUserMedia.mockReset();
  vi.unstubAllGlobals();
});

describe("useInterviewMedia (S06 내 카메라 · 마이크)", () => {
  it("카메라 · 마이크를 함께 요청하고, 화면을 떠나면 끈다", async () => {
    const { stream, tracks } = fakeStream("video", "audio");
    getUserMedia.mockResolvedValue(stream);
    const { result, unmount } = renderHook(() => useInterviewMedia());

    await act(async () => {});
    expect(getUserMedia).toHaveBeenCalledWith({ video: true, audio: true });
    expect(result.current.stream).toBe(stream);

    unmount();
    for (const track of tracks) expect(track.stop).toHaveBeenCalled();
  });

  it("받기 전에 화면을 떠났으면 늦게 온 스트림을 바로 끈다", async () => {
    const { stream, tracks } = fakeStream("video", "audio");
    let resolve!: (value: MediaStream) => void;
    getUserMedia.mockReturnValue(new Promise((done) => (resolve = done)));
    const { unmount } = renderHook(() => useInterviewMedia());

    unmount();
    await act(async () => resolve(stream));

    for (const track of tracks) expect(track.stop).toHaveBeenCalled();
  });

  it("거부되면 스트림 없이 두고 받지 못했다고 알린다(카메라 칸은 사람 아이콘)", async () => {
    getUserMedia.mockRejectedValue(new DOMException("denied", "NotAllowedError"));
    const { result } = renderHook(() => useInterviewMedia());

    await act(async () => {});
    expect(result.current.stream).toBeNull();
    expect(result.current.unavailable).toBe(true);
  });

  it("처음 받지 못하면 받을 때까지 간격을 두고 카메라 · 마이크를 함께 다시 받는다", async () => {
    vi.useFakeTimers();
    const later = fakeStream("video", "audio");
    getUserMedia
      .mockRejectedValueOnce(new DOMException("busy", "NotReadableError"))
      .mockRejectedValueOnce(new DOMException("busy", "NotReadableError"))
      .mockResolvedValueOnce(later.stream);
    const { result } = renderHook(() => useInterviewMedia());
    await act(async () => {});
    expect(result.current.unavailable).toBe(true);

    await act(async () => vi.advanceTimersByTimeAsync(MIC_RETRY_MS));
    expect(result.current.stream).toBeNull();
    await act(async () => vi.advanceTimersByTimeAsync(MIC_RETRY_MS));

    expect(result.current.stream).toBe(later.stream);
    expect(result.current.unavailable).toBe(false);
    for (const call of getUserMedia.mock.calls)
      expect(call[0]).toEqual({ video: true, audio: true });
    // 받은 뒤에는 더 받지 않는다
    await act(async () => vi.advanceTimersByTimeAsync(MIC_RETRY_MS * 3));
    expect(getUserMedia).toHaveBeenCalledTimes(3);
  });

  it("처음 받지 못했으면 장치가 바뀔 때(devicechange)도 다시 받는다", async () => {
    const later = fakeStream("video", "audio");
    getUserMedia
      .mockRejectedValueOnce(new DOMException("denied", "NotAllowedError"))
      .mockResolvedValueOnce(later.stream);
    const { result } = renderHook(() => useInterviewMedia());
    await act(async () => {});

    await act(async () => void devices.dispatchEvent(new Event("devicechange")));

    expect(result.current.stream).toBe(later.stream);
    expect(result.current.unavailable).toBe(false);
  });

  it("다시 받는 중에 화면을 떠나면 더 받지 않는다", async () => {
    vi.useFakeTimers();
    getUserMedia.mockRejectedValue(new DOMException("denied", "NotAllowedError"));
    const { unmount } = renderHook(() => useInterviewMedia());
    await act(async () => {});

    unmount();
    await act(async () => vi.advanceTimersByTimeAsync(MIC_RETRY_MS * 3));
    devices.dispatchEvent(new Event("devicechange"));

    expect(getUserMedia).toHaveBeenCalledTimes(1);
  });

  it("브라우저가 카메라를 지원하지 않아도(mediaDevices 없음) 오류 없이 스트림 없이 둔다", async () => {
    vi.stubGlobal("navigator", {});
    const { result } = renderHook(() => useInterviewMedia());
    await act(async () => {});
    expect(result.current.stream).toBeNull();
    expect(result.current.unavailable).toBe(true);
  });

  it("마이크 트랙이 끝나면 마이크만 새로 받아, 카메라 트랙과 묶은 새 스트림으로 바꾼다", async () => {
    const first = fakeStream("video", "audio");
    const [camera, microphone] = first.tracks;
    const again = fakeStream("audio");
    getUserMedia.mockResolvedValueOnce(first.stream).mockResolvedValueOnce(again.stream);
    const { result, unmount } = renderHook(() => useInterviewMedia());
    await act(async () => {});

    await act(async () => endTrack(microphone));

    expect(getUserMedia).toHaveBeenLastCalledWith({ audio: true });
    const stream = result.current.stream!;
    expect(stream).not.toBe(first.stream);
    expect(stream.getVideoTracks()).toEqual([camera]);
    expect(stream.getAudioTracks()).toEqual([again.tracks[0]]);
    // 카메라는 끄지 않고 계속 쓴다
    expect(camera.stop).not.toHaveBeenCalled();

    unmount();
    expect(camera.stop).toHaveBeenCalled();
    expect(again.tracks[0].stop).toHaveBeenCalled();
  });

  it("장치가 없어 다시 받지 못하면 그대로 두고, 장치가 바뀌면(devicechange) 다시 받는다", async () => {
    const first = fakeStream("video", "audio");
    const again = fakeStream("audio");
    getUserMedia
      .mockResolvedValueOnce(first.stream)
      .mockRejectedValueOnce(new DOMException("no device", "NotFoundError"))
      .mockResolvedValueOnce(again.stream);
    const { result } = renderHook(() => useInterviewMedia());
    await act(async () => {});

    await act(async () => endTrack(first.tracks[1]));
    expect(result.current.stream).toBe(first.stream);

    await act(async () => devices.dispatchEvent(new Event("devicechange")));
    expect(result.current.stream?.getAudioTracks()).toEqual([again.tracks[0]]);
    expect(getUserMedia).toHaveBeenCalledTimes(3);
  });

  it("마이크가 살아 있으면 장치가 바뀌어도 다시 받지 않는다", async () => {
    const first = fakeStream("video", "audio");
    getUserMedia.mockResolvedValueOnce(first.stream);
    const { result } = renderHook(() => useInterviewMedia());
    await act(async () => {});

    await act(async () => devices.dispatchEvent(new Event("devicechange")));

    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(result.current.stream).toBe(first.stream);
  });

  it("소리를 받지 못하게 되면(mute: 운영체제가 마이크 접근을 막음) 마이크를 새로 받는다", async () => {
    const first = fakeStream("video", "audio");
    const again = fakeStream("audio");
    getUserMedia.mockResolvedValueOnce(first.stream).mockResolvedValueOnce(again.stream);
    const { result } = renderHook(() => useInterviewMedia());
    await act(async () => {});

    await act(async () => muteTrack(first.tracks[1], true));

    expect(result.current.stream?.getAudioTracks()).toEqual([again.tracks[0]]);
    // 지난 마이크는 놓는다
    expect(first.tracks[1].stop).toHaveBeenCalled();
  });

  it("다시 받지 못하면 간격을 두고 계속 받아 본다(다시 켜도 devicechange가 오지 않는 경우)", async () => {
    vi.useFakeTimers();
    const first = fakeStream("video", "audio");
    const again = fakeStream("audio");
    getUserMedia
      .mockResolvedValueOnce(first.stream)
      .mockRejectedValueOnce(new DOMException("blocked", "NotReadableError"))
      .mockRejectedValueOnce(new DOMException("blocked", "NotReadableError"))
      .mockResolvedValueOnce(again.stream);
    const { result } = renderHook(() => useInterviewMedia());
    await act(async () => {});

    await act(async () => muteTrack(first.tracks[1], true));
    expect(getUserMedia).toHaveBeenCalledTimes(2);
    await act(async () => vi.advanceTimersByTimeAsync(MIC_RETRY_MS));
    expect(getUserMedia).toHaveBeenCalledTimes(3);
    expect(result.current.stream).toBe(first.stream);
    await act(async () => vi.advanceTimersByTimeAsync(MIC_RETRY_MS));

    expect(result.current.stream?.getAudioTracks()).toEqual([again.tracks[0]]);
    await act(async () => vi.advanceTimersByTimeAsync(MIC_RETRY_MS * 3));
    expect(getUserMedia).toHaveBeenCalledTimes(4);
  });

  it("다시 받는 사이에 소리가 다시 들어오면(unmute) 그만 받는다", async () => {
    vi.useFakeTimers();
    const first = fakeStream("video", "audio");
    getUserMedia
      .mockResolvedValueOnce(first.stream)
      .mockRejectedValue(new DOMException("blocked", "NotReadableError"));
    const { result } = renderHook(() => useInterviewMedia());
    await act(async () => {});
    await act(async () => muteTrack(first.tracks[1], true));

    await act(async () => muteTrack(first.tracks[1], false));
    await act(async () => vi.advanceTimersByTimeAsync(MIC_RETRY_MS * 3));

    expect(getUserMedia).toHaveBeenCalledTimes(2);
    expect(result.current.stream).toBe(first.stream);
  });

  it("새로 받은 마이크도 소리를 받지 못하면 바꾸지 않고 다음에 다시 받아 본다", async () => {
    vi.useFakeTimers();
    const first = fakeStream("video", "audio");
    const blocked = fakeStream("audio");
    blocked.tracks[0].muted = true;
    const again = fakeStream("audio");
    getUserMedia
      .mockResolvedValueOnce(first.stream)
      .mockResolvedValueOnce(blocked.stream)
      .mockResolvedValueOnce(again.stream);
    const { result } = renderHook(() => useInterviewMedia());
    await act(async () => {});

    await act(async () => muteTrack(first.tracks[1], true));
    expect(result.current.stream).toBe(first.stream);
    expect(blocked.tracks[0].stop).toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTimeAsync(MIC_RETRY_MS));

    expect(result.current.stream?.getAudioTracks()).toEqual([again.tracks[0]]);
  });

  it("마이크가 살아 있어도 운영체제 기본 마이크가 다른 장치로 바뀌면(다시 켬 · 꽂음) 그 장치로 옮긴다", async () => {
    const first = fakeStream("video", "audio");
    const headset = fakeStream("audio");
    getUserMedia.mockResolvedValueOnce(first.stream).mockResolvedValueOnce(headset.stream);
    const { result } = renderHook(() => useInterviewMedia());
    await act(async () => {});

    await act(async () => devices.dispatchEvent(new Event("devicechange")));
    expect(getUserMedia).toHaveBeenCalledTimes(1);

    defaultGroup = "headset";
    await act(async () => devices.dispatchEvent(new Event("devicechange")));
    // 장치 목록을 읽은 뒤 다시 받는다(두 번 기다린다)
    await act(async () => {});

    expect(getUserMedia).toHaveBeenLastCalledWith({ audio: true });
    expect(result.current.stream?.getAudioTracks()).toEqual([headset.tracks[0]]);
  });

  it("다시 받기 전에 화면을 떠났으면 늦게 온 마이크를 바로 끈다", async () => {
    const first = fakeStream("video", "audio");
    const again = fakeStream("audio");
    let resolve!: (value: MediaStream) => void;
    getUserMedia
      .mockResolvedValueOnce(first.stream)
      .mockReturnValueOnce(new Promise((done) => (resolve = done)));
    const { unmount } = renderHook(() => useInterviewMedia());
    await act(async () => {});
    await act(async () => endTrack(first.tracks[1]));

    unmount();
    await act(async () => resolve(again.stream));

    expect(again.tracks[0].stop).toHaveBeenCalled();
  });
});
