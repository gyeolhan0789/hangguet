// 기준: Figma S06 · S06-B Interviewer Bubble(18:2530) · Swagger 5.2 currentQuestion · 사용자 요청(2026-10-27: 질문 펼치기 · 접기, 눈 버튼으로 화면 숨기기) · 모션 메모 S06-B(18:2615: '생각 중' 점 3개)
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useInterviewStore } from "@/stores/interview-store";

import { QuestionBubble, ShowUiButton } from "./question-bubble";

// 경계 mock: 연출(motion)은 건너뛴다
vi.mock("motion/react", async (importOriginal) =>
  (await import("@/test/motion")).reducedMotion(importOriginal),
);

// 예시 데이터: Swagger 5.2 currentQuestion 예시
const QUESTION = { id: 303, seq: 3, content: "가장 큰 기술적 문제는 무엇이었나요?" };
const NEXT_QUESTION = { id: 304, seq: 4, content: "그 문제를 어떻게 풀었나요?" };

/** 질문 글 줄(화면 읽기용 전체 글을 품은 문단) */
const questionLine = (content: string) =>
  screen.getByText(content, { selector: ".sr-only" }).parentElement!;

beforeEach(() => {
  useInterviewStore.getState().reset();
});

describe("QuestionBubble · 면접관 질문 말풍선", () => {
  describe("화면 표시", () => {
    it("질문이 없으면 '면접관이 생각하는 중'을 보인다", () => {
      render(<QuestionBubble interviewer="악마 면접관" question={null} />);

      expect(screen.getByRole("status", { name: "면접관이 생각하는 중" })).toBeDefined();
    });
  });

  describe("사용자 조작", () => {
    it("꺾쇠를 누르면 질문을 접고 버튼 이름을 '질문 펼치기'로 바꾼다", () => {
      render(<QuestionBubble interviewer="악마 면접관" question={QUESTION} />);

      fireEvent.click(screen.getByRole("button", { name: "질문 접기" }));

      expect(questionLine(QUESTION.content).className).toContain("line-clamp-1");
      expect(
        screen.getByRole("button", { name: "질문 펼치기" }).getAttribute("aria-expanded"),
      ).toBe("false");
    });

    it("눈 버튼을 누르면 화면 숨기기를 켠다", () => {
      render(<QuestionBubble interviewer="악마 면접관" question={QUESTION} />);

      fireEvent.click(screen.getByRole("button", { name: "화면 숨기기" }));

      expect(useInterviewStore.getState().uiHidden).toBe(true);
    });

    it("'생각 중'에도 눈 · 꺾쇠를 누를 수 있다", () => {
      render(<QuestionBubble interviewer="악마 면접관" question={null} />);

      fireEvent.click(screen.getByRole("button", { name: "화면 숨기기" }));
      fireEvent.click(screen.getByRole("button", { name: "질문 접기" }));

      expect(useInterviewStore.getState()).toMatchObject({ uiHidden: true, collapsed: true });
    });
  });

  describe("상태 변화", () => {
    it("질문이 바뀌어도 접은 상태를 그대로 둔다", () => {
      const { rerender } = render(<QuestionBubble interviewer="악마 면접관" question={QUESTION} />);
      fireEvent.click(screen.getByRole("button", { name: "질문 접기" }));

      rerender(<QuestionBubble interviewer="악마 면접관" question={NEXT_QUESTION} />);

      expect(questionLine(NEXT_QUESTION.content).className).toContain("line-clamp-1");
    });
  });
});

describe("ShowUiButton · 화면 보이기 버튼", () => {
  describe("화면 표시", () => {
    it("화면을 숨기지 않았으면 그리지 않는다", () => {
      render(<ShowUiButton />);

      expect(screen.queryByRole("button", { name: "화면 보이기" })).toBeNull();
    });
  });

  describe("사용자 조작", () => {
    it("[화면 보이기]를 누르면 화면을 다시 보인다", () => {
      useInterviewStore.setState({ uiHidden: true });
      render(<ShowUiButton />);

      fireEvent.click(screen.getByRole("button", { name: "화면 보이기" }));

      expect(useInterviewStore.getState().uiHidden).toBe(false);
      expect(screen.queryByRole("button", { name: "화면 보이기" })).toBeNull();
    });
  });
});
