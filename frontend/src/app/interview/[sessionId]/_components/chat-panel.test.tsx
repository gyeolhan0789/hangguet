import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useInterviewStore } from "@/stores/interview-store";
import { flushPromises } from "@/test/flush";
import type { CurrentQuestion } from "@/types/api";

import { CHAT_INPUT_PAUSE_MS, ChatPanel } from "./chat-panel";

vi.mock("motion/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("motion/react")>()),
  useReducedMotion: () => true,
}));

// 서버 액션 경계만 바꾼다. 실제 5.7 · 5.8 요청과 다음 질문은 E2E(interview.spec.ts)가 본다.
const submitTextAnswer = vi.fn();
const endSession = vi.fn();
vi.mock("@/lib/interview/actions", () => ({
  submitTextAnswer: (...args: unknown[]) => submitTextAnswer(...args),
  endSession: (...args: unknown[]) => endSession(...args),
}));

// 기준: Figma S06-B Chat Input(18:2606) · 웹 Swagger 5.7(TEXT 1~1,000자) · 마지막 질문(isLastQuestion)이면 5.8 자동
// · 기획 메모 S06-B(18:1050: Enter 전송 / Shift+Enter 줄바꿈) · 모션 메모 S06-B(18:2615)
// · API 명세 5.7(202 또는 409 ANSWER_ALREADY_SUBMITTED면 에이전트에 [답변 완료](answer.submit)를 보낸다)

const QUESTION: CurrentQuestion = {
  id: 303,
  seq: 3,
  content: "가장 큰 기술적 문제는 무엇이었나요?",
};

beforeEach(() => {
  useInterviewStore.getState().reset();
  // 앞 테스트의 응답 구현과 남은 once 값까지 비운다.
  submitTextAnswer.mockReset();
  endSession.mockReset();
});

describe("채팅 입력 신호 예약", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  const pause = (ms = CHAT_INPUT_PAUSE_MS) => act(() => vi.advanceTimersByTime(ms));

  it("입력이 멈춘 경계에서 최신 입력 전체를 한 번만 전송하고 순번을 증가시킨다", () => {
    const onChatInput = vi.fn();
    render(<ChatPanel sessionId={55} question={QUESTION} onChatInput={onChatInput} />);
    type("첫 글");
    pause(CHAT_INPUT_PAUSE_MS - 1);
    expect(onChatInput).not.toHaveBeenCalled();
    type("최신 입력 전체");
    pause(CHAT_INPUT_PAUSE_MS - 1);
    expect(onChatInput).not.toHaveBeenCalled();
    pause(1);
    expect(onChatInput).toHaveBeenCalledExactlyOnceWith(
      3,
      1,
      "최신 입력 전체",
      CHAT_INPUT_PAUSE_MS,
    );
    pause(CHAT_INPUT_PAUSE_MS * 2);
    expect(onChatInput).toHaveBeenCalledTimes(1);
    type("");
    pause();
    expect(onChatInput).toHaveBeenLastCalledWith(3, 2, "", CHAT_INPUT_PAUSE_MS);
    expect(submitTextAnswer).not.toHaveBeenCalled();
  });

  it("질문이 변경되면 이전 예약을 취소하고 새 답변의 순번을 처음부터 시작한다", () => {
    const onChatInput = vi.fn();
    const { rerender } = render(
      <ChatPanel sessionId={55} question={QUESTION} onChatInput={onChatInput} />,
    );
    type("전송할 글");
    pause();
    type("취소할 글");
    rerender(
      <ChatPanel
        sessionId={55}
        question={{ ...QUESTION, id: 304, seq: 4 }}
        onChatInput={onChatInput}
      />,
    );
    pause();
    expect(onChatInput).toHaveBeenCalledTimes(1);
    type("다음 질문 답변");
    pause();
    expect(onChatInput).toHaveBeenLastCalledWith(4, 1, "다음 질문 답변", CHAT_INPUT_PAUSE_MS);
  });

  it("화면 이탈·질문 없음·길이 초과 입력은 전송하지 않는다", () => {
    const onChatInput = vi.fn();
    const { rerender, unmount } = render(
      <ChatPanel sessionId={55} question={null} onChatInput={onChatInput} />,
    );
    type("질문 없음");
    pause();
    rerender(<ChatPanel sessionId={55} question={QUESTION} onChatInput={onChatInput} />);
    type("가".repeat(1001));
    pause();
    type("이탈 전 입력");
    unmount();
    pause();
    expect(onChatInput).not.toHaveBeenCalled();
  });

  it("답변 제출이 시작되면 예약을 취소하고 저장 실패 후에도 순번을 이어서 사용한다", async () => {
    const onChatInput = vi.fn();
    submitTextAnswer.mockResolvedValue({ formError: "잠시 후 다시 시도해 주세요." });
    render(<ChatPanel sessionId={55} question={QUESTION} onChatInput={onChatInput} />);
    type("첫 입력");
    pause();
    type("제출할 답변");
    await enter();
    pause();
    expect(onChatInput).toHaveBeenCalledTimes(1);
    type("고친 답변");
    pause();
    expect(onChatInput).toHaveBeenLastCalledWith(3, 2, "고친 답변", CHAT_INPUT_PAUSE_MS);
  });
});
afterEach(() => {
  cleanup();
});

