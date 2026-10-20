import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useVoiceCheck, VOICE_RECORD_MS } from "./use-voice-check";

// 기준: Figma S05 마이크 · 스피커 줄 · 사용자 합의(마이크 [녹음하기]로 3초 녹음 → 끝나면 스피커 [들어보기] 활성화 → 녹음한 소리 재생)
// 브라우저 경계(MediaRecorder · Audio · blob 주소)만 가짜로 바꾼다.

class FakeRecorder {
  static last: FakeRecorder;
  state: RecordingState = "inactive";
  mimeType = "audio/webm";
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  constructor(readonly stream: MediaStream) {
    FakeRecorder.last = this;
  }
  start() {
    this.state = "recording";
  }
  stop = vi.fn(() => {
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob(["소리"]) });
    this.onstop?.();
  });
}

class FakeAudio {
  static last: FakeAudio;
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  play = vi.fn(async () => {});
  pause = vi.fn();
  constructor(readonly src: string) {
    FakeAudio.last = this;
  }
}

/** 렌더마다 새로 만들면 '스트림이 바뀜'으로 보므로, 테스트마다 한 번 만들어 넘긴다. */
const micStream = () => ({ getAudioTracks: () => [{ kind: "audio" }] }) as unknown as MediaStream;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  vi.stubGlobal("MediaRecorder", FakeRecorder);
  vi.stubGlobal("MediaStream", class {});
  vi.stubGlobal("Audio", FakeAudio);
  // URL 전체가 아니라 blob 주소를 만들고 지우는 두 메서드만 바꾼다.
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:녹음");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
});

afterEach(() => {
  // globals를 켜지 않아 Testing Library가 자동으로 정리하지 않으므로 직접 정리한다.
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function recordedHook() {
  const stream = micStream();
  const hook = renderHook(() => useVoiceCheck(stream));
  act(() => hook.result.current.record());
  act(() => vi.advanceTimersByTime(VOICE_RECORD_MS));
  return hook;
}

describe("useVoiceCheck (S05 마이크 녹음 · 스피커 재생)", () => {
  it("녹음하기 → 3초 뒤 녹음이 끝난다", () => {
    const stream = micStream();
    const { result } = renderHook(() => useVoiceCheck(stream));
    expect(result.current.status).toBe("idle");

    act(() => result.current.record());
    expect(result.current.status).toBe("recording");
    act(() => vi.advanceTimersByTime(VOICE_RECORD_MS - 1));
    expect(FakeRecorder.last.stop).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(1));
    expect(result.current.status).toBe("recorded");
  });

  it("들어보기 → 녹음한 소리를 재생하고, 다 들어도 [잘 들려요]를 눌러야 confirmed다", () => {
    const { result } = recordedHook();

    act(() => result.current.play());
    expect(FakeAudio.last.src).toBe("blob:녹음");
    expect(FakeAudio.last.play).toHaveBeenCalled();
    expect(result.current.status).toBe("playing");

    act(() => FakeAudio.last.onended?.());
    expect(result.current.status).toBe("played");

    act(() => result.current.confirm());
    expect(result.current.status).toBe("confirmed");
  });

  it("녹음 전에는 들어보기를 눌러도 아무 일도 없다", () => {
    const stream = micStream();
    const { result } = renderHook(() => useVoiceCheck(stream));

    act(() => result.current.play());

    expect(result.current.status).toBe("idle");
  });

  it.each([
    { label: "마이크 스트림이 없으면", stream: null, recorder: FakeRecorder },
    { label: "MediaRecorder를 지원하지 않으면", stream: micStream(), recorder: undefined },
  ])("$label recordFailed다", ({ stream, recorder }) => {
    vi.stubGlobal("MediaRecorder", recorder);
    const { result } = renderHook(() => useVoiceCheck(stream));

    act(() => result.current.record());

    expect(result.current.status).toBe("recordFailed");
  });

  it("재생이 막히면(play 거부) playFailed다", async () => {
    const { result } = recordedHook();
    vi.stubGlobal(
      "Audio",
      class extends FakeAudio {
        play = vi.fn(async () => {
          throw new DOMException("막힘", "NotAllowedError");
        });
      },
    );

    await act(async () => result.current.play());

    expect(result.current.status).toBe("playFailed");
  });

  it("녹음 중에 마이크 스트림이 바뀌면 녹음을 멈추고 처음으로 돌린다", () => {
    const { result, rerender } = renderHook(({ stream }) => useVoiceCheck(stream), {
      initialProps: { stream: micStream() },
    });
    act(() => result.current.record());
    const recorder = FakeRecorder.last;

    rerender({ stream: micStream() });

    expect(recorder.stop).toHaveBeenCalled();
    expect(result.current.status).toBe("idle");
  });

  it("화면을 떠나면 재생을 멈추고 blob 주소를 지운다", () => {
    const { result, unmount } = recordedHook();
    act(() => result.current.play());
    const audio = FakeAudio.last;

    unmount();

    expect(audio.pause).toHaveBeenCalled();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:녹음");
  });
});
