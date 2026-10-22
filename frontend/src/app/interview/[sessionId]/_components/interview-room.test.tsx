import { act, cleanup, render, screen } from "@testing-library/react";
import { motionValue } from "motion/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useInterviewStore } from "@/stores/interview-store";
import type { CurrentQuestion, SessionResponse } from "@/types/api";

import { InterviewRoom, SESSION_POLL_MS } from "./interview-room";

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
vi.mock("@/lib/interview/actions", () => ({
  startSession: (...args: unknown[]) => startSession(...args),
  submitTextAnswer: vi.fn(),
  endSession: vi.fn(),
}));
vi.mock("@/components/interview/interviewer-stage", () => ({
  InterviewerStage: () => <div data-testid="interviewer-stage" />,
}));
vi.mock("./use-interview-media", () => ({
  useInterviewMedia: () => ({ stream: null, level: motionValue(0.5) }),
}));

// 기준: Swagger 5.2(status · planStatus · mode) · 5.5 지금 질문 · 5.4 면접 시작
// · API 명세 1장(2초마다(임시 값) 다시 불러 확인) · 5.4(채팅: 질문 준비가 끝나면 화면이 자동으로 부른다)
// · 기획 메모 S06-1(18:3531: 마지막 답변 · 끝내기 직후 결과 분석 중)

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
  online = true;
  vi.spyOn(navigator, "onLine", "get").mockImplementation(() => online);
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

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

  it("화상 면접은 이 화면에서 시작하지 않는다(S05 [면접 시작])", () => {
    render(
      <InterviewRoom
        session={{ ...SESSION, status: "READY", currentQuestion: null }}
        currentQuestion={null}
      />,
    );
    expect(startSession).not.toHaveBeenCalled();
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
