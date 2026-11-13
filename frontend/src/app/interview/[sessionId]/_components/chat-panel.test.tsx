// 기준: API 명세 10.10(그룹 5.7: isLastQuestion은 늘 false) · 10.9(새로고침 복구 글) · Figma S06-B Chat Input(18:2606) · 웹 Swagger 5.7 답변 제출(TEXT · content 1~1,000자) · 5.8 면접 끝내기(isLastQuestion이면 자동) · 기획 메모 S06-B(18:1050: Enter 전송 / Shift+Enter 줄바꿈) · API 명세 5.7(202 또는 409 ANSWER_ALREADY_SUBMITTED면 에이전트에 [답변 완료])
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { endSession, submitTextAnswer, type TextAnswerActionResult } from "@/lib/interview/actions";
import { useInterviewStore } from "@/stores/interview-store";
import { deferred } from "@/test/deferred";
import { flushPromises } from "@/test/flush";
import type { CurrentQuestion } from "@/types/api";

import { ChatPanel } from "./chat-panel";

// 경계 mock: 서버 액션(5.7 · 5.8)과 연출(motion). 답변 스키마는 진짜로 쓴다
vi.mock("@/lib/interview/actions", () => ({ submitTextAnswer: vi.fn(), endSession: vi.fn() }));
vi.mock("motion/react", async (importOriginal) =>
  (await import("@/test/motion")).reducedMotion(importOriginal),
);

// 예시 데이터: Swagger 5.2 currentQuestion 예시(질문 303 · 3번)
const QUESTION: CurrentQuestion = {
  id: 303,
  seq: 3,
  content: "가장 큰 기술적 문제는 무엇이었나요?",
};
const LAST_QUESTION: CurrentQuestion = { id: 305, seq: 5, content: "마지막으로 할 말이 있나요?" };
const FAILED: TextAnswerActionResult = { formError: "잠시 후 다시 시도해 주세요." };
const ALREADY: TextAnswerActionResult = {
  formError: "이미 답변한 질문이에요.",
  keySpent: true,
  alreadySubmitted: true,
};

const input = () => screen.getByRole<HTMLTextAreaElement>("textbox", { name: "답변" });
const sendButton = () => screen.getByRole("button", { name: "답변 보내기" });
const type = (value: string) => fireEvent.input(input(), { target: { value } });
async function enter(init: Partial<KeyboardEventInit> = {}) {
  fireEvent.keyDown(input(), { key: "Enter", ...init });
  await flushPromises();
}
/** n번째 5.7 요청의 멱등 키 */
const answerKey = (n: number) => vi.mocked(submitTextAnswer).mock.calls[n][3];
const pause = (ms: number) => act(() => vi.advanceTimersByTime(ms));

beforeEach(() => {
  useInterviewStore.getState().reset();
  vi.mocked(submitTextAnswer).mockResolvedValue({ isLastQuestion: false });
  vi.mocked(endSession).mockResolvedValue({ leveledUp: false });
});

