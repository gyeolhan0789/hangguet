import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { motionValue } from "motion/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useInterviewStore } from "@/stores/interview-store";
import { useInterviewerPreloadStore } from "@/stores/interviewer-preload-store";
import type {
  AnswerStateMessage,
  QuestionMessage,
  ReactionSnapshot,
} from "@/lib/interview/room-messages";
import type { CurrentQuestion, SessionResponse } from "@/types/api";

import {
  CHAT_ROOM_RETRIES,
  CHAT_ROOM_RETRY_MS,
  InterviewRoom,
  QUESTION_RECHECK_MS,
  SESSION_POLL_MS,
} from "./interview-room";
import { PAUSE_AFTER_MS } from "./room-alerts";

vi.mock("motion/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("motion/react")>()),
  useReducedMotion: () => true,
  // jsdom에는 애니메이션 프레임이 없어 사라지는 말풍선이 남는다. 바뀐 화면만 보도록 바로 뺀다.
  AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
}));

// 경계만 바꾼다: 다시 그리기(router.refresh) · 서버 액션 · 3D 장면 · 카메라 · 마이크. 실제 흐름은 E2E(interview.spec.ts)가 본다.
const refresh = vi.fn();
const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push }) }));
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
const stageRender = vi.fn();
vi.mock("@/components/interview/interviewer-stage", () => ({
  InterviewerStage: (props: unknown) => {
    stageRender(props);
    return <div data-testid="interviewer-stage" />;
  },
}));
// 면접관 3D 모델 받기도 경계다. 채팅 대기 화면이 보는 받기 상태는 테스트가 store에 둔다.
vi.mock("@/lib/interviewer/preload", () => ({ preloadInterviewer: () => {} }));
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
  question: null as QuestionMessage | null,
  reaction: null as ReactionSnapshot | null,
  retry: () => {},
  submitAnswer: (async () => "accepted") as (seq: number) => Promise<string>,
  sendChatInput: vi.fn(),
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
        question: room.question,
        reaction: room.reaction,
        retry: room.retry,
        submitAnswer: room.submitAnswer,
        sendChatInput: room.sendChatInput,
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
// · 사용자 결정(2026-10-26: 다음 질문은 5.5로 받는다, 화상 마지막 답변 뒤 자동 끝내기)
// · 사용자 요청(2026-10-27: 화상 [답변 완료]는 파형 오른쪽, 마이크 없음 · 말을 멈추면 에이전트가 스스로 내기도 함)
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
  room: null,
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
  sessionStorage.clear();
  useInterviewerPreloadStore.setState({ persona: "DEVIL", status: "ready", progress: 1 });
  startSession.mockReset().mockResolvedValue({});
  retryPlan.mockReset().mockResolvedValue({});
  room.status = "idle";
  room.streamId = null;
  room.confirmedText = "";
  room.interimText = "";
  room.question = null;
  room.reaction = null;
  stageRender.mockClear();
  room.retry = vi.fn();
  room.submitAnswer = vi.fn(async () => "accepted");
  room.sendChatInput.mockReset();
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
/** S06-A 제출 실패 토스트의 [다시 시도] */
const retryButton = () => screen.getByRole("button", { name: "다시 시도" }) as HTMLButtonElement;
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
  it("같은 연결의 리액션을 아바타에 전달하고 중단 문구는 현재 질문에서만 표시한다", () => {
    room.reaction = {
      receivedAt: performance.now(),
      message: {
        type: "reaction",
        sessionId: 55,
        questionSeq: 3,
        seq: 1,
        reaction: {
          type: "gesture",
          expression: null,
          gesture: "nod",
          intensity: null,
          durationMs: 1200,
        },
        attitude: { interest: 0.7, trust: 0.3 },
        interrupt: { reason: "OFF_TOPIC", text: "질문의 핵심에 맞게 답변해 주세요." },
      },
    };
    const { rerender } = render(videoRoom());
    const options = joinRoom.mock.lastCall?.[2] as { onPresentation: (value: unknown) => void };
    const listening = { questionSeq: 3, streamId: "capture-1", speechAt: performance.now() };
    act(() => options.onPresentation({ question: null, reaction: room.reaction, listening }));
    expect(stageRender).toHaveBeenLastCalledWith(
      expect.objectContaining({ feedback: room.reaction, listening }),
    );
    expect(screen.getByText("질문의 핵심에 맞게 답변해 주세요.")).toBeTruthy();
    rerender(videoRoom({ id: 304, seq: 4, content: "다음 질문" }));
    expect(screen.queryByText("질문의 핵심에 맞게 답변해 주세요.")).toBeNull();
    expect(room.mounts).toBe(1);
  });
  it("채팅 입력은 기존 면접방으로 전송하고 BE 질문 ID가 늦어도 표시 중인 질문 순서를 사용한다", () => {
    const { rerender } = render(chatRoom());
    fireEvent.input(screen.getByRole("textbox", { name: "답변" }), {
      target: { value: "작성 중인 답변" },
    });
    act(() => vi.advanceTimersByTime(800));
    expect(room.sendChatInput).toHaveBeenCalledExactlyOnceWith(3, 1, "작성 중인 답변", 800);
    expect(room.mounts).toBe(1);
    room.question = {
      type: "question",
      sessionId: 55,
      seq: 4,
      content: "다음 질문",
      speech: "started",
      alignment: null,
    };
    rerender(chatRoom());
    fireEvent.input(screen.getByRole("textbox", { name: "답변" }), {
      target: { value: "새 질문 표시 중" },
    });
    act(() => vi.advanceTimersByTime(800));
    expect(room.sendChatInput).toHaveBeenCalledTimes(2);
    expect(room.sendChatInput).toHaveBeenLastCalledWith(4, 1, "새 질문 표시 중", 800);
    fireEvent.input(screen.getByRole("textbox", { name: "답변" }), {
      target: { value: "질문 ID 확인 중 입력" },
    });
    act(() => vi.advanceTimersByTime(400));
    rerender(
      <InterviewRoom
        session={{ ...SESSION, mode: "CHAT" }}
        currentQuestion={{ id: 304, seq: 4, content: "다음 질문" }}
      />,
    );
    act(() => vi.advanceTimersByTime(400));
    expect(room.sendChatInput).toHaveBeenLastCalledWith(4, 2, "질문 ID 확인 중 입력", 800);
  });

  it.each(["ended", "failed"] as const)(
    "채팅 질문 재생 중 제출을 차단하고 %s 수신 뒤 허용한다",
    async (speech) => {
      room.question = {
        type: "question",
        sessionId: 55,
        seq: 3,
        content: "메시지의 질문",
        speech: "started",
        alignment: null,
      };
      submitTextAnswer.mockResolvedValue({ isLastQuestion: false });
      const { rerender } = render(chatRoom());
      expect(screen.getByText("메시지의 질문", { selector: ".sr-only" })).toBeTruthy();
      const input = screen.getByRole("textbox", { name: "답변" });
      fireEvent.input(input, { target: { value: "작성 중인 답변" } });
      expect(
        (screen.getByRole("button", { name: "답변 보내기" }) as HTMLButtonElement).disabled,
      ).toBe(true);
      await act(async () => {
        fireEvent.keyDown(input, { key: "Enter" });
      });
      expect(submitTextAnswer).not.toHaveBeenCalled();
      room.question = { ...room.question, speech };
      rerender(chatRoom());
      await act(async () => {
        fireEvent.keyDown(input, { key: "Enter" });
      });
      expect(submitTextAnswer).toHaveBeenCalledWith(
        55,
        303,
        { content: "작성 중인 답변" },
        expect.any(String),
      );
      expect(room.submitAnswer).toHaveBeenCalledExactlyOnceWith(3);
      expect(thinking()).toBeTruthy();
    },
  );

  it("채팅은 메시지의 질문을 표시해 바로 쓸 수 있게 하고, 같은 순서의 질문 ID(5.5)를 바로 받아 오며 확인하기 전에는 내지 않는다", async () => {
    // 답한 뒤 다음 질문 ID(5.5)를 아직 받지 못한 상태: BE 질문은 없고 면접방 메시지만 왔다
    room.question = {
      type: "question",
      sessionId: 55,
      seq: 4,
      content: "새 질문",
      speech: "ended",
      alignment: null,
    };
    const chat = (question: CurrentQuestion | null) => (
      <InterviewRoom session={{ ...SESSION, mode: "CHAT" }} currentQuestion={question} />
    );
    const { rerender } = render(chat(null));
    expect(screen.getByText("새 질문", { selector: ".sr-only" })).toBeTruthy();
    const box = () => screen.getByRole("textbox", { name: "답변" });
    const button = () => screen.getByRole("button", { name: "답변 보내기" }) as HTMLButtonElement;
    // 질문 글이 보이면 바로 쓸 수 있지만, 질문 ID를 받기 전에는 Enter · 폼 제출로도 내지 않는다
    expect(box()).toHaveProperty("disabled", false);
    expect(button().disabled).toBe(true);
    fireEvent.input(box(), { target: { value: "먼저 써 둔 답" } });
    await act(async () => fireEvent.keyDown(box(), { key: "Enter" }));
    await act(async () => fireEvent.submit(box().closest("form")!));
    expect(submitTextAnswer).not.toHaveBeenCalled();
    // 메시지를 받으면 2초 조회를 기다리지 않고 바로 5.5를 다시 받는다
    act(() => vi.advanceTimersByTime(0));
    expect(refresh).toHaveBeenCalledTimes(1);
    // 아직 같은 순서가 아니면(BE가 질문 시작을 받기 전) 잠깐 뒤, 그래도 아니면 2초 뒤 다시 확인한다
    act(() => vi.advanceTimersByTime(QUESTION_RECHECK_MS - 1));
    expect(refresh).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(1));
    expect(refresh).toHaveBeenCalledTimes(2);
    act(() => vi.advanceTimersByTime(SESSION_POLL_MS - 1));
    expect(refresh).toHaveBeenCalledTimes(2);
    act(() => vi.advanceTimersByTime(1));
    expect(refresh).toHaveBeenCalledTimes(3);

    // 같은 순서의 ID를 받으면 낼 수 있고, 더는 다시 조회하지 않는다
    rerender(chat({ id: 304, seq: 4, content: "BE 질문" }));
    expect(button().disabled).toBe(false);
    expect(box()).toHaveProperty("value", "먼저 써 둔 답");
    refresh.mockClear();
    act(() => vi.advanceTimersByTime(SESSION_POLL_MS * 3));
    expect(refresh).not.toHaveBeenCalled();
  });

  it("채팅: 면접방 메시지를 기다리는 동안(질문 없음)은 한 곳에서만 2초마다 다시 조회한다(요청이 서로를 끊지 않게)", () => {
    render(<InterviewRoom session={{ ...SESSION, mode: "CHAT" }} currentQuestion={null} />);
    act(() => vi.advanceTimersByTime(SESSION_POLL_MS - 1));
    expect(refresh).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(refresh).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(SESSION_POLL_MS));
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("채팅: 인터넷이 끊기면 다시 조회하지 않고, 다시 연결되면 이어서 조회한다", () => {
    online = false;
    const { rerender } = render(
      <InterviewRoom session={{ ...SESSION, mode: "CHAT" }} currentQuestion={null} />,
    );
    act(() => vi.advanceTimersByTime(SESSION_POLL_MS * 3));
    expect(refresh).not.toHaveBeenCalled();

    online = true;
    act(() => window.dispatchEvent(new Event("online")));
    rerender(<InterviewRoom session={{ ...SESSION, mode: "CHAT" }} currentQuestion={null} />);
    act(() => vi.advanceTimersByTime(SESSION_POLL_MS));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("채팅: 답한 직후 지난 질문 메시지가 남아 있어도 바로 조회하지 않고 2초 예비 조회로 가며, 다음 질문 메시지가 오면 바로 조회한다", async () => {
    room.question = {
      type: "question",
      sessionId: 55,
      seq: 3,
      content: "지금 질문",
      speech: "ended",
      alignment: null,
    };
    submitTextAnswer.mockResolvedValue({ isLastQuestion: false });
    const { rerender } = render(chatRoom());
    const box = () => screen.getByRole("textbox", { name: "답변" });
    fireEvent.input(box(), { target: { value: "답" } });
    await act(async () => fireEvent.keyDown(box(), { key: "Enter" }));
    expect(submitTextAnswer).toHaveBeenCalledOnce();
    rerender(chatRoom());

    act(() => vi.advanceTimersByTime(SESSION_POLL_MS - 1));
    expect(refresh).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(refresh).toHaveBeenCalledTimes(1);

    room.question = { ...room.question, seq: 4, content: "다음 질문" };
    rerender(chatRoom());
    act(() => vi.advanceTimersByTime(0));
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it.each(["ended", "failed"] as const)(
    "화상 질문 started 동안 제출을 차단하고 %s 뒤 해제한다",
    (speech) => {
      room.confirmedText = "이전 캡처의 발화";
      room.question = {
        type: "question",
        sessionId: 55,
        seq: 3,
        content: "질문 메시지",
        speech: "started",
        alignment: null,
      };
      const { rerender } = render(videoRoom());
      expect(caption()).toContain("질문이 끝나면 말씀해 주세요");
      expect(caption()).not.toContain("이전 캡처의 발화");
      room.question = { ...room.question, speech };
      rerender(videoRoom());
      expect(caption()).toContain("이전 캡처의 발화");
    },
  );

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

  it("채팅: 질문을 준비하는 동안(5.2 READY · GENERATING) 다시 조회하고, 준비가 끝난 뒤 [면접 시작]을 누르면 5.4를 한 번만 부른다", async () => {
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
    // 준비가 끝나도 대기 화면의 [면접 시작]을 눌러야 시작한다
    expect(startSession).not.toHaveBeenCalled();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "면접 시작" })));
    rerender(<InterviewRoom session={{ ...chat, planStatus: "READY" }} currentQuestion={null} />);

    expect(startSession).toHaveBeenCalledTimes(1);
    expect(startSession).toHaveBeenCalledWith(55, expect.stringMatching(/^[0-9a-f-]{36}$/));
  });

  it("채팅: 5.4 시작이 서버 실패면 2초 뒤 다시 조회하고 새 키로, 연결 오류면 같은 키로 다시 보낸다", async () => {
    const chat = { ...SESSION, mode: "CHAT", status: "READY", currentQuestion: null } as const;
    // 5.4가 돌려줄 결과는 테스트가 단계마다 바꾼다.
    let result: object = { formError: "지금은 할 수 없는 요청이에요.", keySpent: true };
    startSession.mockImplementation(async () => result);
    render(<InterviewRoom session={chat} currentQuestion={null} />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "면접 시작" })));
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
    expect(joinRoom).toHaveBeenCalledWith(55, null, expect.objectContaining({ listenOnly: true }));
    expect(joinRoom).not.toHaveBeenCalledWith(55, null);
  });

  it("채팅: 다음 질문을 기다리는 동안에도 방에 남고, 질문이 바뀌어도 다시 들어가지 않는다", () => {
    const { rerender } = render(
      <InterviewRoom session={{ ...SESSION, mode: "CHAT" }} currentQuestion={null} />,
    );
    expect(joinRoom).toHaveBeenCalledWith(55, null, expect.objectContaining({ listenOnly: true }));
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
    expect(joinRoom).toHaveBeenCalledWith(
      55,
      null,
      expect.objectContaining({ onAnswerState: expect.any(Function) }),
    );
    expect(joinRoom).not.toHaveBeenCalledWith(
      55,
      null,
      expect.objectContaining({ listenOnly: true }),
    );
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
      room.confirmedText = "트래픽을 나눠 받았어요";
      room.submitAnswer = vi.fn(async () => result);
      render(videoRoom());

      await act(async () => fireEvent.click(submitButton()));
      expect(submitButton()).toHaveProperty("disabled", false);
      expect(caption()).toContain("트래픽을 나눠 받았어요");
    },
  );

  it("화상: 질문 음성이 나오는 동안(started)은 [답변 완료]를 막는다", () => {
    room.streamId = "capture-1";
    room.confirmedText = "이전 캡처의 발화";
    room.question = {
      type: "question",
      sessionId: 55,
      seq: 3,
      content: "질문 메시지",
      speech: "started",
      alignment: null,
    };
    const { rerender } = render(videoRoom());
    expect(submitButton()).toHaveProperty("disabled", true);
    room.question = { ...room.question, speech: "ended" };
    rerender(videoRoom());
    expect(submitButton()).toHaveProperty("disabled", false);
  });

  it("화상: 제출됨(submitted)이면 면접관이 생각 중이 되고 지난 답변 자막을 감추며, 다음 답변 캡처가 오면 다시 보여 준다", () => {
    room.streamId = "capture-1";
    room.confirmedText = "캐시를 바꿨어요";
    const { rerender } = render(videoRoom());
    expect(caption()).toContain("캐시를 바꿨어요");

    answerState({ seq: 3, state: "submitted" });
    expect(useInterviewStore.getState().answeredQuestionId).toBe(303);
    expect(thinking()).toBeTruthy();
    expect(caption()).not.toContain("캐시를 바꿨어요");

    // 다음 질문이 와도 에이전트가 새 캡처를 열기 전에는 지난 답변 글을 보이지 않는다
    const next = { id: 304, seq: 4, content: "다음 질문" };
    rerender(videoRoom(next));
    expect(caption()).not.toContain("캐시를 바꿨어요");

    room.streamId = "capture-2";
    room.confirmedText = "새 답변";
    rerender(videoRoom(next));
    expect(caption()).toContain("새 답변");
  });

  it("화상: 지금 질문이 아닌 답변 상태는 무시한다", () => {
    room.streamId = "capture-1";
    room.confirmedText = "지금 답변";
    render(videoRoom());

    answerState({ seq: 2, state: "submitted" });
    answerState({ seq: 2, state: "autoSubmitted" });
    expect(useInterviewStore.getState().answeredQuestionId).toBeNull();
    expect(caption()).toContain("지금 답변");
  });

  it("화상: 무응답 안내 후 같은 질문에서 대기하며 발화가 시작되면 안내를 해제한다", () => {
    room.streamId = "capture-1";
    const { rerender } = render(videoRoom());
    answerState({ seq: 3, state: "timedOut" });
    expect(screen.getByText("답변을 기다리고 있어요. 말씀을 시작해 주세요")).toBeTruthy();
    expect(thinking()).toBeNull();
    expect(useInterviewStore.getState().answeredQuestionId).toBeNull();
    expect(room.submitAnswer).not.toHaveBeenCalled();
    room.interimText = "답변 시작";
    rerender(videoRoom());
    expect(screen.queryByText("답변을 기다리고 있어요. 말씀을 시작해 주세요")).toBeNull();
  });

  it("화상: 자동 제출(autoSubmitted)이면 내는 중이 되어 2초마다 5.5로 다음 질문을 확인하고, 다음 질문이 오면 멈춘다", () => {
    room.streamId = "capture-1";
    room.confirmedText = "캐시를 바꿨어요";
    const { rerender } = render(videoRoom());
    answerState({ seq: 3, state: "autoSubmitted" });
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
    answerState({ seq: 3, state: "autoSubmitted" });
    act(() => vi.advanceTimersByTime(SESSION_POLL_MS * 3));
    expect(refresh).not.toHaveBeenCalled();
  });

  it("화상: 제출 실패 안내 후 같은 질문을 재전송하며 수락 후 안내를 해제한다", async () => {
    room.streamId = "capture-1";
    room.confirmedText = "트래픽을 나눠 받았어요";
    render(videoRoom());
    answerState({ seq: 3, state: "autoSubmitted" });
    // 에이전트가 낸 답변을 결과 큐에 넣지 못했다
    answerState({ seq: 3, state: "submitFailed" });
    const alert = screen.getByRole("alert");
    expect(within(alert).getByText("답변을 저장하지 못했어요")).toBeTruthy();
    expect(within(alert).getByRole("button", { name: "다시 시도" })).toBeTruthy();
    expect(retryButton()).toHaveProperty("disabled", false);
    await act(async () => fireEvent.click(retryButton()));
    expect(room.submitAnswer).toHaveBeenCalledExactlyOnceWith(3);
    expect(screen.queryByText("답변을 저장하지 못했어요")).toBeNull();
  });

  it.each(["rejected", "failed"])(
    "화상: 재전송이 수락되지 않으면(%s) 실패 안내와 재시도를 유지한다",
    async (result) => {
      room.submitAnswer = vi.fn(async () => result);
      render(videoRoom());
      answerState({ seq: 3, state: "submitFailed" });
      await act(async () => fireEvent.click(retryButton()));
      expect(retryButton()).toHaveProperty("disabled", false);
      expect(screen.getByRole("alert").textContent).toContain("답변을 저장하지 못했어요");
    },
  );

  it("화상: 재전송 응답 대기 중 중복 제출을 차단하고 완료까지 기다린다", async () => {
    let finish!: (value: string) => void;
    room.submitAnswer = vi.fn(() => new Promise<string>((resolve) => (finish = resolve)));
    render(videoRoom());
    answerState({ seq: 3, state: "submitFailed" });
    await act(async () => fireEvent.click(retryButton()));
    // 응답을 기다리는 동안 안내는 남고 [다시 시도]는 막혀 다시 보내지 않는다
    expect(screen.getByText("답변을 저장하지 못했어요")).toBeTruthy();
    expect(retryButton()).toHaveProperty("disabled", true);
    await act(async () => fireEvent.click(retryButton()));
    expect(room.submitAnswer).toHaveBeenCalledTimes(1);
    await act(async () => finish("accepted"));
    expect(screen.queryByText("답변을 저장하지 못했어요")).toBeNull();
  });

  it("화상: 음성 인식 실패 알림만 받아도 인식된 자막을 남기고 '음성 인식이 끊겼어요'를 알린다", () => {
    room.streamId = "capture-1";
    room.confirmedText = "인식된 답변";
    render(videoRoom());
    answerState({ seq: 3, state: "sttFailed" });
    expect(caption()).toContain("인식된 답변");
    expect(screen.getByText("음성 인식이 끊겼어요").closest('[role="status"]')).toBeTruthy();
  });

  it.each(["submitFailed", "timedOut"] as const)(
    "화상: 이전 질문의 %s 안내를 새 질문에 표시하지 않는다",
    (state) => {
      const { rerender } = render(videoRoom());
      answerState({ seq: 3, state });
      room.question = {
        type: "question",
        sessionId: 55,
        seq: 4,
        content: "새 질문",
        speech: "started",
        alignment: null,
      };
      rerender(videoRoom());
      expect(screen.queryByText("답변을 저장하지 못했어요")).toBeNull();
      expect(screen.queryByText("답변을 기다리고 있어요. 말씀을 시작해 주세요")).toBeNull();
      expect(screen.queryByRole("button", { name: "다시 시도" })).toBeNull();
    },
  );

  it("화상: 저장할 수 없는 답변은 제출됨 알림 없이 다음 질문을 표시한다", () => {
    room.streamId = "capture-1";
    room.confirmedText = "이전 답변";
    const { rerender } = render(videoRoom());
    answerState({ seq: 3, state: "autoSubmitted" });
    room.question = {
      type: "question",
      sessionId: 55,
      seq: 4,
      content: "저장 실패 후 다음 질문",
      speech: "ended",
      alignment: null,
    };
    room.streamId = "capture-2";
    room.confirmedText = "";
    rerender(videoRoom({ id: 304, seq: 4, content: "다음 질문" }));
    expect(screen.getByText("저장 실패 후 다음 질문", { selector: ".sr-only" })).toBeTruthy();
    expect(caption()).not.toContain("이전 답변");
    expect(screen.queryByText("답변을 저장하지 못했어요")).toBeNull();
  });

  it("화상: 낸 뒤 같은 질문에 새 자막 캡처가 열리면(에이전트가 다시 듣는다) 다시 답할 수 있다", async () => {
    room.streamId = "capture-1";
    room.confirmedText = "음";
    const { rerender } = render(videoRoom());
    answerState({ seq: 3, state: "autoSubmitted" });

    room.streamId = "capture-2";
    room.confirmedText = "다시 말한 답";
    rerender(videoRoom());
    expect(caption()).toContain("다시 말한 답");
  });

  it("화상: 재입장 후 자막이 없어도 실패 안내와 재시도를 복구한다", async () => {
    render(videoRoom());
    answerState({ seq: 3, state: "submitFailed" });
    expect(screen.getByRole("alert").textContent).toContain("답변을 저장하지 못했어요");
    await act(async () => fireEvent.click(retryButton()));
    expect(room.submitAnswer).toHaveBeenCalledExactlyOnceWith(3);
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

// 기준: Figma S06-F 연결 끊김(18:4323) · S06-F2 면접관 연결 실패(345:1815) · 기획 메모 S06-F(18:3575: 5초 넘게 다시 잇지 못하면 '잠시 멈춤')
// · S06-F2(340:1886: 5.2 START_FAILED면 [다시 시작] → 5.4 · [나가기] → 홈)
describe("InterviewRoom (S06-F 연결 끊김 · S06-F2 면접관 연결 실패)", () => {
  const banner = () => screen.queryByText(/^연결이 불안정해요/);
  const paused = () => screen.queryByRole("alertdialog", { name: "면접이 잠시 멈췄어요" });
  const startFailedRoom = () => (
    <InterviewRoom session={{ ...SESSION, status: "START_FAILED" }} currentQuestion={QUESTION} />
  );

  it("화상: 다시 연결하는 동안 배너로 초를 세고, 5초가 되면 배너 대신 '잠시 멈춤' 카드를 띄운다", () => {
    room.status = "reconnecting";
    render(videoRoom());
    expect(banner()?.textContent).toBe("연결이 불안정해요 · 다시 연결하는 중… 0초");

    act(() => vi.advanceTimersByTime(PAUSE_AFTER_MS - 1000));
    expect(banner()?.textContent).toBe("연결이 불안정해요 · 다시 연결하는 중… 4초");
    expect(paused()).toBeNull();

    act(() => vi.advanceTimersByTime(1000));
    expect(banner()).toBeNull();
    expect(paused()?.textContent).toContain("답하던 질문은 처음부터 다시 답해요");
  });

  it("화상: '잠시 멈춤'의 [다시 시도]는 면접방에 다시 들어가고, [면접 끝내기]는 종료 모달을 연다(카드는 닫힌다)", () => {
    room.status = "failed";
    render(videoRoom());
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(room.retry).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole("button", { name: "면접 끝내기" }));
    expect(useInterviewStore.getState().endOpen).toBe(true);
    expect(paused()).toBeNull();
  });

  it("화상: SDK가 다시 잇기를 포기하면(failed) 기다리지 않고 '잠시 멈춤'을 띄우고 5.2를 한 번 다시 불러 배정 거절인지 본다", () => {
    room.status = "failed";
    render(videoRoom());
    expect(paused()).toBeTruthy();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("5.2가 START_FAILED면 '면접관을 연결하지 못했어요'만 띄우고 '잠시 멈춤'은 띄우지 않는다", () => {
    room.status = "failed";
    render(startFailedRoom());
    expect(screen.getByRole("alertdialog", { name: "면접관을 연결하지 못했어요" })).toBeTruthy();
    expect(paused()).toBeNull();
  });

  it("[다시 시작]은 5.4를 보내고, 성공하면 면접방에 처음부터 다시 들어간다", async () => {
    render(startFailedRoom());
    expect(room.mounts).toBe(1);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "다시 시작" })));
    expect(startSession).toHaveBeenCalledExactlyOnceWith(
      55,
      expect.stringMatching(/^[0-9a-f-]{36}$/),
    );
    expect(room.mounts).toBe(2);
  });

  it("[다시 시작]이 실패하면 서버 문구를 보이고, 키를 다 썼으면(keySpent) 새 키로 · 아니면 같은 키로 다시 보낸다", async () => {
    startSession
      .mockResolvedValueOnce({ formError: "다시 시작하지 못했어요", keySpent: false })
      .mockResolvedValueOnce({ formError: "다시 시작하지 못했어요", keySpent: true });
    render(startFailedRoom());
    const restart = () => screen.getByRole("button", { name: "다시 시작" });

    await act(async () => fireEvent.click(restart()));
    expect(screen.getByRole("alertdialog").textContent).toContain("다시 시작하지 못했어요");
    expect(room.mounts).toBe(1);
    await act(async () => fireEvent.click(restart()));
    await act(async () => fireEvent.click(restart()));

    const keys = startSession.mock.calls.map((call) => call[1]);
    expect(keys[1]).toBe(keys[0]);
    expect(keys[2]).not.toBe(keys[1]);
  });

  it("[다시 시작]을 보내는 동안 두 버튼을 막는다", async () => {
    let finish!: (value: object) => void;
    startSession.mockReturnValueOnce(new Promise((resolve) => (finish = resolve)));
    render(startFailedRoom());
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "다시 시작" })));
    expect(screen.getByRole("button", { name: "다시 시작" })).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "나가기" })).toHaveProperty("disabled", true);
    await act(async () => finish({}));
    expect(screen.getByRole("button", { name: "다시 시작" })).toHaveProperty("disabled", false);
  });

  it("[나가기]는 홈으로 간다", () => {
    render(startFailedRoom());
    fireEvent.click(screen.getByRole("button", { name: "나가기" }));
    expect(push).toHaveBeenCalledExactlyOnceWith("/home");
  });
});

