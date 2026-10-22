import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useInterviewMedia } from "./use-interview-media";

// 소리 크기 계산(useMicLevel)은 S05 장치 점검 테스트가 본다. 여기서는 카메라 · 마이크를 켜고 끄는 것만 본다.
vi.mock("@/components/use-mic-level", async () => {
  const { motionValue } = await import("motion/react");
  return { useMicLevel: () => motionValue(0) };
});

// 기준: 기획 메모 S06(18:757: 내 카메라(WebRTC)는 우측 상단 작게) · MDN getUserMedia

function fakeStream() {
  const stop = vi.fn();
  const track = { stop } as unknown as MediaStreamTrack;
  return { stream: { getTracks: () => [track, track] } as unknown as MediaStream, stop };
}

const getUserMedia = vi.fn();
beforeEach(() => {
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
});
afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("useInterviewMedia (S06 내 카메라 · 마이크)", () => {
  it("카메라 · 마이크를 함께 요청하고, 화면을 떠나면 끈다", async () => {
    const { stream, stop } = fakeStream();
    getUserMedia.mockResolvedValue(stream);
    const { result, unmount } = renderHook(() => useInterviewMedia());

    await act(async () => {});
    expect(getUserMedia).toHaveBeenCalledWith({ video: true, audio: true });
    expect(result.current.stream).toBe(stream);

    unmount();
    expect(stop).toHaveBeenCalledTimes(2);
  });

  it("받기 전에 화면을 떠났으면 늦게 온 스트림을 바로 끈다", async () => {
    const { stream, stop } = fakeStream();
    let resolve!: (value: MediaStream) => void;
    getUserMedia.mockReturnValue(new Promise((done) => (resolve = done)));
    const { unmount } = renderHook(() => useInterviewMedia());

    unmount();
    await act(async () => resolve(stream));

    expect(stop).toHaveBeenCalledTimes(2);
  });

  it("거부되면 스트림 없이 둔다(카메라 칸은 사람 아이콘)", async () => {
    getUserMedia.mockRejectedValue(new DOMException("denied", "NotAllowedError"));
    const { result } = renderHook(() => useInterviewMedia());

    await act(async () => {});
    expect(result.current.stream).toBeNull();
  });

  it("브라우저가 카메라를 지원하지 않아도(mediaDevices 없음) 오류 없이 스트림 없이 둔다", () => {
    vi.stubGlobal("navigator", {});
    const { result } = renderHook(() => useInterviewMedia());
    expect(result.current.stream).toBeNull();
  });
});
