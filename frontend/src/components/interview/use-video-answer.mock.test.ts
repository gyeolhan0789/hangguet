import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AUTO_SUBMIT_SILENCE_MS, NO_SPEECH_TIMEOUT_MS } from "@/lib/interview/auto-submit";

import {
  MOCK_START_DELAY_MS,
  MOCK_SUBMIT_DELAY_MS,
  MOCK_WORD_INTERVAL_MS,
  useMockVideoAnswer,
  type MockVideoAnswerOptions,
} from "./use-video-answer.mock";

// 기준: video-answer-contract.ts(화상 답변 훅 계약) · Swagger 5.11 면접관 리액션 200 예시
// 목 훅이 시나리오마다 계약의 상태를 정해진 순서로 거치고, onSubmitted · onReaction을 호출하는지 확인한다.

/** 답변 단어 수(목 훅의 두 문장: 5단어 + 6단어) */
const WORD_COUNT = 11;
const FIRST_SENTENCE_WORDS = 5;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
});

afterEach(() => {
  // globals를 켜지 않아 Testing Library가 자동으로 정리하지 않으므로 직접 정리한다.
  cleanup();
  vi.useRealTimers();
});

function renderMock(options: Partial<MockVideoAnswerOptions> = {}) {
  const onSubmitted = vi.fn();
  const onReaction = vi.fn();
  const props: MockVideoAnswerOptions = {
    sessionId: 1,
    questionId: 10,
    questionText: "가장 어려웠던 문제는 무엇인가요?",
    onSubmitted,
    onReaction,
    ...options,
  };
  const hook = renderHook((current: MockVideoAnswerOptions) => useMockVideoAnswer(current), {
    initialProps: props,
  });
  return { ...hook, props, onSubmitted, onReaction };
}

function advance(ms: number) {
  act(() => vi.advanceTimersByTime(ms));
}

/** 답변 시작 뒤 듣는 중이 될 때까지 진행한다 */
function startListening(hook: ReturnType<typeof renderMock>) {
  act(() => void hook.result.current.start());
  advance(MOCK_START_DELAY_MS);
}

describe("useMockVideoAnswer normal", () => {
  it("시작 중 → 듣는 중으로 변경되고 자막이 한 단어씩 늘어난다", () => {
    const hook = renderMock();
    act(() => void hook.result.current.start());
    expect(hook.result.current.phase).toBe("starting");
    expect(hook.result.current.sttStatus).toBe("connecting");

    advance(MOCK_START_DELAY_MS);
    expect(hook.result.current.phase).toBe("listening");
    expect(hook.result.current.sttStatus).toBe("listening");
    expect(hook.result.current.caption).toBe("");

    advance(MOCK_WORD_INTERVAL_MS);
    expect(hook.result.current.caption).toBe("캐시");
    advance(MOCK_WORD_INTERVAL_MS);
    expect(hook.result.current.caption).toBe("캐시 무효화");
  });

  it("문장이 끝날 때마다 Swagger 5.11 예시로 onReaction을 호출한다(seq 1부터)", () => {
    const hook = renderMock();
    startListening(hook);
    advance(MOCK_WORD_INTERVAL_MS * FIRST_SENTENCE_WORDS);
    expect(hook.onReaction).toHaveBeenCalledTimes(1);
    expect(hook.onReaction.mock.calls[0][0]).toMatchObject({
      seq: 1,
      reaction: { type: "gesture", gesture: "nod" },
      interrupt: null,
    });

    advance(MOCK_WORD_INTERVAL_MS * (WORD_COUNT - FIRST_SENTENCE_WORDS));
    expect(hook.onReaction).toHaveBeenCalledTimes(2);
    expect(hook.onReaction.mock.calls[1][0].seq).toBe(2);
  });

  it("마지막 단어 뒤 자동 제출해 제출 중 → 접수됨이 되고 onSubmitted를 호출한다", () => {
    const hook = renderMock({ isLastQuestion: true });
    startListening(hook);
    advance(MOCK_WORD_INTERVAL_MS * WORD_COUNT);
    expect(hook.result.current.caption).toBe(
      "캐시 무효화 시점을 직접 설계했습니다. 그래서 조회 응답 시간을 40% 줄였습니다.",
    );

    advance(AUTO_SUBMIT_SILENCE_MS);
    expect(hook.result.current.phase).toBe("submitting");
    advance(MOCK_SUBMIT_DELAY_MS);
    expect(hook.result.current.phase).toBe("submitted");
    expect(hook.onSubmitted).toHaveBeenCalledWith({ kind: "accepted", isLastQuestion: true });
  });

  it("[답변 완료](submit)를 누르면 남은 자막 없이 바로 제출한다", () => {
    const hook = renderMock();
    startListening(hook);
    advance(MOCK_WORD_INTERVAL_MS);
    act(() => void hook.result.current.submit());
    expect(hook.result.current.phase).toBe("submitting");

    advance(MOCK_SUBMIT_DELAY_MS + MOCK_WORD_INTERVAL_MS * WORD_COUNT + AUTO_SUBMIT_SILENCE_MS);
    expect(hook.result.current.caption).toBe("캐시");
    expect(hook.onSubmitted).toHaveBeenCalledTimes(1);
  });

  it("듣는 중이 아니면 submit · retry · reconnect는 상태를 변경하지 않는다", () => {
    const hook = renderMock();
    act(() => {
      void hook.result.current.submit();
      void hook.result.current.retry();
      hook.result.current.reconnect();
    });
    expect(hook.result.current.phase).toBe("idle");
    expect(hook.result.current.sttStatus).toBe("idle");
  });
});

