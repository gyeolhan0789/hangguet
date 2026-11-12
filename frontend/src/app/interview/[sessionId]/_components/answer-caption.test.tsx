// 기준: Figma S06 STT Bubble(18:2539) · Figma S06-Q 질문 듣는 중(344:1577) · 면접방 메시지(interview.stt 확정 글 · 미확정 글, question started ~ ended 동안 답변 잠금)
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AnswerCaption } from "./answer-caption";

// 경계 mock: 없음

const caption = () => screen.getByRole("region", { name: "내 답변 음성 인식" });

describe("AnswerCaption · 내 답변 음성 인식 상자", () => {
  describe("화면 표시", () => {
    it("확정 글 뒤에 미확정 글을 이어 보인다", () => {
      render(<AnswerCaption status="listening" confirmedText="안녕하세요." interimText=" 저는" />);

      expect(caption().textContent).toContain("안녕하세요. 저는");
    });

    it("미확정 글만 있어도 안내 대신 자막을 보인다", () => {
      render(<AnswerCaption status="listening" confirmedText="" interimText="저는" />);

      expect(caption().textContent).toBe("내 답변 · 듣는 중저는");
    });

    it.each([
      { label: "시작 전", status: "idle" },
      { label: "연결하는 중", status: "connecting" },
    ] as const)(
      "자막이 없고 음성 인식이 '$label'이면 '음성 인식에 연결하고 있어요.'를 보인다",
      ({ status }) => {
        render(<AnswerCaption status={status} confirmedText="" interimText="" />);

        expect(caption().textContent).toContain("음성 인식에 연결하고 있어요.");
      },
    );

    it("자막이 없고 연결됐으면 '말씀하신 내용이 여기에 표시돼요.'를 보인다", () => {
      render(<AnswerCaption status="listening" confirmedText="" interimText="" />);

      expect(caption().textContent).toContain("말씀하신 내용이 여기에 표시돼요.");
    });

    it("질문을 말하는 중(locked)이면 자막 대신 '질문이 끝나면 말씀해 주세요'를 보이고 머리글을 '내 답변'으로 둔다", () => {
      render(<AnswerCaption status="listening" confirmedText="이전 글" interimText="" locked />);

      expect(caption().textContent).toBe("내 답변질문이 끝나면 말씀해 주세요");
    });

    it("질문 중이 아니면 머리글을 '내 답변 · 듣는 중'으로 보인다", () => {
      render(<AnswerCaption status="listening" confirmedText="" interimText="" />);

      expect(caption().textContent).toContain("내 답변 · 듣는 중");
    });
  });
});
