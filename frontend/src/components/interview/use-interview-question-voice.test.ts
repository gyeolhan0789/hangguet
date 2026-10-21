import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useInterviewQuestionVoice, type InterviewQuestion } from "./use-interview-question-voice";

// 기준: API 명세 5.12(질문을 수신하면 질문 음성 재생) · 질문 전환 때 앞 재생을 중지한다

const play = vi.fn();
const stop = vi.fn();
vi.mock("./use-question-tts", () => ({
  // 렌더마다 새 함수를 반환해도 같은 질문을 다시 재생하지 않는지 확인하기 위해 매번 새 함수로 감싼다.
  useQuestionTts: () => ({
    status: "idle",
    play: (...args: unknown[]) => play(...args),
    stop: () => stop(),
  }),
}));

const first: InterviewQuestion = {
  id: 303,
  content: "조회 응답 시간을 40% 줄인 과정을 설명해 주세요.",
};
const second: InterviewQuestion = { id: 304, content: "Redis 캐시를 도입한 이유는요?" };

function render(question: InterviewQuestion | null) {
  return renderHook(({ q }) => useInterviewQuestionVoice(55, q), {
    initialProps: { q: question },
  });
}

beforeEach(() => {
  play.mockReset();
  stop.mockReset();
});

afterEach(cleanup);

describe("useInterviewQuestionVoice", () => {
  it("질문을 수신하면 그 질문 음성을 재생한다", () => {
    render(first);

    expect(play).toHaveBeenCalledExactlyOnceWith({
      sessionId: 55,
      questionId: 303,
      content: first.content,
    });
  });

  it("같은 질문으로 다시 렌더링해도 다시 재생하지 않는다(재생 함수가 새로 생성돼도)", () => {
    const hook = render(first);

    hook.rerender({ q: { ...first } });
    hook.rerender({ q: first });

    expect(play).toHaveBeenCalledTimes(1);
  });

  it("다음 질문으로 변경되면 새 질문을 재생한다", () => {
    const hook = render(first);

    hook.rerender({ q: second });

    expect(play).toHaveBeenLastCalledWith({
      sessionId: 55,
      questionId: 304,
      content: second.content,
    });
    expect(play).toHaveBeenCalledTimes(2);
  });

  it("질문이 없으면(다음 질문 대기) 재생을 중지한다", () => {
    const hook = render(first);

    hook.rerender({ q: null });

    expect(stop).toHaveBeenCalledTimes(1);
    expect(play).toHaveBeenCalledTimes(1);
  });
});