describe("useMockVideoAnswer 실패 시나리오", () => {
  it("sttError: 첫 문장 뒤 음성 인식 오류가 되고, [다시 연결]하면 연결 중을 거쳐 이어서 진행한다", () => {
    const hook = renderMock({ scenario: "sttError" });
    startListening(hook);
    advance(MOCK_WORD_INTERVAL_MS * FIRST_SENTENCE_WORDS);
    expect(hook.result.current.sttStatus).toBe("error");
    expect(hook.result.current.phase).toBe("listening");

    // 오류 동안에는 자막도 자동 제출도 진행하지 않는다.
    advance(MOCK_WORD_INTERVAL_MS * WORD_COUNT + AUTO_SUBMIT_SILENCE_MS);
    expect(hook.result.current.caption).toBe("캐시 무효화 시점을 직접 설계했습니다.");
    expect(hook.result.current.phase).toBe("listening");

    act(() => hook.result.current.reconnect());
    expect(hook.result.current.sttStatus).toBe("connecting");
    advance(MOCK_START_DELAY_MS);
    expect(hook.result.current.sttStatus).toBe("listening");
    advance(MOCK_WORD_INTERVAL_MS);
    expect(hook.result.current.caption).toBe("캐시 무효화 시점을 직접 설계했습니다. 그래서");
  });

  it("submitFailed: 첫 제출은 실패하고 [다시 시도](retry)하면 접수된다", () => {
    const hook = renderMock({ scenario: "submitFailed" });
    startListening(hook);
    act(() => void hook.result.current.submit());
    advance(MOCK_SUBMIT_DELAY_MS);
    expect(hook.result.current.phase).toBe("submitFailed");
    expect(hook.result.current.submitFailure).toEqual({
      ok: false,
      code: "INTERNAL_ERROR",
      status: 500,
    });
    expect(hook.onSubmitted).not.toHaveBeenCalled();

    act(() => void hook.result.current.retry());
    expect(hook.result.current.phase).toBe("submitting");
    advance(MOCK_SUBMIT_DELAY_MS);
    expect(hook.result.current.phase).toBe("submitted");
    expect(hook.result.current.submitFailure).toBeNull();
    expect(hook.onSubmitted).toHaveBeenCalledWith({ kind: "accepted", isLastQuestion: false });
  });

  it("timedOut: 말 없이 종료되고 [다시 시작](start)하면 처음부터 시작한다", () => {
    const hook = renderMock({ scenario: "timedOut" });
    startListening(hook);
    advance(NO_SPEECH_TIMEOUT_MS);
    expect(hook.result.current.phase).toBe("timedOut");
    expect(hook.result.current.sttStatus).toBe("idle");
    expect(hook.result.current.caption).toBe("");

    act(() => void hook.result.current.start());
    expect(hook.result.current.phase).toBe("starting");
  });

  it("startFailed: 마이크 권한 거부로 답변 전으로 돌아가고 startFailure를 기록한다", () => {
    const hook = renderMock({ scenario: "startFailed" });
    startListening(hook);
    expect(hook.result.current.phase).toBe("idle");
    expect(hook.result.current.startFailure).toEqual({ kind: "device", reason: "denied" });
  });
});

describe("useMockVideoAnswer 질문 전환 · 화면 이탈", () => {
  it("질문이 변경되면 답변 전으로 돌아가고 예약된 자막 · 제출을 해제한다", () => {
    const hook = renderMock();
    startListening(hook);
    advance(MOCK_WORD_INTERVAL_MS);
    hook.rerender({ ...hook.props, questionId: 11 });
    expect(hook.result.current.phase).toBe("idle");
    expect(hook.result.current.caption).toBe("");

    advance(MOCK_WORD_INTERVAL_MS * WORD_COUNT + AUTO_SUBMIT_SILENCE_MS + MOCK_SUBMIT_DELAY_MS);
    expect(hook.result.current.caption).toBe("");
    expect(hook.onSubmitted).not.toHaveBeenCalled();
  });

  it("화면을 떠나면 예약된 타이머를 모두 해제한다", () => {
    const hook = renderMock();
    startListening(hook);
    hook.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
