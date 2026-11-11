import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { motionValue } from "motion/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { VoiceCheck, VoiceStatus } from "@/components/use-voice-check";

import { MIC_MISSING_TEXT, MicCheckModal } from "./mic-check-modal";

// 기준: 기획 메모 S06-F(18:3575: [마이크 확인] = S05 장치 점검 미니 모달)
// · 사용자 결정(2026-11-09: 지금 잡힌 장치와 녹음 · 재생을 보여 주고, 녹음하는 3초 동안은 면접방 송출을 멈춘다)
// 녹음 · 재생 자체(MediaRecorder · <audio>)는 use-voice-check.test.ts가 본다. 여기서는 상태에 따라 무엇을 보여 주고 부르는지만 본다.

vi.mock("motion/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("motion/react")>()),
  useReducedMotion: () => true,
  AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
}));

const voice: VoiceCheck & { status: VoiceStatus } = {
  status: "idle",
  record: vi.fn(),
  play: vi.fn(),
  confirm: vi.fn(),
};
vi.mock("@/components/use-voice-check", () => ({ useVoiceCheck: () => ({ ...voice }) }));

function micStream(label: string, readyState: MediaStreamTrackState = "live") {
  return {
    getAudioTracks: () => [{ label, readyState }],
    getVideoTracks: () => [],
  } as unknown as MediaStream;
}

const onClose = vi.fn();
const onPauseSending = vi.fn();
function modal(stream: MediaStream | null = micStream("마이크(Realtek Audio)")) {
  return (
    <MicCheckModal
      open
      onClose={onClose}
      stream={stream}
      level={motionValue(0.5)}
      onPauseSending={onPauseSending}
    />
  );
}

beforeEach(() => {
  voice.status = "idle";
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("MicCheckModal (S06-F 마이크 확인 미니 모달)", () => {
  it("지금 잡힌 마이크 이름과 소리 크기 막대, 녹음 안내를 보여 준다", () => {
    render(modal());

    expect(screen.getByRole("dialog", { name: "마이크 확인" })).toBeTruthy();
    expect(screen.getByText("마이크(Realtek Audio)")).toBeTruthy();
    expect(screen.getByRole("meter", { name: "마이크 소리 크기" })).toBeTruthy();
    expect(screen.getByText("녹음해서 목소리를 확인해요")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "들어보기" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "녹음하기" }));
    expect(voice.record).toHaveBeenCalledOnce();
  });

  it("마이크가 끊겼으면(트랙이 끝남 · 없음) 장치를 찾을 수 없다고 하고 녹음할 수 없다", () => {
    const { rerender } = render(modal(micStream("마이크", "ended")));
    expect(screen.getByText(MIC_MISSING_TEXT)).toBeTruthy();
    expect(screen.getByRole("button", { name: "녹음하기" })).toHaveProperty("disabled", true);

    rerender(modal(null));
    expect(screen.getByText(MIC_MISSING_TEXT)).toBeTruthy();
  });

  it("녹음하는 동안만 면접방 송출을 멈추고, 녹음이 끝나면 다시 보낸다", () => {
    const { rerender } = render(modal());
    expect(onPauseSending).not.toHaveBeenCalled();

    voice.status = "recording";
    rerender(modal());
    expect(onPauseSending.mock.calls).toEqual([[true]]);
    expect(screen.getByText("지금 말해 보세요")).toBeTruthy();

    voice.status = "recorded";
    rerender(modal());
    expect(onPauseSending.mock.calls).toEqual([[true], [false]]);
  });

  it("녹음하는 중에 닫혀도 면접방 송출을 다시 보낸다", () => {
    voice.status = "recording";
    const { rerender } = render(modal());

    rerender(
      <MicCheckModal
        open={false}
        onClose={onClose}
        stream={null}
        level={motionValue(0)}
        onPauseSending={onPauseSending}
      />,
    );

    expect(onPauseSending.mock.calls).toEqual([[true], [false]]);
  });

  it("녹음이 끝나면 [들어보기]로 녹음한 목소리를 듣고 [다시 녹음]할 수 있다", () => {
    voice.status = "recorded";
    render(modal());

    expect(screen.getByText("녹음한 목소리를 들어보세요")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "들어보기" }));
    expect(voice.play).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "다시 녹음" }));
    expect(voice.record).toHaveBeenCalledOnce();
  });

  it("[닫기] · Esc · 바깥(어두운 배경)을 누르면 닫는다", () => {
    render(modal());
    const dialog = screen.getByRole("dialog", { name: "마이크 확인" });

    fireEvent.click(screen.getByRole("button", { name: "닫기" }));
    fireEvent.keyDown(dialog, { key: "Escape" });
    fireEvent.click(dialog.parentElement!);
    // 모달 안을 누르면 닫지 않는다
    fireEvent.click(dialog);

    expect(onClose).toHaveBeenCalledTimes(3);
  });
});
