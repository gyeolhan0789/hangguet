import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { motionValue } from "motion/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useInterviewStore } from "@/stores/interview-store";
import type { AnswerStateMessage } from "@/lib/interview/room-messages";
import type { CurrentQuestion, SessionResponse } from "@/types/api";

import {
  CHAT_ROOM_RETRIES,
  CHAT_ROOM_RETRY_MS,
  InterviewRoom,
  SESSION_POLL_MS,
} from "./interview-room";

vi.mock("motion/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("motion/react")>()),
  useReducedMotion: () => true,
  // jsdom에는 애니메이션 프레임이 없어 사라지는 말풍선이 남는다. 바뀐 화면만 보도록 바로 뺀다.
  AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
}));

// 경계만 바꾼다: 다시 그리기(router.refresh) · 서버 액션 · 3D 장면 · 카메라 · 마이크. 실제 흐름은 E2E(interview.spec.ts)가 본다.
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
const startSession = vi.fn();
const retryPlan = vi.fn();
const submitTextAnswer = vi.fn();
const endSession = vi.fn();
vi.mock("@/lib/interview/actions", () => ({
  startSession: (...args: unknown[]) => startSession(...args),
  retryPlan: (...args: unknown[]) => retryPlan(...args),
  submitTextAnswer: (...args: unknown[]) => submitTextAnswer(...args),
  endSession: (...args: unknown[]) => endSession(...args),
}));
vi.mock("@/components/interview/interviewer-stage", () => ({
  InterviewerStage: () => <div data-testid="interviewer-stage" />,
}));
vi.mock("./use-interview-media", () => ({
  useInterviewMedia: () => ({ stream: null, level: motionValue(0.5) }),
}));
// 면접방(LiveKit) 입장도 경계다. 어떤 인자로 들어가는지, 테스트가 바꾸는 연결 상태 · 내 답변 자막에 따라 화면이 무엇을 하는지만 본다
// (입장 · RPC 동작은 use-interview-room.test.ts).
const joinRoom = vi.fn();
// mounts: 훅을 쓰는 컴포넌트가 붙은 횟수(다시 붙으면 실제 훅은 새로 입장한다)
const room = vi.hoisted(() => ({
  status: "idle",
  streamId: null as string | null,
  confirmedText: "",
  interimText: "",
  retry: () => {},
  submitAnswer: (async () => "accepted") as (seq: number) => Promise<string>,
  mounts: 0,
}));
vi.mock("@/components/interview/use-interview-room", async () => {
  const { useEffect } = await import("react");
  return {
    useInterviewRoom: (...args: unknown[]) => {
      joinRoom(...args);
      useEffect(() => {
        room.mounts += 1;
      }, []);
      return {
        status: room.status,
        streamId: room.streamId,
        confirmedText: room.confirmedText,
        interimText: room.interimText,
        retry: room.retry,
        submitAnswer: room.submitAnswer,
      };
    },
  };
});

// 기준: 웹 Swagger 5.2(status · planStatus · mode, planStatus FAILED는 5.3으로 재시도) · 5.5 지금 질문 · 5.4 면접 시작
// · 5.3 면접 플랜 재생성 · Idempotency-Key(같은 키면 처음 결과를 그대로 반환)
// · 사용자 결정(2026-10-22: 준비 실패 문구는 '면접 준비에 실패했어요' + [다시 시도])
// · 웹 Swagger 5.2 · 5.5(2초마다(임시 값) 다시 불러 확인) · 채팅은 질문 준비가 끝나면 화면이 5.4를 자동으로 부른다
// · 기획 메모 S06-1(18:3531: 마지막 답변 · 끝내기 직후 결과 분석 중)
// · 웹 Swagger 5.4(채팅도 면접방에 들어간다(송출 없이 수신·메시지만))
// · API 명세 면접방 메시지(answer.submit · answer.state) · 5.7(202 · 409 ANSWER_ALREADY_SUBMITTED면 answer.submit)
// · 사용자 결정(2026-10-26: 다음 질문은 5.5로 받는다, [답변 완료]는 내 답변 자막이 있을 때만, 화상 마지막 답변 뒤 자동 끝내기)
// · 사용자 결정(2026-10-26: 채팅 면접방 연결 실패는 표시 없이 2초 뒤 다시 들어가고, 연달아 3번까지만)

