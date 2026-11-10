import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useInterviewStore } from "@/stores/interview-store";
import type { SessionResponse } from "@/types/api";

import { TopBar } from "./top-bar";

// 기준: Figma S06 Persona Pill · Progress Pill · End Button(18:2502 · 18:2508 · 18:2513) · Swagger 5.2
// · Figma S06 '질문 3 / 5'(전체 질문 수 5)

// Swagger 5.2 200 예시
const SESSION: SessionResponse = {
  id: 55,
  applicationId: 10,
  companyName: "○○전자",
  jobTitle: "백엔드 개발자",
  persona: "DEVIL",
  mode: "VIDEO",
  status: "IN_PROGRESS",
  planStatus: "READY",
  planProgress: null,
  analysisStep: null,
  currentQuestion: { id: 303, seq: 3, content: "가장 큰 기술적 문제는 무엇이었나요?" },
  answeredCount: 2,
  elapsedSeconds: 522,
  startedAt: "2026-10-15T12:00:00+09:00",
  endedAt: null,
  createdAt: "2026-10-15T11:58:30+09:00",
  leveledUp: null,
  room: null,
};

/** 5.5 지금 질문(Swagger 5.2 예시의 질문 303 · 3번) */
const QUESTION = SESSION.currentQuestion;

let online = true;
beforeEach(() => {
  vi.useFakeTimers();
  useInterviewStore.getState().reset();
  online = true;
  vi.spyOn(navigator, "onLine", "get").mockImplementation(() => online);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("TopBar (S06 · S06-B 위 막대)", () => {
  it("면접관 · 회사 직무 · '질문 3 / 5' · 경과 시간을 보여 준다", () => {
    render(<TopBar session={SESSION} question={QUESTION} />);

    expect(screen.getByText("악마 면접관")).toBeTruthy();
    expect(screen.getByText("○○전자 백엔드 개발자")).toBeTruthy();
    expect(screen.getByText("질문 3 / 5")).toBeTruthy();
    expect(screen.getByRole("progressbar", { name: "질문 진행" }).getAttribute("value")).toBe("3");
    expect(screen.getByText("08:42")).toBeTruthy();
  });

  it("면접 중이면 경과 시간이 1초마다 늘고, 결과 분석 중이면 멈춘다", () => {
    const { rerender } = render(<TopBar session={SESSION} question={QUESTION} />);
    act(() => vi.advanceTimersByTime(3000));
    expect(screen.getByText("08:45")).toBeTruthy();

    rerender(<TopBar session={{ ...SESSION, status: "ANALYZING" }} question={null} />);
    act(() => vi.advanceTimersByTime(3000));
    expect(screen.getByText("08:45")).toBeTruthy();
  });

  it("연결이 끊긴 동안은 경과 시간이 멈추고, 다시 연결되면 이어서 는다(웹 Swagger elapsedSeconds)", () => {
    render(<TopBar session={SESSION} question={QUESTION} />);
    act(() => vi.advanceTimersByTime(2000));
    expect(screen.getByText("08:44")).toBeTruthy();

    online = false;
    act(() => window.dispatchEvent(new Event("offline")));
    act(() => vi.advanceTimersByTime(5000));
    expect(screen.getByText("08:44")).toBeTruthy();

    online = true;
    act(() => window.dispatchEvent(new Event("online")));
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.getByText("08:45")).toBeTruthy();
  });

  it("다시 그려 5.2 경과 시간이 바뀌면 그 값에서 다시 센다", () => {
    const { rerender } = render(<TopBar session={SESSION} question={QUESTION} />);
    act(() => vi.advanceTimersByTime(5000));
    rerender(<TopBar session={{ ...SESSION, elapsedSeconds: 600 }} question={QUESTION} />);
    expect(screen.getByText("10:00")).toBeTruthy();
  });

  it("다음 질문을 기다리는 중이면 마지막으로 답한 질문 번호를 둔다", () => {
    render(<TopBar session={{ ...SESSION, answeredCount: 3 }} question={null} />);
    expect(screen.getByText("질문 3 / 5")).toBeTruthy();
  });

  it("화면 숨기기(uiHidden) 중에는 면접관 · 진행 표시를 숨기고 [면접 종료]만 남긴다", () => {
    render(<TopBar session={SESSION} question={QUESTION} uiHidden />);
    expect(screen.getByText("질문 3 / 5").closest(".invisible")).toBeTruthy();
    expect(screen.getByText("악마 면접관").closest(".invisible")).toBeTruthy();
    expect(screen.getByRole("button", { name: "면접 종료" }).closest(".invisible")).toBeNull();
  });

  it("[면접 종료]를 누르면 종료 확인 모달을 연다", () => {
    render(<TopBar session={SESSION} question={QUESTION} />);
    fireEvent.click(screen.getByRole("button", { name: "면접 종료" }));
    expect(useInterviewStore.getState().endOpen).toBe(true);
  });

  it("커피챗 면접관은 Figma에 표시 아이콘이 없어 이름만 보여 준다", () => {
    const { container } = render(
      <TopBar session={{ ...SESSION, persona: "COFFEE_CHAT" }} question={QUESTION} />,
    );
    expect(screen.getByText("개발자 커피챗")).toBeTruthy();
    expect(container.querySelector('img[src*="icon-flame"]')).toBeNull();
  });
});
