// 기준: Figma S06 Self Camera · STT Bubble Bottom(18:2519 · 18:2539) · S06-A 답변 상태 토스트(344:1649) · S06-F Mic Toast(18:4421) · 기획 · 모션 메모 S06-F(18:3575 · 18:4432: 마이크 입력이 10초 이상 0이면 하단 토스트) · 사용자 결정(2026-11-09: 답할 차례에만 센다)
import { act, render, screen } from "@testing-library/react";
import { motionValue } from "motion/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { spyTimers } from "@/test/timers";

import { MicToast, SelfCamera, VideoControls } from "./video-panel";

// 경계 mock: 연출(motion)은 건너뛴다. 소리 없는 시간은 가짜 타이머로 진행한다(performance.now도 함께 진행)
vi.mock("motion/react", async (importOriginal) =>
  (await import("@/test/motion")).reducedMotion(importOriginal),
);

const TOAST = "마이크 소리가 들리지 않아요";
const submitButton = () => screen.getByRole("button", { name: "답변 완료" });

beforeEach(() => {
  vi.useFakeTimers();
});

describe("SelfCamera · 내 카메라", () => {
  describe("화면 표시", () => {
    it("카메라가 없으면 영상을 숨긴다", () => {
      render(<SelfCamera stream={null} />);

      expect(screen.getByLabelText("내 카메라 화면").className).toContain("hidden");
    });

    it("카메라가 있으면 영상에 내 스트림을 잇는다", () => {
      const stream = { getVideoTracks: () => [{ kind: "video" }] } as unknown as MediaStream;

      render(<SelfCamera stream={stream} />);

      const video = screen.getByLabelText<HTMLVideoElement>("내 카메라 화면");
      expect(video.srcObject).toBe(stream);
      expect(video.className).not.toContain("hidden");
    });
  });
});

describe("VideoControls · 답변 완료 줄", () => {
  describe("화면 표시", () => {
    it("낼 수 없으면 [답변 완료]를 막는다", () => {
      render(<VideoControls level={motionValue(0)} canSubmit={false} />);

      expect(submitButton()).toHaveProperty("disabled", true);
    });

    it("내는 중이면 [답변 완료]를 막고 바쁨을 알린다", () => {
      render(<VideoControls level={motionValue(0)} canSubmit submitting />);

      expect(submitButton()).toHaveProperty("disabled", true);
      expect(submitButton().getAttribute("aria-busy")).toBe("true");
    });
  });
});

describe("MicToast · 마이크 끊김 안내", () => {
  describe("화면 표시", () => {
    it("장치를 받지 못했으면 답할 차례에 10초를 기다리지 않고 바로 띄운다", () => {
      render(<MicToast level={motionValue(0)} answering unavailable onCheck={vi.fn()} />);

      expect(screen.getByText(TOAST)).toBeDefined();
    });

    it("장치를 받지 못했어도 답할 차례가 아니면 띄우지 않는다", () => {
      render(<MicToast level={motionValue(0)} answering={false} unavailable onCheck={vi.fn()} />);

      expect(screen.queryByText(TOAST)).toBeNull();
    });
  });

  describe("상태 변화", () => {
    it("소리가 들어오면 안내를 내리고 소리 없는 시간을 처음부터 센다", () => {
      const level = motionValue(0);
      render(<MicToast level={level} answering onCheck={vi.fn()} />);
      act(() => vi.advanceTimersByTime(10_000));

      act(() => level.set(0.3));
      expect(screen.queryByText(TOAST)).toBeNull();

      act(() => level.set(0));
      act(() => vi.advanceTimersByTime(9_000));
      expect(screen.queryByText(TOAST)).toBeNull();
      act(() => vi.advanceTimersByTime(1_000));
      expect(screen.getByText(TOAST)).toBeDefined();
    });

    it("답할 차례가 끝나면 떠 있던 안내를 내려 다시 답할 차례에 10초를 새로 센다", () => {
      const level = motionValue(0);
      const { rerender } = render(<MicToast level={level} answering onCheck={vi.fn()} />);
      act(() => vi.advanceTimersByTime(10_000));

      rerender(<MicToast level={level} answering={false} onCheck={vi.fn()} />);
      rerender(<MicToast level={level} answering onCheck={vi.fn()} />);
      expect(screen.queryByText(TOAST)).toBeNull();

      act(() => vi.advanceTimersByTime(10_000));
      expect(screen.getByText(TOAST)).toBeDefined();
    });
  });

  describe("시간 경과", () => {
    it("답할 차례에 소리가 10초 넘게 없으면 안내를 띄운다", () => {
      render(<MicToast level={motionValue(0)} answering onCheck={vi.fn()} />);

      act(() => vi.advanceTimersByTime(9_000));
      expect(screen.queryByText(TOAST)).toBeNull();

      act(() => vi.advanceTimersByTime(1_000));
      expect(screen.getByText(TOAST)).toBeDefined();
    });

    it("다시 답할 차례가 되면 그때부터 10초를 센다", () => {
      const level = motionValue(0);
      const { rerender } = render(<MicToast level={level} answering={false} onCheck={vi.fn()} />);
      act(() => vi.advanceTimersByTime(20_000));

      rerender(<MicToast level={level} answering onCheck={vi.fn()} />);
      act(() => vi.advanceTimersByTime(9_000));
      expect(screen.queryByText(TOAST)).toBeNull();

      act(() => vi.advanceTimersByTime(1_000));
      expect(screen.getByText(TOAST)).toBeDefined();
    });
  });

  describe("정리", () => {
    it("답할 차례가 끝나면 1초 확인 타이머를 거둔다", () => {
      const timers = spyTimers();
      const level = motionValue(0);
      const { rerender } = render(<MicToast level={level} answering onCheck={vi.fn()} />);

      rerender(<MicToast level={level} answering={false} onCheck={vi.fn()} />);

      expect(timers.cleared("interval", 1000)).toBe(true);
    });
  });
});