const input = () => screen.getByRole("textbox", { name: "답변" }) as HTMLTextAreaElement;
const type = (value: string) => fireEvent.input(input(), { target: { value } });
const enter = async (init: Partial<KeyboardEventInit & { isComposing: boolean }> = {}) => {
  fireEvent.keyDown(input(), { key: "Enter", ...init });
  await flushPromises();
};

describe("ChatPanel (S06-B 채팅 답변)", () => {
  it.each([false, true])(
    "마지막 답변 저장 뒤 완료 신호를 호출하고 면접을 종료한다(기존 제출: %s)",
    async (alreadySubmitted) => {
      submitTextAnswer.mockResolvedValue({ isLastQuestion: !alreadySubmitted, alreadySubmitted });
      endSession.mockResolvedValue({});
      const onAnswered = vi.fn();
      render(
        <ChatPanel sessionId={55} question={{ ...QUESTION, seq: 5 }} onAnswered={onAnswered} />,
      );
      type("마지막 답변");
      await enter();
      expect(onAnswered).toHaveBeenCalledExactlyOnceWith(5, "마지막 답변");
      expect(endSession).toHaveBeenCalledTimes(1);
      expect(submitTextAnswer.mock.invocationCallOrder[0]).toBeLessThan(
        onAnswered.mock.invocationCallOrder[0],
      );
      expect(onAnswered.mock.invocationCallOrder[0]).toBeLessThan(
        endSession.mock.invocationCallOrder[0],
      );
    },
  );

  it("질문 재생 중 입력은 유지하고 버튼과 Enter 및 폼 제출을 차단한다", async () => {
    submitTextAnswer.mockResolvedValue({ isLastQuestion: false });
    const { rerender } = render(<ChatPanel sessionId={55} question={QUESTION} submissionLocked />);
    type("답변을 작성합니다.");
    expect(input().readOnly).toBe(false);
    expect(
      (screen.getByRole("button", { name: "답변 보내기" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    await enter();
    fireEvent.submit(input().closest("form")!);
    await flushPromises();
    expect(submitTextAnswer).not.toHaveBeenCalled();
    expect(input().value).toBe("답변을 작성합니다.");
    rerender(<ChatPanel sessionId={55} question={QUESTION} submissionLocked={false} />);
    await enter();
    expect(submitTextAnswer).toHaveBeenCalledTimes(1);
  });
  it("빈 입력창 안내와 글자 수 '0 / 1,000'을 보여 주고, 1,000자까지만 받는다", () => {
    render(<ChatPanel sessionId={55} question={QUESTION} />);

    expect(input().placeholder).toBe("답변을 입력하세요…");
    expect(screen.getByText("Enter 전송 · Shift + Enter 줄바꿈 · 0 / 1,000")).toBeTruthy();
    expect(input().maxLength).toBe(1000);
  });

  it("글자 수를 세어 보여 준다", () => {
    render(<ChatPanel sessionId={55} question={QUESTION} />);
    type("가".repeat(1000));
    expect(screen.getByText("Enter 전송 · Shift + Enter 줄바꿈 · 1,000 / 1,000")).toBeTruthy();
  });

  it("Enter로 5.7 답변을 내고(지금 질문 · UUID 키), 입력창을 비운 뒤 면접관이 생각하는 상태로 둔다", async () => {
    submitTextAnswer.mockResolvedValue({ isLastQuestion: false });
    render(<ChatPanel sessionId={55} question={QUESTION} />);
    type("캐시를 바꿨어요");

    await enter();

    expect(submitTextAnswer).toHaveBeenCalledWith(
      55,
      303,
      { content: "캐시를 바꿨어요" },
      expect.stringMatching(/^[0-9a-f-]{36}$/),
    );
    expect(input().value).toBe("");
    expect(useInterviewStore.getState().answeredQuestionId).toBe(303);
    expect(endSession).not.toHaveBeenCalled();
  });

  it("[보내기] 버튼으로도 낸다", async () => {
    submitTextAnswer.mockResolvedValue({ isLastQuestion: false });
    render(<ChatPanel sessionId={55} question={QUESTION} />);
    type("답");

    fireEvent.click(screen.getByRole("button", { name: "답변 보내기" }));
    await flushPromises();

    expect(submitTextAnswer).toHaveBeenCalledTimes(1);
  });

  it("Shift+Enter · 한글 조합 중 Enter는 보내지 않는다", async () => {
    render(<ChatPanel sessionId={55} question={QUESTION} />);
    type("답");

    await enter({ shiftKey: true });
    await enter({ isComposing: true });

    expect(submitTextAnswer).not.toHaveBeenCalled();
  });

  it("공백만 넣고 Enter를 누르면 보내지 않고 '필수 값입니다.'를 알린다", async () => {
    render(<ChatPanel sessionId={55} question={QUESTION} />);
    type("   ");

    await enter();

    expect(submitTextAnswer).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toBe("필수 값입니다.");
  });

  it("서버가 칸 오류를 주면 그 문구를 보여 주고 입력한 답변을 그대로 둔다", async () => {
    submitTextAnswer.mockResolvedValue({
      fieldErrors: { content: "채팅 답변은 1~1,000자입니다." },
    });
    render(<ChatPanel sessionId={55} question={QUESTION} />);
    type("답");

    await enter();

    expect(screen.getByRole("alert").textContent).toBe("채팅 답변은 1~1,000자입니다.");
    expect(input().value).toBe("답");
  });

  it("응답을 못 받은 답변을 다시 보내면 같은 키를, 서버가 실패로 답했으면(keySpent) 새 키를 쓴다", async () => {
    // 5.7이 돌려줄 결과는 테스트가 단계마다 바꾼다.
    let result: object = { formError: "잠시 후 다시 시도해 주세요." };
    submitTextAnswer.mockImplementation(async () => result);
    render(<ChatPanel sessionId={55} question={QUESTION} />);
    type("답");

    await enter();
    expect(screen.getByRole("alert").textContent).toBe("잠시 후 다시 시도해 주세요.");
    result = { formError: "이미 처리된 요청이에요.", keySpent: true };
    await enter();
    result = { isLastQuestion: false };
    await enter();

    const keys = submitTextAnswer.mock.calls.map((call) => call[3]);
    expect(keys[1]).toBe(keys[0]);
    expect(keys[2]).not.toBe(keys[1]);
  });

  it("마지막 질문이었으면 이어서 5.8 면접 끝내기를 부른다", async () => {
    submitTextAnswer.mockResolvedValue({ isLastQuestion: true });
    endSession.mockResolvedValue({});
    render(<ChatPanel sessionId={55} question={{ ...QUESTION, seq: 5 }} />);
    type("마지막 답");

    await enter();

    expect(endSession).toHaveBeenCalledWith(55, expect.stringMatching(/^[0-9a-f-]{36}$/));
  });

  it("답변이 저장되면 그 질문 순서로 에이전트에 [답변 완료]를 보내게 알린다", async () => {
    submitTextAnswer.mockResolvedValue({ isLastQuestion: false });
    const onAnswered = vi.fn();
    render(<ChatPanel sessionId={55} question={QUESTION} onAnswered={onAnswered} />);
    type("캐시를 바꿨어요");

    await enter();

    expect(onAnswered).toHaveBeenCalledExactlyOnceWith(3, "캐시를 바꿨어요");
  });

  it("이미 낸 답변이면(409 ANSWER_ALREADY_SUBMITTED) 오류 없이 [답변 완료]를 보내고 다음 질문을 기다린다", async () => {
    submitTextAnswer.mockResolvedValue({
      formError: "이미 답변한 질문이에요.",
      keySpent: true,
      alreadySubmitted: true,
    });
    const onAnswered = vi.fn();
    render(<ChatPanel sessionId={55} question={QUESTION} onAnswered={onAnswered} />);
    type("새로고침 뒤 다시 낸 답");

    await enter();

    expect(onAnswered).toHaveBeenCalledExactlyOnceWith(3, "새로고침 뒤 다시 낸 답");
    expect(screen.queryByRole("alert")).toBeNull();
    // 이미 낸 답변은 보낸 답변 말풍선을 띄우지 않고 입력창만 비운다
    expect(screen.queryByText("새로고침 뒤 다시 낸 답")).toBeNull();
    expect(input().value).toBe("");
    expect(useInterviewStore.getState().answeredQuestionId).toBe(303);
    // 마지막 질문이 아니면 끝내지 않는다
    expect(endSession).not.toHaveBeenCalled();
  });

  it("이미 낸 답변이 마지막 질문이면 이어서 5.8 면접 끝내기를 부른다", async () => {
    submitTextAnswer.mockResolvedValue({
      formError: "이미 답변한 질문이에요.",
      keySpent: true,
      alreadySubmitted: true,
    });
    endSession.mockResolvedValue({});
    const onAnswered = vi.fn();
    render(<ChatPanel sessionId={55} question={{ ...QUESTION, seq: 5 }} onAnswered={onAnswered} />);
    type("마지막 답");

    await enter();

    expect(onAnswered).toHaveBeenCalledExactlyOnceWith(5, "마지막 답");
    expect(endSession).toHaveBeenCalledTimes(1);
  });

  it("그 밖의 실패면 [답변 완료]를 보내지 않고 문구를 보여 준다", async () => {
    submitTextAnswer.mockResolvedValue({
      formError: "지금은 할 수 없는 요청이에요.",
      keySpent: true,
    });
    const onAnswered = vi.fn();
    render(<ChatPanel sessionId={55} question={QUESTION} onAnswered={onAnswered} />);
    type("답");

    await enter();

    expect(onAnswered).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toBe("지금은 할 수 없는 요청이에요.");
    expect(useInterviewStore.getState().answeredQuestionId).toBeNull();
  });

  it("질문 ID 전에 질문 메시지(inputQuestionSeq)만 와도 쓸 수 있고 입력 신호를 그 질문으로 보내지만, ID를 받기 전에는 내지 않는다", async () => {
    vi.useFakeTimers();
    submitTextAnswer.mockResolvedValue({ isLastQuestion: false });
    const onChatInput = vi.fn();
    const { rerender } = render(
      <ChatPanel sessionId={55} question={null} inputQuestionSeq={4} onChatInput={onChatInput} />,
    );
    expect(input().readOnly).toBe(false);
    type("먼저 쓴 답");
    act(() => vi.advanceTimersByTime(CHAT_INPUT_PAUSE_MS));
    expect(onChatInput).toHaveBeenCalledWith(4, 1, "먼저 쓴 답", expect.any(Number));
    expect(screen.getByRole("button", { name: "답변 보내기" })).toHaveProperty("disabled", true);
    await enter();
    fireEvent.submit(input().closest("form")!);
    await flushPromises();
    expect(submitTextAnswer).not.toHaveBeenCalled();

    rerender(
      <ChatPanel
        sessionId={55}
        question={{ ...QUESTION, id: 304, seq: 4 }}
        inputQuestionSeq={4}
        onChatInput={onChatInput}
      />,
    );
    await enter();
    expect(submitTextAnswer).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });

  it("다음 질문을 기다리는 동안(질문 없음)은 입력 · 보내기를 막는다", async () => {
    render(<ChatPanel sessionId={55} question={null} />);

    expect(input().readOnly).toBe(true);
    expect(input().getAttribute("aria-disabled")).toBe("true");
    expect(screen.getByRole("button", { name: "답변 보내기" })).toHaveProperty("disabled", true);
  });

  it("답변을 낸 뒤 다음 질문을 기다리는 동안에도 입력칸 포커스(주황 테두리)를 잃지 않고, 다음 질문이 오면 바로 쓸 수 있다", async () => {
    submitTextAnswer.mockResolvedValue({ isLastQuestion: false });
    const { rerender } = render(<ChatPanel sessionId={55} question={QUESTION} />);
    input().focus();
    type("캐시를 바꿨어요");
    await enter();
    // 다음 질문을 기다리는 중(질문 없음): 막지만 포커스는 그대로다
    rerender(<ChatPanel sessionId={55} question={null} />);
    expect(input().readOnly).toBe(true);
    expect(document.activeElement).toBe(input());
    rerender(<ChatPanel sessionId={55} question={{ ...QUESTION, id: 304, seq: 4 }} />);
    expect(input().readOnly).toBe(false);
    expect(document.activeElement).toBe(input());
  });
});
