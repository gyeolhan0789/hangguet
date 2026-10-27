import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";

import { AnswerCaption } from "./answer-caption";

// 기준: Figma S06 STT Bubble(18:2539) · S06-Q 질문 듣는 중(344:1577)
// · API 명세 면접방 메시지(interview.stt 확정 글 · 미확정 글, question started ~ ended 동안 답변 잠금)
afterEach(cleanup);

const caption = () => screen.getByRole("region", { name: "내 답변 음성 인식" });

it("확정 글과 미확정 글을 함께 표시하고 미확정 글은 교체한다", () => {
  const props = {
    status: "listening" as const,
    confirmedText: "안녕하세요.",
    interimText: " 저는",
  };
  const { rerender } = render(<AnswerCaption {...props} />);
  expect(caption().textContent).toContain("안녕하세요. 저는");
  rerender(<AnswerCaption {...props} interimText=" 개발자입니다." />);
  expect(caption().textContent).toContain("안녕하세요. 개발자입니다.");
  expect(caption().textContent).not.toContain(" 저는");
});

it.each([
  ["connecting", "음성 인식에 연결하고 있어요."],
  ["listening", "말씀하신 내용이 여기에 표시돼요."],
] as const)("글이 없으면 연결 상태(%s)에 맞는 안내를 보인다", (status, text) => {
  render(<AnswerCaption status={status} confirmedText="" interimText="" />);
  expect(caption().textContent).toContain(text);
  expect(caption().textContent).toContain("내 답변 · 듣는 중");
});

it("질문을 말하는 중(locked)이면 답을 받지 않는다고 알리고 자막 글을 보이지 않는다", () => {
  render(
    <AnswerCaption status="listening" confirmedText="이전 글" interimText="" locked>
      <span data-testid="bottom-row" />
    </AnswerCaption>,
  );
  expect(caption().textContent).toContain("질문이 끝나면 말씀해 주세요");
  expect(caption().textContent).not.toContain("이전 글");
  expect(caption().textContent).not.toContain("듣는 중");
  // 맨 아래 줄(파형)은 상자 안에 들어간다
  expect(caption().querySelector('[data-testid="bottom-row"]')).toBeTruthy();
});
