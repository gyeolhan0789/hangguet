import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { QuestionBubble } from "./question-bubble";

vi.mock("motion/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("motion/react")>()),
  useReducedMotion: () => true,
}));

// 기준: Figma S06 Interviewer Bubble(18:2530) · 모션 메모 S06(18:2569: 타자 등장) · S06-B(18:2615: '생각 중' 점 3개)

afterEach(cleanup);

describe("QuestionBubble (면접관 질문 말풍선)", () => {
  it("면접관 이름과 질문을 보여 준다. 화면 읽기 프로그램은 질문 전체를 한 번에 읽는다", () => {
    render(
      <QuestionBubble
        interviewer="악마 면접관"
        question={{ id: 303, seq: 3, content: "가장 큰 기술적 문제는 무엇이었나요?" }}
      />,
    );

    const bubble = screen.getByRole("region", { name: "악마 면접관 질문" });
    expect(bubble.textContent).toContain("악마 면접관");
    expect(
      screen.getByText("가장 큰 기술적 문제는 무엇이었나요?", { selector: ".sr-only" }),
    ).toBeTruthy();
    expect(screen.queryByRole("status", { name: "면접관이 생각하는 중" })).toBeNull();
  });

  it("다음 질문을 기다리는 중이면 '생각 중' 점 3개를 보여 준다", () => {
    render(<QuestionBubble interviewer="악마 면접관" question={null} />);
    expect(screen.getByRole("status", { name: "면접관이 생각하는 중" })).toBeTruthy();
  });
});
