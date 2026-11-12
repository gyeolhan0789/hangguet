// 기준: Figma S06 · S06-B 위 막대(18:2502 · 18:2508 · 18:2513) · Swagger 5.2(persona · companyName · jobTitle · currentQuestion.seq · answeredCount · elapsedSeconds · status) · 기획 메모 S06-E(18:3508) · S06-F(18:3575: 멈춤 상태에서 타이머 정지)
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useInterviewStore } from "@/stores/interview-store";
import type { SessionResponse } from "@/types/api";

import { TopBar } from "./top-bar";

// 경계 mock: 인터넷 연결(navigator.onLine)은 spy로 바꾸고 online/offline 이벤트를 보낸다. 경과 시간은 가짜 타이머로 진행한다

// 예시 데이터: Swagger 5.2 200 예시 'S06 면접 중'
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
const QUESTION = SESSION.currentQuestion;

let online = true;
function setOnline(value: boolean) {
  online = value;
  act(() => {
    window.dispatchEvent(new Event(value ? "online" : "offline"));
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  useInterviewStore.getState().reset();
  online = true;
  vi.spyOn(navigator, "onLine", "get").mockImplementation(() => online);
});

describe("TopBar · 면접 위 막대", () => {
  describe("위 막대", () => {
    describe("화면 표시", () => {
      it("질문이 있으면 그 질문 순서로 '질문 n / 5'를 보인다", () => {
        render(<TopBar session={SESSION} question={QUESTION} />);

        expect(screen.getByText("질문 3 / 5")).toBeDefined();
      });

      it("다음 질문을 기다리는 중이면 마지막으로 답한 질문 번호를 보인다", () => {
        render(<TopBar session={{ ...SESSION, answeredCount: 3 }} question={null} />);

        expect(screen.getByText("질문 3 / 5")).toBeDefined();
      });

      it("화면을 숨기면 면접관 · 진행 표시를 숨기고 [면접 종료]만 남긴다", () => {
        render(<TopBar session={SESSION} question={QUESTION} uiHidden />);

        expect(screen.getByText("악마 면접관").closest(".invisible")).not.toBeNull();
        expect(screen.getByText("질문 3 / 5").closest(".invisible")).not.toBeNull();
        expect(screen.getByRole("button", { name: "면접 종료" }).closest(".invisible")).toBeNull();
      });
    });

    describe("사용자 조작", () => {
      it("[면접 종료]를 누르면 종료 확인 모달을 연다", () => {
        render(<TopBar session={SESSION} question={QUESTION} />);

        fireEvent.click(screen.getByRole("button", { name: "면접 종료" }));

        expect(useInterviewStore.getState().endOpen).toBe(true);
      });
    });

    describe("경계값", () => {
      it("질문 번호는 5를 넘지 않는다", () => {
        render(<TopBar session={SESSION} question={{ id: 306, seq: 6, content: "추가 질문" }} />);

        expect(screen.getByText("질문 5 / 5")).toBeDefined();
      });
    });
  });

  describe("경과 시간", () => {
    describe("상태 변화", () => {
      it("다시 그려 5.2 경과 시간이 바뀌면 그 값에서 다시 센다", () => {
        const { rerender } = render(<TopBar session={SESSION} question={QUESTION} />);
        act(() => vi.advanceTimersByTime(5000));

        rerender(<TopBar session={{ ...SESSION, elapsedSeconds: 600 }} question={QUESTION} />);

        expect(screen.getByText("10:00")).toBeDefined();
      });
    });

    describe("시간 경과", () => {
      it("면접 중이면 경과 시간이 1초마다 는다", () => {
        render(<TopBar session={SESSION} question={QUESTION} />);

        act(() => vi.advanceTimersByTime(3000));

        expect(screen.getByText("08:45")).toBeDefined();
      });

      it("면접 중이 아니면 경과 시간이 멈춘다", () => {
        render(<TopBar session={{ ...SESSION, status: "ANALYZING" }} question={null} />);

        act(() => vi.advanceTimersByTime(3000));

        expect(screen.getByText("08:42")).toBeDefined();
      });

      it("연결이 끊긴 동안 멈추고 다시 연결되면 이어서 는다", () => {
        render(<TopBar session={SESSION} question={QUESTION} />);
        act(() => vi.advanceTimersByTime(2000));

        setOnline(false);
        act(() => vi.advanceTimersByTime(5000));
        expect(screen.getByText("08:44")).toBeDefined();

        setOnline(true);
        act(() => vi.advanceTimersByTime(1000));
        expect(screen.getByText("08:45")).toBeDefined();
      });
    });
  });
});
