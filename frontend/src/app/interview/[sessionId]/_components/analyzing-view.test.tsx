import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { SessionResponse } from "@/types/api";

import { analysisProgress, AnalyzingView, LONG_WAIT_MS } from "./analyzing-view";

vi.mock("motion/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("motion/react")>()),
  useReducedMotion: () => true,
}));

// 기준: Figma S06-1(18:4437: 1단계 완료 · 2단계 진행 · 3단계 대기, 진행 바 210/372) · Swagger 5.2 analysisStep
// · 모션 메모 S06-1(18:4469: 실제 API 진행에 맞춰 단계 체크, 30초 초과: '조금만 더 기다려 주세요')

// Swagger 5.2 200 예시 'S06-1 결과 분석 중'
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
};

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const current = () =>
  screen.getAllByRole("listitem").findIndex((item) => item.getAttribute("aria-current") === "step");
const filled = () => screen.getByRole("progressbar").getAttribute("aria-valuenow");

describe("AnalyzingView (S06-1 결과 분석 중)", () => {
  it("Figma 제목 · 안내 · 단계 문구 · 팁과 면접관 썸네일을 보여 준다", () => {
    render(<AnalyzingView session={SESSION} />);

    expect(screen.getByRole("heading", { name: "면접관이 답변을 검토하고 있어요" })).toBeTruthy();
    expect(screen.getByText("보통 10초 안에 끝나요")).toBeTruthy();
    expect(screen.getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "답변을 정리했어요",
      "평가 기준별로 분석하는 중…",
      "피드백을 쓰는 중",
    ]);
    expect(screen.getByText("기다리는 동안 한 줄 팁 · 꼬리 질문엔 근거부터 짧게!")).toBeTruthy();
    expect(screen.getByRole("img", { name: "악마 면접관" })).toBeTruthy();
  });

  it.each([
    ["ORGANIZING_ANSWERS", 0, "28"],
    ["SCORING", 1, "56"],
    ["WRITING_FEEDBACK", 2, "85"],
  ] as const)("analysisStep %s면 %i번째 줄이 진행 중이고 진행 바는 %s", (step, index, percent) => {
    render(<AnalyzingView session={{ ...SESSION, analysisStep: step }} />);
    expect(current()).toBe(index);
    expect(filled()).toBe(percent);
  });

  it("결과가 나왔으면(COMPLETED) 모든 단계를 마치고 진행 바를 채운다", () => {
    render(<AnalyzingView session={{ ...SESSION, status: "COMPLETED", analysisStep: null }} />);
    expect(current()).toBe(-1);
    expect(filled()).toBe("100");
  });

  it("2단계 진행 중 채움은 Figma와 같다(210/372)", () => {
    expect(analysisProgress(1)).toBeCloseTo(210 / 372);
  });

  it("30초가 지나도 끝나지 않으면 '조금만 더 기다려 주세요'로 바꾼다", () => {
    vi.useFakeTimers();
    render(<AnalyzingView session={SESSION} />);

    act(() => vi.advanceTimersByTime(LONG_WAIT_MS - 1));
    expect(screen.getByText("보통 10초 안에 끝나요")).toBeTruthy();

    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByText("조금만 더 기다려 주세요")).toBeTruthy();
    expect(screen.queryByText("보통 10초 안에 끝나요")).toBeNull();
  });
});
