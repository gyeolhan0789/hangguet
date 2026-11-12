// 기준: Figma S05(18:2333) 마이크 · 스피커 줄 · 스피커 [▶ 들어보기] · 사용자 합의(3초 녹음 → 녹음한 소리 재생 → [잘 들려요])
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { flushPromises } from "@/test/flush";

import { useVoiceCheck, VOICE_RECORD_MS } from "./use-voice-check";

// 경계 mock: 브라우저 MediaRecorder · MediaStream · Audio(가짜 클래스) · blob 주소(URL 메서드 둘만) · 시간(가짜 타이머)
class FakeRecorder {
  static all: FakeRecorder[] = [];
  state: RecordingState = "inactive";
  mimeType = "audio/webm";
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  constructor() {
    FakeRecorder.all.push(this);
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
  static all: FakeAudio[] = [];
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  play = vi.fn(async () => {});
  pause = vi.fn();
  constructor(readonly src: string) {
    FakeAudio.all.push(this);
  }
}

/** 렌더마다 새로 만들면 '스트림이 바뀜'으로 보므로 테스트마다 한 번 만들어 넘긴다 */
const micStream = (tracks = 1) =>
  ({
    getAudioTracks: () => Array.from({ length: tracks }, () => ({ kind: "audio" })),
  }) as unknown as MediaStream;

let urls = 0;

beforeEach(() => {
  vi.useFakeTimers();
  FakeRecorder.all = [];
  FakeAudio.all = [];
  urls = 0;
  vi.stubGlobal("MediaRecorder", FakeRecorder);
  vi.stubGlobal("MediaStream", class {});
  vi.stubGlobal("Audio", FakeAudio);
  vi.spyOn(URL, "createObjectURL").mockImplementation(() => `blob:${++urls}`);
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
});

/** 녹음을 마친(recorded) 훅 */
function recordedHook() {
  const stream = micStream();
  const hook = renderHook(({ s }) => useVoiceCheck(s), { initialProps: { s: stream } });
  act(() => hook.result.current.record());
  act(() => vi.advanceTimersByTime(VOICE_RECORD_MS));
  return hook;
}

describe("useVoiceCheck · 마이크 녹음 · 스피커 재생", () => {
  describe("상태 변화", () => {
    it("[녹음하기]하면 녹음 중이 된다", () => {
      const stream = micStream();
      const { result } = renderHook(() => useVoiceCheck(stream));

      act(() => result.current.record());

      expect(result.current.status).toBe("recording");
    });

    it("녹음한 소리를 재생하면 재생 중이 된다", () => {
      const { result } = recordedHook();

      act(() => result.current.play());

      expect(result.current.status).toBe("playing");
      expect(FakeAudio.all[0].src).toBe("blob:1");
      expect(FakeAudio.all[0].play).toHaveBeenCalledTimes(1);
    });

    it("재생이 끝나면 들렸는지 묻는 상태가 된다", () => {
      const { result } = recordedHook();
      act(() => result.current.play());

      act(() => FakeAudio.all[0].onended?.());

      expect(result.current.status).toBe("played");
    });

    it("잘 들린다고 확인하면 확인함이 된다", () => {
      const { result } = recordedHook();
      act(() => result.current.play());
      act(() => FakeAudio.all[0].onended?.());

      act(() => result.current.confirm());

      expect(result.current.status).toBe("confirmed");
    });
  });

  describe("경계값", () => {
    it("녹음 전에 재생하면 아무 일도 없다", () => {
      const stream = micStream();
      const { result } = renderHook(() => useVoiceCheck(stream));

      act(() => result.current.play());

      expect(result.current.status).toBe("idle");
      expect(FakeAudio.all).toHaveLength(0);
    });
  });

  describe("오류 처리", () => {
    it.each([
      { label: "마이크 트랙 없음", tracks: 0, recorder: FakeRecorder },
      {
        label: "MediaRecorder 생성 실패",
        tracks: 1,
        recorder: class {
          constructor() {
            throw new DOMException("지원 안 함", "NotSupportedError");
          }
        },
      },
    ])("'$label'이면 녹음 실패다", ({ tracks, recorder }) => {
      vi.stubGlobal("MediaRecorder", recorder);
      const stream = micStream(tracks);
      const { result } = renderHook(() => useVoiceCheck(stream));

      act(() => result.current.record());

      expect(result.current.status).toBe("recordFailed");
    });

    it("브라우저가 재생을 막으면 재생 실패다", async () => {
      const { result } = recordedHook();
      vi.stubGlobal(
        "Audio",
        class extends FakeAudio {
          play = vi.fn(async () => {
            throw new DOMException("막힘", "NotAllowedError");
          });
        },
      );

      act(() => result.current.play());
      await flushPromises();

      expect(result.current.status).toBe("playFailed");
    });

    it("재생 중 오류가 나면 재생 실패다", () => {
      const { result } = recordedHook();
      act(() => result.current.play());

      act(() => FakeAudio.all[0].onerror?.());

      expect(result.current.status).toBe("playFailed");
    });
  });

  describe("중복 · 경쟁 처리", () => {
    it("다시 재생하면 앞의 재생을 멈춘다", () => {
      const { result } = recordedHook();
      act(() => result.current.play());

      act(() => result.current.play());

      expect(FakeAudio.all[0].pause).toHaveBeenCalledTimes(1);
      expect(FakeAudio.all[1].pause).not.toHaveBeenCalled();
    });

    it("다시 녹음해 끝나면 앞의 녹음 주소를 지운다", () => {
      const { result } = recordedHook();

      act(() => result.current.record());
      act(() => vi.advanceTimersByTime(VOICE_RECORD_MS));

      expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:1");
      expect(URL.revokeObjectURL).not.toHaveBeenCalledWith("blob:2");
    });
  });

  describe("시간 경과", () => {
    it("녹음은 3초 뒤 끝나 녹음 끝 상태가 된다", () => {
      const stream = micStream();
      const { result } = renderHook(() => useVoiceCheck(stream));
      act(() => result.current.record());

      act(() => vi.advanceTimersByTime(VOICE_RECORD_MS - 1));
      expect(result.current.status).toBe("recording");

      act(() => vi.advanceTimersByTime(1));
      expect(result.current.status).toBe("recorded");
    });
  });

  describe("정리", () => {
    it("녹음 중에 마이크 스트림이 바뀌면 그 녹음을 녹음 끝으로 치지 않고 녹음 전으로 돌린다", () => {
      const { result, rerender } = renderHook(({ stream }) => useVoiceCheck(stream), {
        initialProps: { stream: micStream() },
      });
      act(() => result.current.record());

      rerender({ stream: micStream() });

      expect(FakeRecorder.all[0].stop).toHaveBeenCalledTimes(1);
      expect(result.current.status).toBe("idle");
      expect(URL.createObjectURL).not.toHaveBeenCalled();
    });

    it("녹음 중이 아닐 때 스트림이 바뀌면 상태를 그대로 둔다", () => {
      const { result, rerender } = recordedHook();

      rerender({ s: micStream() });

      expect(result.current.status).toBe("recorded");
    });

    it("화면을 떠나면 재생을 멈추고 녹음 주소를 지운다", () => {
      const { result, unmount } = recordedHook();
      act(() => result.current.play());

      unmount();

      expect(FakeAudio.all[0].pause).toHaveBeenCalledTimes(1);
      expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:1");
    });
  });
});
