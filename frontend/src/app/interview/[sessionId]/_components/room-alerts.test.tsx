// 기준: Figma S06-F 연결 끊김(18:4323) · Figma S06-F2 면접관 연결 실패(345:1815) · 기획 메모 S06-F(18:3575) · S06-F2(340:1886) · 사용자 요청(2026-11-06: [다시 시작]을 RESTART_WAIT_SECONDS 동안 막고 남은 초를 버튼에 보인다)
import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { spyTimers } from "@/test/timers";

import { PausedModal, StartFailedModal, useReconnectSeconds } from "./room-alerts";

// 경계 mock: 연출(motion)은 건너뛰고, 초 세기는 가짜 타이머로 진행한다
vi.mock("motion/react", async (importOriginal) =>
  (await import("@/test/motion")).reducedMotion(importOriginal),
);

beforeEach(() => {
  vi.useFakeTimers();
});

const pausedDialog = () => screen.getByRole("alertdialog", { name: "면접이 잠시 멈췄어요" });
const failedDialog = () => screen.getByRole("alertdialog", { name: "면접관을 연결하지 못했어요" });
const restartButton = () => screen.getByRole("button", { name: "다시 시작" });
const leaveButton = () => screen.getByRole("button", { name: "나가기" });

function renderStartFailed(props: Partial<Parameters<typeof StartFailedModal>[0]> = {}) {
  const all = { open: true, restarting: false, onLeave: vi.fn(), onRestart: vi.fn(), ...props };
  return { ...render(<StartFailedModal {...all} />), props: all };
}

describe("useReconnectSeconds · 재연결 경과 초", () => {
  describe("상태 변화", () => {
    it("연결되면 0으로 돌아가 다시 끊기면 처음부터 센다", () => {
      const { result, rerender } = renderHook(({ on }) => useReconnectSeconds(on), {
        initialProps: { on: true },
      });
      act(() => vi.advanceTimersByTime(2000));

      rerender({ on: false });
      expect(result.current).toBe(0);

      rerender({ on: true });
      act(() => vi.advanceTimersByTime(1000));
      expect(result.current).toBe(1);
    });
  });

  describe("시간 경과", () => {
    it("다시 연결하는 동안 1초마다 센다", () => {
      const { result } = renderHook(() => useReconnectSeconds(true));

      act(() => vi.advanceTimersByTime(999));
      expect(result.current).toBe(0);

      act(() => vi.advanceTimersByTime(1001));
      expect(result.current).toBe(2);
    });
  });
});

describe("PausedModal · 면접 잠시 멈춤 카드", () => {
  describe("화면 표시", () => {
    it("닫혀 있으면 그리지 않는다", () => {
      render(<PausedModal open={false} onEnd={vi.fn()} onRetry={vi.fn()} />);

      expect(screen.queryByRole("alertdialog")).toBeNull();
    });

    it("열리면 [다시 시도]에 포커스를 둔다", () => {
      render(<PausedModal open onEnd={vi.fn()} onRetry={vi.fn()} />);

      expect(document.activeElement).toBe(screen.getByRole("button", { name: "다시 시도" }));
    });
  });

  describe("사용자 조작", () => {
    it("마지막 버튼에서 Tab을 누르면 카드 안 첫 버튼으로 돌아간다", () => {
      render(<PausedModal open onEnd={vi.fn()} onRetry={vi.fn()} />);

      fireEvent.keyDown(pausedDialog(), { key: "Tab" });

      expect(document.activeElement).toBe(screen.getByRole("button", { name: "면접 끝내기" }));
    });
  });
});

describe("StartFailedModal · 면접관 연결 실패 카드", () => {
  describe("화면 표시", () => {
    it("기다리는 동안 본문은 '면접관을 다시 준비하고 있어요'이고, 다 기다리면 '다시 시작해 주세요'로 바뀐다", () => {
      renderStartFailed();
      expect(failedDialog().textContent).toContain("면접관을 다시 준비하고 있어요");

      act(() => vi.advanceTimersByTime(60_000));

      expect(failedDialog().textContent).toContain("다시 시작해 주세요");
      expect(failedDialog().textContent).not.toContain("면접관을 다시 준비하고 있어요");
    });

    it("다시 시작이 실패했으면 본문 대신 서버 문구를 보인다", () => {
      // 예시: Swagger 5.4 detail(대체 문구와 다르게)
      renderStartFailed({ error: "지금 진행 중인 면접이 많아요. 잠시 후 다시 시작해 주세요." });

      expect(failedDialog().textContent).toContain(
        "지금 진행 중인 면접이 많아요. 잠시 후 다시 시작해 주세요.",
      );
      expect(failedDialog().textContent).not.toContain("면접관을 다시 준비하고 있어요");
    });

    it("기다리는 동안 [다시 시작] 버튼에 남은 초를 보이고 버튼 이름은 '다시 시작'으로 둔다", () => {
      renderStartFailed();

      expect(restartButton().textContent).toContain("(60초)");
    });
  });

  describe("사용자 조작", () => {
    it("기다리는 동안에도 [나가기]를 누를 수 있다", () => {
      const { props } = renderStartFailed();

      fireEvent.click(leaveButton());

      expect(props.onLeave).toHaveBeenCalledTimes(1);
    });
  });

  describe("경계값", () => {
    it("59초가 지나도 [다시 시작]을 막고, 60초가 되면 누를 수 있다", () => {
      renderStartFailed();

      act(() => vi.advanceTimersByTime(59_000));
      expect(restartButton()).toHaveProperty("disabled", true);

      act(() => vi.advanceTimersByTime(1000));
      expect(restartButton()).toHaveProperty("disabled", false);
    });
  });

  describe("중복 · 경쟁 처리", () => {
    it("다시 시작하는 중이면 [나가기] · [다시 시작]을 막는다", () => {
      renderStartFailed({ restarting: true });
      act(() => vi.advanceTimersByTime(60_000));

      expect(leaveButton()).toHaveProperty("disabled", true);
      expect(restartButton()).toHaveProperty("disabled", true);
    });
  });

  describe("시간 경과", () => {
    it("열리면 [다시 시작]을 막고 남은 초를 1초마다 줄여 보인다", () => {
      renderStartFailed();
      expect(restartButton()).toHaveProperty("disabled", true);
      expect(restartButton().textContent).toContain("(60초)");

      act(() => vi.advanceTimersByTime(1000));

      expect(restartButton().textContent).toContain("(59초)");
    });

    it("닫혔다 다시 열리면 처음부터 센다", () => {
      const { rerender, props } = renderStartFailed();
      act(() => vi.advanceTimersByTime(60_000));

      rerender(<StartFailedModal {...props} open={false} />);
      rerender(<StartFailedModal {...props} open />);

      expect(restartButton()).toHaveProperty("disabled", true);
      expect(restartButton().textContent).toContain("(60초)");
    });
  });

  describe("정리", () => {
    it("다 세면 1초 타이머를 거둔다", () => {
      const timers = spyTimers();
      renderStartFailed();

      act(() => vi.advanceTimersByTime(60_000));

      expect(timers.cleared("interval", 1000)).toBe(true);
    });
  });
});
