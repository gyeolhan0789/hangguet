// 기준: 기획 메모 S06-F(18:3575: [마이크 확인] = S05 장치 점검 미니 모달) · 사용자 결정(2026-11-09: 지금 잡힌 장치와 녹음 · 재생을 보여 주는 미니 모달, 녹음하는 3초 동안은 면접방 송출을 멈춘다)
import { fireEvent, render, screen } from "@testing-library/react";
import { motionValue } from "motion/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { VoiceStatus } from "@/components/use-voice-check";

import { MicCheckModal } from "./mic-check-modal";

// 경계 mock: 녹음 · 재생(MediaRecorder · 오디오)을 감싸는 우리 훅은 테스트가 바꾸는 상태를 돌려준다. 연출(motion)은 건너뛴다
const voice = vi.hoisted(() => ({
  status: "idle" as VoiceStatus,
  record: vi.fn(),
  play: vi.fn(),
  confirm: vi.fn(),
}));
vi.mock("@/components/use-voice-check", () => ({ useVoiceCheck: () => ({ ...voice }) }));
vi.mock("motion/react", async (importOriginal) =>
  (await import("@/test/motion")).reducedMotion(importOriginal),
);

// 예시 데이터: 마이크 트랙 하나만 있는 가짜 스트림
function micStream(label: string, readyState: MediaStreamTrackState = "live") {
  return {
    getAudioTracks: () => [{ label, readyState }],
    getVideoTracks: () => [],
  } as unknown as MediaStream;
}
const STREAM = micStream("마이크(Realtek Audio)");

function renderModal(
  props: Partial<Parameters<typeof MicCheckModal>[0]> = {},
): ReturnType<typeof render> & { props: Parameters<typeof MicCheckModal>[0] } {
  const all = {
    open: true,
    onClose: vi.fn(),
    stream: STREAM,
    level: motionValue(0.5),
    onPauseSending: vi.fn(),
    ...props,
  };
  return { ...render(<MicCheckModal {...all} />), props: all };
}

const dialog = () => screen.getByRole("dialog", { name: "마이크 확인" });

beforeEach(() => {
  voice.status = "idle";
});

describe("MicCheckModal · 마이크 확인 미니 모달", () => {
  describe("화면 표시", () => {
    it("닫혀 있으면 그리지 않는다", () => {
      renderModal({ open: false });

      expect(screen.queryByRole("dialog")).toBeNull();
    });

    it("마이크가 살아 있으면 그 장치 이름을 보인다", () => {
      renderModal();

      expect(screen.getByText("마이크(Realtek Audio)")).toBeDefined();
    });

    it("장치 이름이 비어 있으면 '마이크'로 보인다", () => {
      renderModal({ stream: micStream("") });

      expect(screen.getByText("마이크")).toBeDefined();
    });

    it.each([
      { label: "끝난 트랙", stream: micStream("마이크(Realtek Audio)", "ended") },
      { label: "없음", stream: null },
    ])("마이크가 '$label'이면 '장치를 찾을 수 없어요'를 보이고 녹음을 막는다", ({ stream }) => {
      renderModal({ stream });

      expect(screen.getByText("장치를 찾을 수 없어요")).toBeDefined();
      expect(screen.getByRole("button", { name: "녹음하기" })).toHaveProperty("disabled", true);
    });

    it.each([
      { status: "idle", text: "녹음하기" },
      { status: "recording", text: "녹음 중" },
      { status: "recorded", text: "다시 녹음" },
      { status: "recordFailed", text: "다시 녹음" },
    ] as const)("녹음 상태가 '$status'이면 녹음 버튼을 '$text'로 보인다", ({ status, text }) => {
      voice.status = status;

      renderModal();

      expect(screen.getByRole("button", { name: text })).toBeDefined();
    });

    it("녹음했으면 [들어보기]를 보인다", () => {
      voice.status = "recorded";

      renderModal();

      expect(screen.getByRole("button", { name: "들어보기" })).toBeDefined();
    });

    it.each([
      { label: "녹음 전", status: "idle" },
      { label: "녹음 실패", status: "recordFailed" },
    ] as const)("'$label'이면 [들어보기]를 보이지 않는다", ({ status }) => {
      voice.status = status;

      renderModal();

      expect(screen.queryByRole("button", { name: "들어보기" })).toBeNull();
    });

    it.each([
      { status: "recording", button: "녹음 중" },
      { status: "playing", button: "들어보기" },
    ] as const)("'$status' 중이면 그 버튼을 막는다", ({ status, button }) => {
      voice.status = status;

      renderModal();

      expect(screen.getByRole("button", { name: button })).toHaveProperty("disabled", true);
    });

    it("열리면 [닫기]에 포커스를 둔다", () => {
      renderModal();

      expect(document.activeElement).toBe(screen.getByRole("button", { name: "닫기" }));
    });
  });

  describe("사용자 조작", () => {
    it("Esc를 누르면 닫는다", () => {
      const { props } = renderModal();

      fireEvent.keyDown(dialog(), { key: "Escape" });

      expect(props.onClose).toHaveBeenCalledTimes(1);
    });

    it("어두운 바깥을 누르면 닫는다", () => {
      const { props } = renderModal();

      fireEvent.click(dialog().parentElement!);

      expect(props.onClose).toHaveBeenCalledTimes(1);
    });

    it("모달 안을 누르면 닫지 않는다", () => {
      const { props } = renderModal();

      fireEvent.click(dialog());

      expect(props.onClose).not.toHaveBeenCalled();
    });

    it("마지막 버튼에서 Tab을 누르면 모달 안 첫 버튼으로 돌아간다", () => {
      renderModal();

      fireEvent.keyDown(dialog(), { key: "Tab" });

      expect(document.activeElement).toBe(screen.getByRole("button", { name: "녹음하기" }));
    });
  });

  describe("상태 변화", () => {
    it("녹음하는 동안 면접방 송출을 멈추고 녹음이 끝나면 다시 보낸다", () => {
      const { rerender, props } = renderModal();

      voice.status = "recording";
      rerender(<MicCheckModal {...props} />);
      expect(vi.mocked(props.onPauseSending).mock.calls).toEqual([[true]]);

      voice.status = "recorded";
      rerender(<MicCheckModal {...props} />);
      expect(vi.mocked(props.onPauseSending).mock.calls).toEqual([[true], [false]]);
    });
  });

  describe("정리", () => {
    it("녹음하는 중에 닫혀도 면접방 송출을 다시 보낸다", () => {
      voice.status = "recording";
      const { rerender, props } = renderModal();

      rerender(<MicCheckModal {...props} open={false} />);

      expect(vi.mocked(props.onPauseSending).mock.calls).toEqual([[true], [false]]);
    });
  });
});