// 기준: 사용자 요청(2026-10-27: 채팅 대기 화면 · 화면 숨기기 · 면접 종료가 안 되는 현상)
describe("InterviewRoom (채팅 대기 화면 · 화면 숨기기 · 끝난 뒤)", () => {
  const chatReady = (planStatus: SessionResponse["planStatus"]) => (
    <InterviewRoom
      session={{ ...SESSION, mode: "CHAT", status: "READY", planStatus, currentQuestion: null }}
      currentQuestion={null}
    />
  );
  const waitingScreen = () =>
    screen.queryByRole("region", { name: "면접관이 면접을 준비하고 있어요" });

  it("채팅: 준비 중이면 대기 화면을 띄우고, 질문 준비가 실패하면 대기 화면 대신 [다시 시도]를 보인다", () => {
    const { rerender } = render(chatReady("GENERATING"));
    expect(waitingScreen()).toBeTruthy();
    rerender(chatReady("FAILED"));
    expect(waitingScreen()).toBeNull();
    expect(screen.getByRole("button", { name: "다시 시도" })).toBeTruthy();
  });

  it("채팅: [면접 시작]을 누르면 대기 화면을 닫는다", async () => {
    render(chatReady("READY"));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "면접 시작" })));
    expect(waitingScreen()).toBeNull();
  });

  it("화상: 답변 5개가 저장돼 끝내는 중(5.8)이면 BE가 면접방을 닫아 끊겨도 '잠시 멈춤'을 띄우지 않는다", async () => {
    room.status = "failed";
    render(videoRoom(null, 5));
    await act(async () => {});
    expect(screen.queryByRole("alertdialog", { name: "면접이 잠시 멈췄어요" })).toBeNull();
  });

  it("화상: 화면을 숨긴 동안에도 재연결 안내(배너)는 보인다", () => {
    room.status = "reconnecting";
    render(videoRoom());
    fireEvent.click(screen.getByRole("button", { name: "화면 숨기기" }));
    const banner = screen.getByText(/^연결이 불안정해요/);
    expect(banner.closest(".hidden")).toBeNull();
  });

  it("화상: 끝낸 뒤(5.2 IN_PROGRESS 아님) BE가 면접방을 닫아 연결이 끊겨도 '잠시 멈춤'을 띄우지 않고 5.2를 다시 부르지 않는다", () => {
    room.status = "failed";
    render(<InterviewRoom session={{ ...SESSION, status: "FAILED" }} currentQuestion={null} />);
    expect(screen.queryByRole("alertdialog", { name: "면접이 잠시 멈췄어요" })).toBeNull();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("화상: 눈 버튼으로 화면을 숨기면 [면접 종료] · [화면 보이기]만 남기고 상단 바 · 질문 · 내 답변 · 내 카메라를 숨긴다. 면접방에는 그대로 있다", () => {
    room.streamId = "capture-1";
    room.confirmedText = "답";
    render(videoRoom());
    const mounts = room.mounts;
    const hiddenBox = (element: Element | null) => element?.closest(".hidden") ?? null;
    // 내 카메라는 '나' 칩으로 본다(카메라가 없으면 영상 칸은 원래 숨어 있다)
    const camera = () => screen.getByText("나", { exact: true });
    const parts = () => [
      screen.getByRole("region", { name: "내 답변 음성 인식" }),
      camera(),
      screen.getByRole("region", { name: "악마 면접관 질문" }),
      screen.getByTestId("waveform"),
      submitButton(),
    ];
    for (const part of parts()) expect(hiddenBox(part)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "화면 숨기기" }));

    expect(hiddenBox(screen.getByRole("region", { name: "내 답변 음성 인식" }))).toBeTruthy();
    expect(hiddenBox(camera())).toBeTruthy();
    // [면접 종료]는 남고, 상단 바의 면접관 · 진행 표시는 숨긴다
    expect(hiddenBox(screen.getByRole("button", { name: "면접 종료" }))).toBeNull();
    expect(screen.getByText("질문 3 / 5").closest(".invisible")).toBeTruthy();
    expect(hiddenBox(screen.getByRole("region", { name: "악마 면접관 질문" }))).toBeTruthy();
    const show = screen.getByRole("button", { name: "화면 보이기" });
    expect(hiddenBox(show)).toBeNull();
    // 파형도 숨긴다
    expect(hiddenBox(screen.getByTestId("waveform"))).toBeTruthy();
    // 숨기기만 하므로 면접방에 다시 들어가지 않는다
    expect(room.mounts).toBe(mounts);

    fireEvent.click(show);
    for (const part of parts()) expect(hiddenBox(part)).toBeNull();
    expect(screen.queryByRole("button", { name: "화면 보이기" })).toBeNull();
  });

  it("채팅: 화면을 숨기면 질문 · 답변 입력을 숨기고 [면접 종료] · [화면 보이기]만 남긴다", () => {
    render(chatRoom());
    const hiddenBox = (element: Element | null) => element?.closest(".hidden") ?? null;
    expect(hiddenBox(screen.getByRole("textbox", { name: "답변" }))).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "화면 숨기기" }));
    expect(hiddenBox(screen.getByRole("textbox", { name: "답변" }))).toBeTruthy();
    expect(hiddenBox(screen.getByRole("region", { name: "악마 면접관 질문" }))).toBeTruthy();
    expect(hiddenBox(screen.getByRole("button", { name: "면접 종료" }))).toBeNull();
    expect(hiddenBox(screen.getByRole("button", { name: "화면 보이기" }))).toBeNull();
  });
});
