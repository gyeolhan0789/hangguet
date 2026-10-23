import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { AnswerCaption } from "./answer-caption";

// 기준: 사용자 승인 면접 화면 STT 표시. SDK·API 동작은 연결 훅 테스트가 확인한다.
afterEach(cleanup);

it("확정 글과 미확정 글을 함께 표시하고 미확정 글은 교체한다", () => {
  const props = {
    status: "listening" as const,
    confirmedText: "안녕하세요.",
    interimText: " 저는",
    onRetry: vi.fn(),
  };
  const { rerender } = render(<AnswerCaption {...props} />);
  expect(screen.getByLabelText("내 답변 음성 인식").textContent).toContain("안녕하세요. 저는");
  rerender(<AnswerCaption {...props} interimText=" 개발자입니다." />);
  const caption = screen.getByLabelText("내 답변 음성 인식");
  expect(caption.textContent).toContain("안녕하세요. 개발자입니다.");
  expect(caption.textContent).not.toContain(" 저는");
});

it("연결 실패 시 마지막 글을 보존하고 재연결 동작을 제공한다", () => {
  const onRetry = vi.fn();
  render(
    <AnswerCaption status="failed" confirmedText="마지막 답변" interimText="" onRetry={onRetry} />,
  );
  expect(screen.getByRole("alert").textContent).toContain("음성 인식에 연결하지 못했어요.");
  expect(screen.getByLabelText("내 답변 음성 인식").textContent).toContain("마지막 답변");
  fireEvent.click(screen.getByRole("button", { name: "다시 연결" }));
  expect(onRetry).toHaveBeenCalledOnce();
});
