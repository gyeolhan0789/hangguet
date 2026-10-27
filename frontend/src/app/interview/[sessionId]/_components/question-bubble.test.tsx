import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useInterviewStore } from "@/stores/interview-store";

import { QuestionBubble, ShowUiButton } from "./question-bubble";

vi.mock("motion/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("motion/react")>()),
  useReducedMotion: () => true,
}));

// 기준: 사용자 요청(2026-10-27: 질문 펼치기 · 접기, 접으면 '…' 말줄임) · Figma S06 Interviewer Bubble(18:2530) · 모션 메모 S06(18:2569: 타자 등장) · S06-B(18:2615: '생각 중' 점 3개)

beforeEach(() => useInterviewStore.getState().reset());
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

  it("접기를 누르면 질문을 한 줄로 줄이고(말줄임), 펼치기로 되돌린다. 다음 질문에서도 고른 대로 둔다", () => {
    const { rerender } = render(
      <QuestionBubble interviewer="악마 면접관" question={{ seq: 3, content: "긴 질문" }} />,
    );
    const text = () => screen.getByText("긴 질문", { selector: ".sr-only" }).parentElement!;
    expect(text().className).not.toContain("line-clamp-1");

    fireEvent.click(screen.getByRole("button", { name: "질문 접기" }));
    expect(text().className).toContain("line-clamp-1");
    expect(useInterviewStore.getState().collapsed).toBe(true);
    expect(screen.getByRole("button", { name: "질문 펼치기" }).getAttribute("aria-expanded")).toBe(
      "false",
    );

    rerender(
      <QuestionBubble interviewer="악마 면접관" question={{ seq: 4, content: "다음 질문" }} />,
    );
    expect(
      screen.getByText("다음 질문", { selector: ".sr-only" }).parentElement!.className,
    ).toContain("line-clamp-1");

    // 바뀌는 동안 나가는 말풍선이 잠시 남으므로 새 말풍선(마지막)의 버튼을 누른다
    fireEvent.click(screen.getAllByRole("button", { name: "질문 펼치기" }).at(-1)!);
    expect(
      screen.getByText("다음 질문", { selector: ".sr-only" }).parentElement!.className,
    ).not.toContain("line-clamp-1");
  });

  it("눈 버튼을 누르면 화면 숨기기를 켜고, 숨긴 동안에는 [화면 보이기] 하나만 남아 누르면 되돌린다", () => {
    render(
      <>
        <QuestionBubble interviewer="악마 면접관" question={{ seq: 3, content: "들을 질문" }} />
        <ShowUiButton />
      </>,
    );
    expect(screen.queryByRole("button", { name: "화면 보이기" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "화면 숨기기" }));
    expect(useInterviewStore.getState().uiHidden).toBe(true);
    const show = screen.getByRole("button", { name: "화면 보이기" });
    expect(show.getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(show);
    expect(useInterviewStore.getState().uiHidden).toBe(false);
    expect(screen.queryByRole("button", { name: "화면 보이기" })).toBeNull();
  });

  it("다음 질문을 기다리는 중('생각 중')에도 눈 · 꺾쇠가 있어 화면을 숨기고 기록을 접을 수 있다", () => {
    render(<QuestionBubble interviewer="악마 면접관" question={null} />);
    fireEvent.click(screen.getByRole("button", { name: "질문 접기" }));
    expect(useInterviewStore.getState().collapsed).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "화면 숨기기" }));
    expect(useInterviewStore.getState().uiHidden).toBe(true);
  });

  it("다음 질문을 기다리는 중이면 '생각 중' 점 3개를 보여 준다", () => {
    render(<QuestionBubble interviewer="악마 면접관" question={null} />);
    expect(screen.getByRole("status", { name: "면접관이 생각하는 중" })).toBeTruthy();
  });
});