// Swagger 5.2 200 예시 'S06·S06-B 면접 중'
const SESSION: SessionResponse = {
  id: 55,
  applicationId: 10,
  companyName: "○○전자",
  jobTitle: "백엔드 개발자",
  persona: "DEVIL",
  mode: "VIDEO",
  status: "IN_PROGRESS",
  planStatus: "READY",
  planProgress: null,
  analysisStep: null,
  currentQuestion: { id: 303, seq: 3, content: "가장 큰 기술적 문제는 무엇이었나요?" },
  answeredCount: 2,
  elapsedSeconds: 522,
  startedAt: "2026-10-15T12:00:00+09:00",
  endedAt: null,
  createdAt: "2026-10-15T11:58:30+09:00",
  leveledUp: null,
};
// Swagger 5.5 200 예시
const QUESTION: CurrentQuestion = {
  id: 303,
  seq: 3,
  content: "흐음~ ○○ 프로젝트라. 거기서 '직접' 한 부분만 쏙 골라서 말해볼래요?",
};

let online = true;
beforeEach(() => {
  vi.useFakeTimers();
  useInterviewStore.getState().reset();
  startSession.mockReset().mockResolvedValue({});
  retryPlan.mockReset().mockResolvedValue({});
  room.status = "idle";
  room.streamId = null;
  room.confirmedText = "";
  room.interimText = "";
  room.retry = vi.fn();
  room.submitAnswer = vi.fn(async () => "accepted");
  room.mounts = 0;
  submitTextAnswer.mockReset();
  endSession.mockReset().mockResolvedValue({});
  online = true;
  vi.spyOn(navigator, "onLine", "get").mockImplementation(() => online);
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

/** 면접 중인 화상 화면. rerender에 같은 요소를 다시 넘기면 React가 다시 그리지 않으므로 매번 새로 만든다 */
const videoRoom = (question: CurrentQuestion | null = QUESTION, answeredCount = 2) => (
  <InterviewRoom session={{ ...SESSION, answeredCount }} currentQuestion={question} />
);
const submitButton = () => screen.getByRole("button", { name: "답변 완료" }) as HTMLButtonElement;
const caption = () => screen.getByRole("region", { name: "내 답변 음성 인식" }).textContent;
/** 에이전트가 보낸 답변 상태(answer.state)를 화면에 넘긴다 */
function answerState(fields: { seq: number; state: AnswerStateMessage["state"] }) {
  const options = joinRoom.mock.lastCall?.[2] as {
    onAnswerState: (message: AnswerStateMessage) => void;
  };
  act(() => options.onAnswerState({ type: "answer.state", sessionId: 55, ...fields }));
}
/** 면접 중인 채팅 화면. rerender에 같은 요소를 다시 넘기면 React가 다시 그리지 않으므로 매번 새로 만든다 */
const chatRoom = () => (
  <InterviewRoom session={{ ...SESSION, mode: "CHAT" }} currentQuestion={QUESTION} />
);
const thinking = () => screen.queryByRole("status", { name: "면접관이 생각하는 중" });
const analyzing = () => screen.queryByRole("heading", { name: "면접관이 답변을 검토하고 있어요" });
const waitPoll = () => act(() => vi.advanceTimersByTime(SESSION_POLL_MS));

describe("InterviewRoom (면접 화면 고르기 · 다시 조회)", () => {
  it("면접 중이고 질문이 있으면 질문을 보여 주고 다시 조회하지 않는다", () => {
    render(<InterviewRoom session={SESSION} currentQuestion={QUESTION} />);

    expect(screen.getByText(QUESTION.content, { selector: ".sr-only" })).toBeTruthy();
    waitPoll();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("다음 질문을 만드는 중이면(5.5 202) 면접관이 생각하는 중이고, 2초 뒤 다시 조회한다", () => {
    render(<InterviewRoom session={SESSION} currentQuestion={null} />);

    expect(thinking()).toBeTruthy();
    act(() => vi.advanceTimersByTime(SESSION_POLL_MS - 1));
    expect(refresh).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("인터넷이 끊기면 다시 조회하지 않고, 다시 연결되면 2초 뒤 이어서 조회한다", () => {
    online = false;
    render(<InterviewRoom session={SESSION} currentQuestion={null} />);

    act(() => vi.advanceTimersByTime(SESSION_POLL_MS * 5));
    expect(refresh).not.toHaveBeenCalled();

    online = true;
    act(() => window.dispatchEvent(new Event("online")));
    waitPoll();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("방금 답한 질문이 그대로 오면 아직 다음 질문이 없는 것으로 보고, 새 질문이 오면 보여 준다", () => {
    useInterviewStore.getState().setAnsweredQuestion(303);
    const { rerender } = render(<InterviewRoom session={SESSION} currentQuestion={QUESTION} />);
    // 화면에 들어올 때 지난 면접 상태를 지우므로, 답한 질문을 다시 넣는다.
    act(() => useInterviewStore.getState().setAnsweredQuestion(303));
    expect(thinking()).toBeTruthy();
    waitPoll();
    expect(refresh).toHaveBeenCalledTimes(1);

    const next = { id: 304, seq: 4, content: "다음 질문" };
    rerender(<InterviewRoom session={SESSION} currentQuestion={next} />);
    expect(thinking()).toBeNull();
    expect(screen.getByText("다음 질문", { selector: ".sr-only" })).toBeTruthy();
  });

  it("결과 분석 중(ANALYZING)이면 S06-1을 그리고 2초마다 다시 조회한다", () => {
    render(
      <InterviewRoom
        session={{ ...SESSION, status: "ANALYZING", analysisStep: "SCORING" }}
        currentQuestion={null}
      />,
    );

    expect(analyzing()).toBeTruthy();
    expect(screen.queryByRole("button", { name: "면접 종료" })).toBeNull();
    waitPoll();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("결과가 나왔으면(COMPLETED) 다시 조회하지 않는다", () => {
    render(<InterviewRoom session={{ ...SESSION, status: "COMPLETED" }} currentQuestion={null} />);

    expect(analyzing()).toBeTruthy();
    waitPoll();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("채팅: 질문을 준비하는 동안(5.2 READY · GENERATING) 다시 조회하고, 준비가 끝나면 5.4를 한 번만 부른다", () => {
    const chat = { ...SESSION, mode: "CHAT", status: "READY", currentQuestion: null } as const;
    const { rerender } = render(
      <InterviewRoom
        session={{ ...chat, planStatus: "GENERATING", planProgress: 78 }}
        currentQuestion={null}
      />,
    );
    expect(thinking()).toBeTruthy();
    waitPoll();
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(startSession).not.toHaveBeenCalled();

    rerender(<InterviewRoom session={{ ...chat, planStatus: "READY" }} currentQuestion={null} />);
    rerender(<InterviewRoom session={{ ...chat, planStatus: "READY" }} currentQuestion={null} />);

    expect(startSession).toHaveBeenCalledTimes(1);
    expect(startSession).toHaveBeenCalledWith(55, expect.stringMatching(/^[0-9a-f-]{36}$/));
  });

  it("채팅: 5.4 자동 시작이 서버 실패면 2초 뒤 다시 조회하고 새 키로, 연결 오류면 같은 키로 다시 보낸다", async () => {
    const chat = { ...SESSION, mode: "CHAT", status: "READY", currentQuestion: null } as const;
    // 5.4가 돌려줄 결과는 테스트가 단계마다 바꾼다.
    let result: object = { formError: "지금은 할 수 없는 요청이에요.", keySpent: true };
    startSession.mockImplementation(async () => result);
    render(<InterviewRoom session={chat} currentQuestion={null} />);
    await act(async () => {});
    const firstKey = startSession.mock.calls[0][1];
    expect(screen.getByRole("alert").textContent).toBe("지금은 할 수 없는 요청이에요.");

    result = { formError: "잠시 후 다시 시도해 주세요." };
    await act(async () => vi.advanceTimersByTime(SESSION_POLL_MS));
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(startSession).toHaveBeenCalledTimes(2);
    const secondKey = startSession.mock.calls[1][1];
    expect(secondKey).not.toBe(firstKey);

    result = {};
    await act(async () => vi.advanceTimersByTime(SESSION_POLL_MS));
    expect(startSession).toHaveBeenCalledTimes(3);
    expect(startSession.mock.calls[2][1]).toBe(secondKey);

    await act(async () => vi.advanceTimersByTime(SESSION_POLL_MS * 3));
    expect(startSession).toHaveBeenCalledTimes(3);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("채팅: 질문 준비가 실패했으면(5.2 planStatus FAILED) 말풍선 자리에 '면접 준비에 실패했어요'와 [다시 시도](5.3)를 보여 준다", async () => {
    const failed = {
      ...SESSION,
      mode: "CHAT",
      status: "READY",
      planStatus: "FAILED",
      currentQuestion: null,
    } as const;
    retryPlan.mockResolvedValue({ formError: "면접 준비가 실패한 상태가 아니에요." });
    render(<InterviewRoom session={failed} currentQuestion={null} />);

    const prepare = screen.getByRole("region", { name: "면접 준비" });
    expect(prepare.textContent).toContain("면접 준비에 실패했어요");
    expect(thinking()).toBeNull();
    expect(startSession).not.toHaveBeenCalled();

    await act(async () => fireEvent.click(screen.getByRole("button", { name: "다시 시도" })));

    expect(retryPlan).toHaveBeenCalledWith(55);
    expect(screen.getByRole("alert").textContent).toBe("면접 준비가 실패한 상태가 아니에요.");
  });

  it("화상 면접은 이 화면에서 시작하지 않는다(S05 [면접 시작])", () => {
    render(
      <InterviewRoom
        session={{ ...SESSION, status: "READY", currentQuestion: null }}
        currentQuestion={null}
      />,
    );
    expect(startSession).not.toHaveBeenCalled();
  });

  it("채팅: 면접이 시작되면(IN_PROGRESS) 송출 없이 면접방에 들어간다", () => {
    render(<InterviewRoom session={{ ...SESSION, mode: "CHAT" }} currentQuestion={QUESTION} />);
    expect(joinRoom).toHaveBeenCalledWith(55, null, { listenOnly: true });
    expect(joinRoom).not.toHaveBeenCalledWith(55, null);
  });

  it("채팅: 다음 질문을 기다리는 동안에도 방에 남고, 질문이 바뀌어도 다시 들어가지 않는다", () => {
    const { rerender } = render(
      <InterviewRoom session={{ ...SESSION, mode: "CHAT" }} currentQuestion={null} />,
    );
    expect(joinRoom).toHaveBeenCalledWith(55, null, { listenOnly: true });
    rerender(<InterviewRoom session={{ ...SESSION, mode: "CHAT" }} currentQuestion={QUESTION} />);
    expect(room.mounts).toBe(1);
  });

  it("채팅: 면접 시작 전(READY)에는 면접방에 들어가지 않는다", () => {
    // 질문 준비 중(GENERATING)이라 자동 시작(5.4)도 하지 않는 상태
    render(
      <InterviewRoom
        session={{
          ...SESSION,
          mode: "CHAT",
          status: "READY",
          planStatus: "GENERATING",
          currentQuestion: null,
        }}
        currentQuestion={null}
      />,
    );
    expect(joinRoom).not.toHaveBeenCalled();
  });

  it("채팅: 면접방 연결이 실패하면 2초 뒤 다시 들어가고, 연달아 3번까지만 한다", () => {
    room.status = "failed";
    render(<InterviewRoom session={{ ...SESSION, mode: "CHAT" }} currentQuestion={QUESTION} />);

    act(() => vi.advanceTimersByTime(CHAT_ROOM_RETRY_MS - 1));
    expect(room.retry).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(room.retry).toHaveBeenCalledTimes(1);

    act(() => vi.advanceTimersByTime(CHAT_ROOM_RETRY_MS));
    act(() => vi.advanceTimersByTime(CHAT_ROOM_RETRY_MS));
    expect(room.retry).toHaveBeenCalledTimes(CHAT_ROOM_RETRIES);
    act(() => vi.advanceTimersByTime(CHAT_ROOM_RETRY_MS * 10));
    expect(room.retry).toHaveBeenCalledTimes(CHAT_ROOM_RETRIES);
    // 연결 실패는 화면에 그리지 않는다.
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("채팅: 다시 들어가는 데 성공하면 횟수를 처음부터 다시 센다", () => {
    room.status = "failed";
    const { rerender } = render(chatRoom());
    // 다음 시도는 앞 시도로 다시 그린 뒤에 걸리므로 2초씩 나눠 진행한다.
    for (let i = 0; i < CHAT_ROOM_RETRIES; i++)
      act(() => vi.advanceTimersByTime(CHAT_ROOM_RETRY_MS));
    expect(room.retry).toHaveBeenCalledTimes(CHAT_ROOM_RETRIES);

    room.status = "listening";
    rerender(chatRoom());
    room.status = "failed";
    rerender(chatRoom());
    act(() => vi.advanceTimersByTime(CHAT_ROOM_RETRY_MS));
    expect(room.retry).toHaveBeenCalledTimes(CHAT_ROOM_RETRIES + 1);
  });

  it("채팅: 연결 중이거나 듣는 중이면 다시 들어가지 않는다", () => {
    room.status = "connecting";
    const { rerender } = render(chatRoom());
    act(() => vi.advanceTimersByTime(CHAT_ROOM_RETRY_MS * 5));
    room.status = "listening";
    rerender(chatRoom());
    act(() => vi.advanceTimersByTime(CHAT_ROOM_RETRY_MS * 5));
    expect(room.retry).not.toHaveBeenCalled();
  });

  it("화상은 listenOnly 없이 장치 스트림으로 면접방에 들어간다", () => {
    render(<InterviewRoom session={SESSION} currentQuestion={QUESTION} />);
    // useInterviewMedia 대역의 스트림은 null이다. 송출 방식(listenOnly 없음)만 본다.
    expect(joinRoom).toHaveBeenCalledWith(55, null, { onAnswerState: expect.any(Function) });
    expect(joinRoom).not.toHaveBeenCalledWith(55, null, { listenOnly: true });
  });

  it("화상: 질문이 있고 내 답변 자막이 있을 때만 [답변 완료]를 누를 수 있고, 누르면 그 질문 순서로 보낸다", async () => {
    const { rerender } = render(videoRoom());
    expect(submitButton()).toHaveProperty("disabled", true);

    room.streamId = "capture-1";
    room.interimText = "저는";
    rerender(videoRoom());
    expect(submitButton()).toHaveProperty("disabled", false);

    // 다음 질문을 기다리는 중(질문 없음)이면 누를 수 없다
    rerender(videoRoom(null));
    expect(submitButton()).toHaveProperty("disabled", true);

    rerender(videoRoom());
    await act(async () => fireEvent.click(submitButton()));
    expect(room.submitAnswer).toHaveBeenCalledExactlyOnceWith(3);
    // 받아들여지면 내는 중이라 다시 누를 수 없고, 낸 답변 글은 감춘다
    expect(submitButton()).toHaveProperty("disabled", true);
    expect(caption()).not.toContain("저는");
  });

  it.each(["rejected", "failed"])(
    "화상: 에이전트가 받지 않으면(%s) 다시 누를 수 있고 답변 글도 그대로다",
    async (result) => {
      room.streamId = "capture-1";
      room.confirmedText = "답";
      room.submitAnswer = vi.fn(async () => result);
      render(videoRoom());

      await act(async () => fireEvent.click(submitButton()));
      expect(submitButton()).toHaveProperty("disabled", false);
      expect(caption()).toContain("답");
    },
  );

  it("화상: 제출됨(submitted)이면 면접관이 생각 중이 되고 지난 답변 자막을 감추며, 다음 답변 캡처가 오면 다시 보여 준다", () => {
    room.streamId = "capture-1";
    room.confirmedText = "캐시를 바꿨어요";
    const { rerender } = render(videoRoom());
    expect(caption()).toContain("캐시를 바꿨어요");

    answerState({ seq: 3, state: "submitted" });
    expect(useInterviewStore.getState().answeredQuestionId).toBe(303);
    expect(thinking()).toBeTruthy();
    expect(caption()).not.toContain("캐시를 바꿨어요");

    // 다음 질문이 와도 에이전트가 새 캡처를 열기 전에는 지난 답변 글로 [답변 완료]를 누를 수 없다
    const next = { id: 304, seq: 4, content: "다음 질문" };
    rerender(videoRoom(next));
    expect(submitButton()).toHaveProperty("disabled", true);

    room.streamId = "capture-2";
    room.confirmedText = "새 답변";
    rerender(videoRoom(next));
    expect(caption()).toContain("새 답변");
    expect(submitButton()).toHaveProperty("disabled", false);
  });

  it("화상: 지금 질문이 아닌 답변 상태는 무시한다", () => {
    room.streamId = "capture-1";
    room.confirmedText = "지금 답변";
    render(videoRoom());

    answerState({ seq: 2, state: "submitted" });
    answerState({ seq: 2, state: "autoSubmitted" });
    expect(useInterviewStore.getState().answeredQuestionId).toBeNull();
    expect(caption()).toContain("지금 답변");
    expect(submitButton()).toHaveProperty("disabled", false);
  });

  it("화상: 60초 무응답(timedOut)은 화면을 바꾸지 않는다", () => {
    room.streamId = "capture-1";
    room.confirmedText = "답";
    render(videoRoom());
    answerState({ seq: 3, state: "timedOut" });
    expect(thinking()).toBeNull();
    expect(submitButton()).toHaveProperty("disabled", false);
  });

  it("화상: 자동 제출(autoSubmitted)이면 내는 중이 되어 2초마다 5.5로 다음 질문을 확인하고, 다음 질문이 오면 멈춘다", () => {
    room.streamId = "capture-1";
    room.confirmedText = "캐시를 바꿨어요";
    const { rerender } = render(videoRoom());
    answerState({ seq: 3, state: "autoSubmitted" });
    expect(submitButton()).toHaveProperty("disabled", true);
    expect(caption()).not.toContain("캐시를 바꿨어요");

    act(() => vi.advanceTimersByTime(SESSION_POLL_MS - 1));
    expect(refresh).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(refresh).toHaveBeenCalledTimes(1);

    // 제출됨 알림을 놓쳐도 다음 질문이 오면 넘어가고 더 조회하지 않는다
    rerender(videoRoom({ id: 304, seq: 4, content: "다음 질문" }));
    refresh.mockClear();
    act(() => vi.advanceTimersByTime(SESSION_POLL_MS * 3));
    expect(refresh).not.toHaveBeenCalled();
  });

  it("화상: 내는 중이어도 인터넷이 끊기면 다시 조회하지 않는다", async () => {
    online = false;
    room.streamId = "capture-1";
    room.confirmedText = "답";
    render(videoRoom());
    await act(async () => fireEvent.click(submitButton()));
    act(() => vi.advanceTimersByTime(SESSION_POLL_MS * 3));
    expect(refresh).not.toHaveBeenCalled();
  });

  it("화상: 제출 실패(submitFailed)면 답변 글을 다시 보여 주고 [답변 완료]로 같은 답변을 다시 낼 수 있다", async () => {
    room.streamId = "capture-1";
    room.confirmedText = "답";
    render(videoRoom());
    await act(async () => fireEvent.click(submitButton()));
    expect(submitButton()).toHaveProperty("disabled", true);

    answerState({ seq: 3, state: "submitFailed" });
    expect(caption()).toContain("답");
    expect(submitButton()).toHaveProperty("disabled", false);
    await act(async () => fireEvent.click(submitButton()));
    expect(room.submitAnswer).toHaveBeenCalledTimes(2);
  });

  it("화상: 낸 뒤 같은 질문에 새 자막 캡처가 열리면(에이전트가 다시 듣는다) 다시 답할 수 있다", async () => {
    room.streamId = "capture-1";
    room.confirmedText = "음";
    const { rerender } = render(videoRoom());
    await act(async () => fireEvent.click(submitButton()));
    expect(submitButton()).toHaveProperty("disabled", true);

    room.streamId = "capture-2";
    room.confirmedText = "다시 말한 답";
    rerender(videoRoom());
    expect(caption()).toContain("다시 말한 답");
    expect(submitButton()).toHaveProperty("disabled", false);
  });

  it("화상: 새로고침 뒤 자막이 없어도 제출 실패를 알리면 [답변 완료]로 다시 낼 수 있다", () => {
    render(videoRoom());
    expect(submitButton()).toHaveProperty("disabled", true);
    answerState({ seq: 3, state: "submitFailed" });
    expect(submitButton()).toHaveProperty("disabled", false);
  });

  it("화상: 5.2로 답변 5개가 저장된 것이 보이면 면접을 끝내고(5.8), 다시 그려져도 한 번만 보낸다", async () => {
    endSession.mockResolvedValue({ leveledUp: true });
    const last = { id: 305, seq: 5, content: "마지막 질문" };
    const { rerender } = render(videoRoom(last, 4));
    await act(async () => {});
    expect(endSession).not.toHaveBeenCalled();

    // 제출됨 알림 없이도(놓쳤어도) 저장된 답변 수로 끝낸다
    rerender(videoRoom(null, 5));
    await act(async () => {});
    expect(endSession).toHaveBeenCalledExactlyOnceWith(
      55,
      expect.stringMatching(/^[0-9a-f-]{36}$/),
    );
    expect(useInterviewStore.getState().leveledUp).toBe(true);

    rerender(videoRoom(null, 4));
    rerender(videoRoom(null, 5));
    await act(async () => {});
    expect(endSession).toHaveBeenCalledTimes(1);
  });

  it("화상: 끝내기(5.8)가 실패하면 2초 뒤 다시 보내고(서버가 실패로 답했으면 새 키), 성공하면 멈춘다", async () => {
    endSession
      .mockResolvedValueOnce({ formError: "잠시 후 다시 시도해 주세요." })
      .mockResolvedValueOnce({ formError: "지금은 할 수 없는 요청이에요.", keySpent: true })
      .mockResolvedValueOnce({});
    render(videoRoom(null, 5));
    await act(async () => {});
    expect(endSession).toHaveBeenCalledTimes(1);

    await act(async () => vi.advanceTimersByTime(SESSION_POLL_MS));
    expect(endSession).toHaveBeenCalledTimes(2);
    await act(async () => vi.advanceTimersByTime(SESSION_POLL_MS));
    expect(endSession).toHaveBeenCalledTimes(3);
    await act(async () => vi.advanceTimersByTime(SESSION_POLL_MS * 5));
    expect(endSession).toHaveBeenCalledTimes(3);
    const keys = endSession.mock.calls.map((call) => call[1]);
    // 응답을 못 받은 끝내기는 같은 키로, 서버가 실패로 답한 뒤에는 새 키로 보낸다
    expect(keys[1]).toBe(keys[0]);
    expect(keys[2]).not.toBe(keys[1]);
  });

  it("화상: 끝내기에 실패한 뒤 화면을 떠나면 다시 보내지 않는다", async () => {
    endSession.mockResolvedValue({ formError: "잠시 후 다시 시도해 주세요." });
    const { unmount } = render(videoRoom(null, 5));
    await act(async () => {});
    unmount();
    await act(async () => vi.advanceTimersByTime(SESSION_POLL_MS * 3));
    expect(endSession).toHaveBeenCalledTimes(1);
  });

  it("채팅: 답변이 저장되면 에이전트에 [답변 완료]를 보내고, 보내지 못하면 2초마다 다시 보내다가 받거나 거절하면 멈춘다", async () => {
    submitTextAnswer.mockResolvedValue({ isLastQuestion: false });
    room.submitAnswer = vi
      .fn()
      .mockResolvedValueOnce("failed")
      .mockResolvedValueOnce("failed")
      .mockResolvedValueOnce("rejected");
    render(chatRoom());
    fireEvent.input(screen.getByRole("textbox", { name: "답변" }), {
      target: { value: "캐시를 바꿨어요" },
    });

    await act(async () => {
      fireEvent.keyDown(screen.getByRole("textbox", { name: "답변" }), { key: "Enter" });
    });
    expect(room.submitAnswer).toHaveBeenCalledExactlyOnceWith(3);

    await act(async () => vi.advanceTimersByTime(CHAT_ROOM_RETRY_MS - 1));
    expect(room.submitAnswer).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTime(1));
    expect(room.submitAnswer).toHaveBeenCalledTimes(2);
    await act(async () => vi.advanceTimersByTime(CHAT_ROOM_RETRY_MS));
    expect(room.submitAnswer).toHaveBeenCalledTimes(3);
    await act(async () => vi.advanceTimersByTime(CHAT_ROOM_RETRY_MS * 5));
    expect(room.submitAnswer).toHaveBeenCalledTimes(3);
    expect(room.submitAnswer).toHaveBeenLastCalledWith(3);
  });

  it("채팅: 지난 질문의 늦은 결과가 다음 질문의 재전송을 지우지 않는다", async () => {
    submitTextAnswer.mockResolvedValue({ isLastQuestion: false });
    let settleOld!: (result: string) => void;
    room.submitAnswer = vi
      .fn()
      // 3번: 응답이 늦게 온다
      .mockImplementationOnce(() => new Promise((done) => (settleOld = done)))
      // 4번: 보내지 못한다 → 2초 뒤 다시
      .mockResolvedValueOnce("failed")
      .mockResolvedValue("accepted");
    const { rerender } = render(chatRoom());
    const answer = async (text: string) => {
      fireEvent.input(screen.getByRole("textbox", { name: "답변" }), { target: { value: text } });
      await act(async () => {
        fireEvent.keyDown(screen.getByRole("textbox", { name: "답변" }), { key: "Enter" });
      });
    };
    await answer("3번 답");
    rerender(
      <InterviewRoom
        session={{ ...SESSION, mode: "CHAT" }}
        currentQuestion={{ id: 304, seq: 4, content: "4번 질문" }}
      />,
    );
    await answer("4번 답");
    expect(room.submitAnswer).toHaveBeenLastCalledWith(4);

    await act(async () => settleOld("rejected"));
    await act(async () => vi.advanceTimersByTime(CHAT_ROOM_RETRY_MS));
    expect(room.submitAnswer).toHaveBeenCalledTimes(3);
    expect(room.submitAnswer).toHaveBeenLastCalledWith(4);
  });

  it("악마 면접관은 번개 빛을 깔고, 커피챗은 깔지 않는다", () => {
    const { rerender } = render(<InterviewRoom session={SESSION} currentQuestion={QUESTION} />);
    expect(screen.getByTestId("lightning-flash")).toBeTruthy();

    rerender(
      <InterviewRoom session={{ ...SESSION, persona: "COFFEE_CHAT" }} currentQuestion={QUESTION} />,
    );
    expect(screen.queryByTestId("lightning-flash")).toBeNull();
  });

  it("화면에 들어오면 지난 면접의 종료 모달 · 답한 질문 · 레벨업을 지운다", () => {
    useInterviewStore.setState({ endOpen: true, answeredQuestionId: 1, leveledUp: true });
    render(<InterviewRoom session={SESSION} currentQuestion={QUESTION} />);

    expect(useInterviewStore.getState()).toMatchObject({
      endOpen: false,
      answeredQuestionId: null,
      leveledUp: null,
    });
  });

  it("이미 끝낸 면접(S06-1 결과 분석 중)에 새로고침해 들어오면 그 면접의 레벨업은 남긴다", () => {
    useInterviewStore.setState({ endOpen: true, answeredQuestionId: 1, leveledUp: true });
    render(
      <InterviewRoom
        session={{ ...SESSION, status: "ANALYZING", analysisStep: "SCORING" }}
        currentQuestion={null}
      />,
    );

    expect(useInterviewStore.getState()).toMatchObject({
      endOpen: false,
      answeredQuestionId: null,
      leveledUp: true,
    });
  });
});
