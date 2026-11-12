// 기준: Figma S06-1 결과 분석 중(18:4437) · Swagger 5.2 status · analysisStep · 모션 메모 S06-1(18:4469: 30초 초과 '조금만 더 기다려 주세요')
import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { spyTimers } from "@/test/timers";
import type { SessionResponse } from "@/types/api";

import { analysisProgress, AnalyzingView, LONG_WAIT_MS } from "./analyzing-view";

// 경계 mock: 연출(motion)은 건너뛴다
vi.mock("motion/react", async (importOriginal) =>
  (await import("@/test/motion")).reducedMotion(importOriginal),
);

// 예시 데이터: Swagger 5.2 200 예시 'S06-1 결과 분석 중'
const SESSION: SessionResponse = {
  id: 55,
  applicationId: 10,
  companyName: "○○전자",
  jobTitle: "백엔드 개발자",
  persona: "DEVIL",
  mode: "VIDEO",
  status: "ANALYZING",
  planStatus: "READY",
  planProgress: null,
  analysisStep: "SCORING",
  currentQuestion: null,
  answeredCount: 5,
  elapsedSeconds: 1080,
  startedAt: "2026-10-15T12:00:00+09:00",
  endedAt: "2026-10-15T12:18:00+09:00",
  createdAt: "2026-10-15T11:58:30+09:00",
  leveledUp: null,
  room: null,
};

/** 단계 줄마다 [진행 중인지, 아이콘 파일] */
function steps() {
  return screen
    .getAllByRole("listitem")
    .map((item) => [
      item.getAttribute("aria-current") === "step",
      item.querySelector("img")?.getAttribute("src") ?? "",
    ]);
}

const DONE = [false, expect.stringContaining("icon-circle-check.svg")];
const DOING = [true, expect.stringContaining("icon-loader-circle.svg")];
const WAITING = [false, expect.stringContaining("icon-circle.svg")];

describe("analysisProgress · 결과 분석 진행 비율", () => {
  describe("정상 처리", () => {
    it("2단계 진행 중이면 Figma 비율 210/372를 돌려준다", () => {
      expect(analysisProgress(1)).toBeCloseTo(210 / 372);
    });
  });

  describe("경계값", () => {
    it("모든 단계를 마쳤으면(3) 1을 돌려준다", () => {
      expect(analysisProgress(3)).toBe(1);
    });
  });
});

describe("AnalyzingView · 결과 분석 중 화면", () => {
  describe("화면 표시", () => {
    it("분석 단계가 SCORING이면 그 단계를 진행 중으로, 앞은 끝남 · 뒤는 기다림으로 보인다", () => {
      render(<AnalyzingView session={SESSION} />);

      expect(steps()).toEqual([DONE, DOING, WAITING]);
    });

    it("결과가 나왔으면(COMPLETED) 모든 단계를 끝남으로 보인다", () => {
      render(<AnalyzingView session={{ ...SESSION, status: "COMPLETED", analysisStep: null }} />);

      expect(steps()).toEqual([DONE, DONE, DONE]);
    });

    it("진행 바 값은 진행 비율을 백분율로 반올림해 보인다", () => {
      render(<AnalyzingView session={{ ...SESSION, analysisStep: "WRITING_FEEDBACK" }} />);

      expect(
        screen.getByRole("progressbar", { name: "결과 분석 진행" }).getAttribute("value"),
      ).toBe("85");
    });
  });

  describe("경계값", () => {
    it("분석 단계를 모르면(null) 첫 단계를 진행 중으로 보인다", () => {
      render(<AnalyzingView session={{ ...SESSION, analysisStep: null }} />);

      expect(steps()).toEqual([DOING, WAITING, WAITING]);
    });
  });

  describe("시간 경과", () => {
    it("30초가 되면 '조금만 더 기다려 주세요'를 보인다", () => {
      vi.useFakeTimers();
      render(<AnalyzingView session={SESSION} />);

      act(() => vi.advanceTimersByTime(29_999));
      expect(screen.queryByText("조금만 더 기다려 주세요")).toBeNull();

      act(() => vi.advanceTimersByTime(1));
      expect(screen.getByText("조금만 더 기다려 주세요")).toBeDefined();
    });
  });

  describe("정리", () => {
    it("30초 전에 화면을 떠나면 타이머를 거둔다", () => {
      vi.useFakeTimers();
      const timers = spyTimers();
      const { unmount } = render(<AnalyzingView session={SESSION} />);

      unmount();

      expect(timers.cleared("timeout", LONG_WAIT_MS)).toBe(true);
    });
  });
});