describe("ChatPanel · 채팅 답변 입력", () => {
  describe("답변 입력창", () => {
    describe("화면 표시", () => {
      it("질문도 질문 메시지도 없으면 입력창을 읽기 전용으로 막고 보내기를 막는다", () => {
        render(<ChatPanel sessionId={55} question={null} />);

        expect(input().readOnly).toBe(true);
        expect(sendButton()).toHaveProperty("disabled", true);
      });

      it("처음 글(initialText)이 있으면 그 글로 시작한다", () => {
        render(<ChatPanel sessionId={55} question={QUESTION} initialText="쓰던 답변" />);

        expect(input().value).toBe("쓰던 답변");
      });

      it("질문 메시지만 있으면 쓸 수 있지만 보내기는 막는다", () => {
        render(<ChatPanel sessionId={55} question={null} inputQuestionSeq={4} />);

        expect(input().readOnly).toBe(false);
        expect(sendButton()).toHaveProperty("disabled", true);
      });

      it("보내기가 잠기면(질문 음성 중) 입력은 그대로 두고 보내기 버튼을 막는다", () => {
        render(<ChatPanel sessionId={55} question={QUESTION} submissionLocked />);

        expect(input().readOnly).toBe(false);
        expect(sendButton()).toHaveProperty("disabled", true);
      });

      it("답변을 내는 중이면 입력창을 읽기 전용으로 막는다", async () => {
        const response = deferred<TextAnswerActionResult>();
        vi.mocked(submitTextAnswer).mockReturnValue(response.promise);
        render(<ChatPanel sessionId={55} question={QUESTION} />);
        type("캐시를 바꿨어요");

        await enter();

        expect(input().readOnly).toBe(true);
        await act(async () => response.resolve({ isLastQuestion: false }));
      });
    });
  });

  describe("답변 보내기", () => {
    describe("사용자 조작", () => {
      it("Enter를 누르면 답변을 낸다", async () => {
        render(<ChatPanel sessionId={55} question={QUESTION} />);
        type("캐시를 바꿨어요");

        await enter();

        expect(submitTextAnswer).toHaveBeenCalledTimes(1);
      });

      it("[답변 보내기]를 누르면 답변을 낸다", async () => {
        render(<ChatPanel sessionId={55} question={QUESTION} />);
        type("캐시를 바꿨어요");

        fireEvent.click(sendButton());
        await flushPromises();

        expect(submitTextAnswer).toHaveBeenCalledTimes(1);
      });

      it.each([
        { label: "Shift+Enter", init: { shiftKey: true } },
        { label: "한글 조합 중", init: { isComposing: true } },
      ])("'$label'이면 Enter를 눌러도 내지 않는다", async ({ init }) => {
        render(<ChatPanel sessionId={55} question={QUESTION} />);
        type("캐시를 바꿨어요");

        await enter(init);

        expect(submitTextAnswer).not.toHaveBeenCalled();
      });

      it("보내기가 잠긴 동안에는 Enter · 폼 제출로도 내지 않는다", async () => {
        render(<ChatPanel sessionId={55} question={QUESTION} submissionLocked />);
        type("캐시를 바꿨어요");

        await enter();
        fireEvent.submit(input().closest("form")!);
        await flushPromises();

        expect(submitTextAnswer).not.toHaveBeenCalled();
        expect(input().value).toBe("캐시를 바꿨어요");
      });

      it("답변이 저장되면 입력창을 비우고 그 질문을 답한 질문으로 기억한다", async () => {
        render(<ChatPanel sessionId={55} question={QUESTION} />);
        type("캐시를 바꿨어요");

        await enter();

        expect(input().value).toBe("");
        expect(useInterviewStore.getState().answeredQuestionId).toBe(303);
      });

      it("답변이 저장되면 그 질문 순서와 글로 [답변 완료]를 알린다", async () => {
        const onAnswered = vi.fn();
        render(<ChatPanel sessionId={55} question={QUESTION} onAnswered={onAnswered} />);
        type("캐시를 바꿨어요");

        await enter();

        expect(onAnswered).toHaveBeenCalledExactlyOnceWith(3, "캐시를 바꿨어요");
      });

      it("답변을 내기 시작하면 내기 시작을 알린다", async () => {
        const response = deferred<TextAnswerActionResult>();
        vi.mocked(submitTextAnswer).mockReturnValue(response.promise);
        const onSubmitStart = vi.fn();
        render(<ChatPanel sessionId={55} question={QUESTION} onSubmitStart={onSubmitStart} />);
        type("캐시를 바꿨어요");

        await enter();

        expect(onSubmitStart).toHaveBeenCalledTimes(1);
        await act(async () => response.resolve({ isLastQuestion: false }));
      });

      it("답변이 저장되면 보낸 글을 말풍선으로 띄운다", async () => {
        // 말풍선은 연출이 끝나면 사라진다. 가짜 타이머로 연출 프레임을 멈춰 실제 시간에 기대지 않는다
        vi.useFakeTimers();
        render(<ChatPanel sessionId={55} question={QUESTION} />);
        type("캐시를 바꿨어요");

        await enter();

        expect(screen.getByText("캐시를 바꿨어요")).toBeDefined();
      });

      it("같은 질문에 같은 글을 다시 내면 같은 멱등 키를 쓴다", async () => {
        vi.mocked(submitTextAnswer).mockResolvedValue(FAILED);
        render(<ChatPanel sessionId={55} question={QUESTION} />);
        type("캐시를 바꿨어요");
        await enter();

        await enter();

        expect(answerKey(1)).toBe(answerKey(0));
      });

      it("글이 바뀌면 새 멱등 키를 쓴다", async () => {
        vi.mocked(submitTextAnswer).mockResolvedValue(FAILED);
        render(<ChatPanel sessionId={55} question={QUESTION} />);
        type("캐시를 바꿨어요");
        await enter();

        type("캐시 만료 시간을 바꿨어요");
        await enter();

        expect(answerKey(1)).not.toBe(answerKey(0));
      });

      it("질문이 바뀌면 같은 글이어도 새 멱등 키를 쓴다", async () => {
        vi.mocked(submitTextAnswer).mockResolvedValue(FAILED);
        const { rerender } = render(<ChatPanel sessionId={55} question={QUESTION} />);
        type("캐시를 바꿨어요");
        await enter();

        rerender(<ChatPanel sessionId={55} question={{ ...QUESTION, id: 304, seq: 4 }} />);
        await enter();

        expect(answerKey(1)).not.toBe(answerKey(0));
      });
    });

    describe("입력 검증", () => {
      it("공백만 넣고 내면 보내지 않고 칸 오류를 알린다", async () => {
        render(<ChatPanel sessionId={55} question={QUESTION} />);
        type("   ");

        await enter();

        expect(submitTextAnswer).not.toHaveBeenCalled();
        expect(screen.getByRole("alert").textContent).toBe("필수 값입니다.");
      });
    });

    describe("오류 처리", () => {
      it("서버가 칸 오류를 주면 그 문구를 보이고 입력한 글을 그대로 둔다", async () => {
        vi.mocked(submitTextAnswer).mockResolvedValue({
          fieldErrors: { content: "채팅 답변은 1~1,000자입니다." },
        });
        render(<ChatPanel sessionId={55} question={QUESTION} />);
        type("캐시를 바꿨어요");

        await enter();

        expect(screen.getByRole("alert").textContent).toBe("채팅 답변은 1~1,000자입니다.");
        expect(input().value).toBe("캐시를 바꿨어요");
      });

      it("이미 낸 답변이면 오류 없이 입력창을 비우고 [답변 완료]를 알리되 말풍선은 띄우지 않는다", async () => {
        // 말풍선이 떴다가 연출로 사라진 것과 구분되게 가짜 타이머로 연출 프레임을 멈춘다
        vi.useFakeTimers();
        vi.mocked(submitTextAnswer).mockResolvedValue(ALREADY);
        const onAnswered = vi.fn();
        render(<ChatPanel sessionId={55} question={QUESTION} onAnswered={onAnswered} />);
        type("새로고침 뒤 다시 낸 답");

        await enter();

        expect(screen.queryByRole("alert")).toBeNull();
        expect(input().value).toBe("");
        expect(onAnswered).toHaveBeenCalledExactlyOnceWith(3, "새로고침 뒤 다시 낸 답");
        expect(screen.queryByText("새로고침 뒤 다시 낸 답")).toBeNull();
      });

      it("그 밖의 실패면 문구를 보이고 [답변 완료]를 알리지 않는다", async () => {
        vi.mocked(submitTextAnswer).mockResolvedValue({
          formError: "지금은 할 수 없는 요청이에요.",
          keySpent: true,
        });
        const onAnswered = vi.fn();
        render(<ChatPanel sessionId={55} question={QUESTION} onAnswered={onAnswered} />);
        type("캐시를 바꿨어요");

        await enter();

        expect(screen.getByRole("alert").textContent).toBe("지금은 할 수 없는 요청이에요.");
        expect(onAnswered).not.toHaveBeenCalled();
      });

      it("서버가 실패로 답했으면(keySpent) 같은 글을 다시 내도 새 멱등 키를 쓴다", async () => {
        vi.mocked(submitTextAnswer).mockResolvedValue({ ...FAILED, keySpent: true });
        render(<ChatPanel sessionId={55} question={QUESTION} />);
        type("캐시를 바꿨어요");
        await enter();

        await enter();

        expect(answerKey(1)).not.toBe(answerKey(0));
      });

      it("다시 내면 이전 실패 문구를 지운다", async () => {
        vi.mocked(submitTextAnswer).mockResolvedValueOnce(FAILED);
        const response = deferred<TextAnswerActionResult>();
        vi.mocked(submitTextAnswer).mockReturnValueOnce(response.promise);
        render(<ChatPanel sessionId={55} question={QUESTION} />);
        type("캐시를 바꿨어요");
        await enter();

        await enter();

        expect(screen.queryByRole("alert")).toBeNull();
        await act(async () => response.resolve({ isLastQuestion: false }));
      });
    });

    describe("중복 · 경쟁 처리", () => {
      it("답변을 내는 동안 다시 Enter를 눌러도 한 번만 보낸다", async () => {
        const response = deferred<TextAnswerActionResult>();
        vi.mocked(submitTextAnswer).mockReturnValue(response.promise);
        render(<ChatPanel sessionId={55} question={QUESTION} />);
        type("캐시를 바꿨어요");
        await enter();

        await enter();

        expect(submitTextAnswer).toHaveBeenCalledTimes(1);
        await act(async () => response.resolve({ isLastQuestion: false }));
      });
    });
  });

  describe("마지막 질문 끝내기", () => {
    describe("사용자 조작", () => {
      it("마지막 질문 답변이 저장되면 이어서 면접을 끝낸다", async () => {
        vi.mocked(submitTextAnswer).mockResolvedValue({ isLastQuestion: true });
        render(<ChatPanel sessionId={55} question={LAST_QUESTION} />);
        type("마지막 답");

        await enter();

        expect(endSession).toHaveBeenCalledTimes(1);
      });

      it("끝내기가 성공하면 레벨업을 기억한다", async () => {
        vi.mocked(submitTextAnswer).mockResolvedValue({ isLastQuestion: true });
        vi.mocked(endSession).mockResolvedValue({ leveledUp: true });
        render(<ChatPanel sessionId={55} question={LAST_QUESTION} />);
        type("마지막 답");

        await enter();

        expect(useInterviewStore.getState().leveledUp).toBe(true);
      });
    });

    describe("경계값", () => {
      it("이미 낸 답변이 5번째 질문이면 이어서 면접을 끝낸다", async () => {
        vi.mocked(submitTextAnswer).mockResolvedValue(ALREADY);
        render(<ChatPanel sessionId={55} question={LAST_QUESTION} />);
        type("마지막 답");

        await enter();

        expect(endSession).toHaveBeenCalledTimes(1);
      });

      it("그룹 면접(API 명세 10.10: 질문 순서가 1~6)이면 이미 낸 답변이 5번째 질문이어도 끝내지 않는다", async () => {
        vi.mocked(submitTextAnswer).mockResolvedValue(ALREADY);
        render(<ChatPanel sessionId={55} question={LAST_QUESTION} group />);
        type("다섯 번째 답");

        await enter();

        expect(endSession).not.toHaveBeenCalled();
      });

      it("이미 낸 답변이 4번째 질문이면 끝내지 않는다", async () => {
        vi.mocked(submitTextAnswer).mockResolvedValue(ALREADY);
        render(<ChatPanel sessionId={55} question={{ ...QUESTION, id: 304, seq: 4 }} />);
        type("네 번째 답");

        await enter();

        expect(endSession).not.toHaveBeenCalled();
      });
    });

    describe("오류 처리", () => {
      it("끝내기가 실패하면 서버 문구를 보인다", async () => {
        vi.mocked(submitTextAnswer).mockResolvedValue({ isLastQuestion: true });
        // 예시: Swagger 5.8 409 INVALID_SESSION_STATE detail(대체 문구와 다르게)
        vi.mocked(endSession).mockResolvedValue({ formError: "지금은 할 수 없는 요청이에요." });
        render(<ChatPanel sessionId={55} question={LAST_QUESTION} />);
        type("마지막 답");

        await enter();

        expect(screen.getByRole("alert").textContent).toBe("지금은 할 수 없는 요청이에요.");
      });
    });
  });

  describe("입력 신호", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    describe("상태 변화", () => {
      it("글이 바뀌면 바뀐 글을 onTextChange로 알린다", () => {
        const onTextChange = vi.fn();
        render(<ChatPanel sessionId={55} question={QUESTION} onTextChange={onTextChange} />);

        type("캐시");

        expect(onTextChange).toHaveBeenCalledWith("캐시");
      });

      it("입력 신호를 보낼 때마다 순번을 하나씩 늘린다", () => {
        const onChatInput = vi.fn();
        render(<ChatPanel sessionId={55} question={QUESTION} onChatInput={onChatInput} />);
        type("첫 글");
        pause(800);

        type("첫 글 다음");
        pause(800);

        expect(onChatInput.mock.calls.map((call) => call[1])).toEqual([1, 2]);
      });

      it("질문 순서가 바뀌면 예약을 취소하고 순번을 1부터 다시 센다", () => {
        const onChatInput = vi.fn();
        const { rerender } = render(
          <ChatPanel sessionId={55} question={QUESTION} onChatInput={onChatInput} />,
        );
        type("보낸 글");
        pause(800);
        type("취소할 글");

        rerender(
          <ChatPanel
            sessionId={55}
            question={{ ...QUESTION, id: 304, seq: 4 }}
            onChatInput={onChatInput}
          />,
        );
        pause(800);
        type("다음 질문 답변");
        pause(800);

        expect(onChatInput.mock.calls.map((call) => call.slice(0, 3))).toEqual([
          [3, 1, "보낸 글"],
          [4, 1, "다음 질문 답변"],
        ]);
      });
    });

    describe("입력 검증", () => {
      // 받을 곳이 없으면 예약된 신호가 없는 콜백을 불러 진행 중에 오류가 난다(그 오류가 없어야 통과)
      it.each([
        { label: "받을 곳 없음", listen: false, text: "답" },
        { label: "1,000자 초과", listen: true, text: "가".repeat(1001) },
      ])("'$label'이면 입력 신호를 보내지 않는다", ({ listen, text }) => {
        const onChatInput = vi.fn();
        render(
          <ChatPanel
            sessionId={55}
            question={QUESTION}
            onChatInput={listen ? onChatInput : undefined}
          />,
        );

        type(text);
        pause(800);

        expect(onChatInput).not.toHaveBeenCalled();
      });
    });

    describe("경계값", () => {
      it("정확히 1,000자면 입력 신호를 보낸다", () => {
        const onChatInput = vi.fn();
        render(<ChatPanel sessionId={55} question={QUESTION} onChatInput={onChatInput} />);

        type("가".repeat(1000));
        pause(800);

        expect(onChatInput).toHaveBeenCalledTimes(1);
      });
    });

    describe("중복 · 경쟁 처리", () => {
      it("답변을 내기 시작하면 입력 신호 예약을 취소한다", async () => {
        const response = deferred<TextAnswerActionResult>();
        vi.mocked(submitTextAnswer).mockReturnValue(response.promise);
        const onChatInput = vi.fn();
        render(<ChatPanel sessionId={55} question={QUESTION} onChatInput={onChatInput} />);
        type("캐시를 바꿨어요");

        await enter();
        pause(800);

        expect(onChatInput).not.toHaveBeenCalled();
        await act(async () => response.resolve({ isLastQuestion: false }));
      });
    });

    describe("시간 경과", () => {
      it("입력이 800ms 멈추면 그 질문 순서 · 순번 · 지금 글 · 멈춘 시간으로 입력 신호를 한 번 보낸다", () => {
        const onChatInput = vi.fn();
        render(<ChatPanel sessionId={55} question={QUESTION} onChatInput={onChatInput} />);
        type("캐시를 바꿨어요");

        pause(799);
        expect(onChatInput).not.toHaveBeenCalled();

        pause(1);
        pause(1600);
        expect(onChatInput).toHaveBeenCalledExactlyOnceWith(3, 1, "캐시를 바꿨어요", 800);
      });

      it("800ms 안에 다시 입력하면 앞 예약을 취소하고 마지막 입력만 보낸다", () => {
        const onChatInput = vi.fn();
        render(<ChatPanel sessionId={55} question={QUESTION} onChatInput={onChatInput} />);
        type("캐시");
        pause(799);

        type("캐시를 바꿨어요");
        pause(800);

        expect(onChatInput).toHaveBeenCalledExactlyOnceWith(3, 1, "캐시를 바꿨어요", 800);
      });
    });

    describe("정리", () => {
      it("화면을 떠나면 입력 신호 예약을 취소한다", () => {
        const onChatInput = vi.fn();
        const { unmount } = render(
          <ChatPanel sessionId={55} question={QUESTION} onChatInput={onChatInput} />,
        );
        type("캐시를 바꿨어요");

        unmount();
        pause(800);

        expect(onChatInput).not.toHaveBeenCalled();
      });
    });
  });
});
