// 기준: Figma S07 Q Head(18:2661) · Q List(18:2665) · 질문별 피드백은 첫 번째 WEAK · NORMAL 질문만 펼친다 · ResultResponse.answers
// · 사용자 결정(2026-10-22: [전체 펼치기]를 누르면 모두 펼치고 '전체 접기'로 바뀐다, 펼친 질문의 [자세히 보기]는 S07-1로)
// · 사용자 결정(2026-11-05: [자세히 보기]는 다시보기에서 그 질문을 펼친 채로 연다)
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { RESULT } from "@/test/result-examples";

import { QuestionFeedback } from "./question-feedback";

// 경계 mock: 연출(motion)은 건너뛴다
vi.mock("motion/react", async (importOriginal) =>
  (await import("@/test/motion")).reducedMotion(importOriginal),
);

// 예시 데이터: Swagger 6.3 200 예시(Q1 · Q2 좋아요, Q3 보통, Q4 아쉬워요 · 잘한 점 없음, Q5 좋아요)
const Q1 = /1분 자기소개/;
const Q3 = /기술적 문제는/;
const Q4 = /지원한 이유는/;

const question = (name: RegExp) => screen.getByRole("button", { name });
const renderFeedback = () => render(<QuestionFeedback sessionId={55} answers={RESULT.answers} />);

describe("QuestionFeedback · 질문별 피드백", () => {
  describe("화면 표시", () => {
    it("처음에는 첫 번째 '보통' · '아쉬워요' 질문만 펼친다", () => {
      renderFeedback();

      const expanded = screen.getAllByRole("button", { expanded: true });
      expect(expanded).toHaveLength(1);
      expect(expanded[0]).toBe(question(Q3));
    });

    it("접힌 질문은 등급을 보이고 펼친 질문은 등급 대신 잘한 점 · 아쉬운 점을 보인다", () => {
      renderFeedback();

      expect(question(Q4).textContent).toContain("아쉬워요");
      expect(question(Q3).textContent).not.toContain("보통");
      expect(screen.getByText("문제 상황을 명확히 설명했어요")).toBeDefined();
      expect(screen.getByText("해결 방법을 고른 이유가 빠졌어요")).toBeDefined();
    });

    it("잘한 점이 없으면(null) 아쉬운 점만 보인다", () => {
      render(<QuestionFeedback sessionId={55} answers={[RESULT.answers[3]]} />);

      expect(screen.queryByText("잘한 점")).toBeNull();
      expect(screen.getByText("아쉬운 점")).toBeDefined();
      expect(screen.getByText("자소서 내용과 연결하지 못했어요")).toBeDefined();
    });

    it("펼친 질문의 [자세히 보기]는 그 질문 순서를 붙인 다시보기로 간다", () => {
      renderFeedback();

      expect(screen.getByRole("link", { name: "자세히 보기" }).getAttribute("href")).toBe(
        "/interview/55/replay?q=3",
      );
    });
  });

  describe("사용자 조작", () => {
    it("접힌 질문을 누르면 펼치고 다시 누르면 접는다", () => {
      renderFeedback();

      fireEvent.click(question(Q1));
      expect(question(Q1).getAttribute("aria-expanded")).toBe("true");
      fireEvent.click(question(Q1));

      expect(question(Q1).getAttribute("aria-expanded")).toBe("false");
    });

    it("[전체 펼치기]를 누르면 모두 펼치고 버튼을 '전체 접기'로 바꾼다", () => {
      renderFeedback();

      fireEvent.click(screen.getByRole("button", { name: "전체 펼치기" }));

      expect(screen.getAllByRole("button", { expanded: true })).toHaveLength(5);
      expect(screen.getByRole("button", { name: "전체 접기" })).toBeDefined();
    });

    it("모두 펼친 상태에서 [전체 접기]를 누르면 모두 접는다", () => {
      renderFeedback();
      fireEvent.click(screen.getByRole("button", { name: "전체 펼치기" }));

      fireEvent.click(screen.getByRole("button", { name: "전체 접기" }));

      expect(screen.queryAllByRole("button", { expanded: true })).toHaveLength(0);
    });

    it("질문을 하나씩 모두 펼치면 버튼을 '전체 접기'로 바꾼다", () => {
      // Q3(처음 펼침) · Q4 두 질문
      render(<QuestionFeedback sessionId={55} answers={RESULT.answers.slice(2, 4)} />);

      fireEvent.click(question(Q4));

      expect(screen.getByRole("button", { name: "전체 접기" })).toBeDefined();
    });
  });
});
