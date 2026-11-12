// 기준: Figma S06 화상(18:2497) · S06-B 채팅(18:2574) · S06-1(18:4437) · S06-F 연결 끊김(18:4323) · S06-F2 면접관 연결 실패(345:1815)
// · 기획 메모 S06(18:757) · S06-B(18:1050) · S06-F(18:3575) · S06-F2(340:1886)
// · 웹 Swagger 5.2(status · planStatus · mode) · 5.3 면접 플랜 재생성 · 5.4 면접 시작(채팅도 송출 없이 면접방에 들어간다) · 5.5 지금 질문
// · 5.8 면접 끝내기 · API 명세 면접방 메시지(answer.state · answer.submit) · 5.8 「직전 답변 저장 확인」
// · 사용자 결정(2026-10-22 준비 실패 문구 · 2026-10-26 채팅 면접방 다시 들어가기 3번 · 2026-11-09 떠나기 확인 · 마이크 안내)
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { motionValue, type MotionValue } from "motion/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { InterviewerStage } from "@/components/interview/interviewer-stage";
import {
  useInterviewRoom,
  type InterviewRoomStatus,
  type RoomPresentation,
  type SubmitAnswerResult,
} from "@/components/interview/use-interview-room";
import { endSession, retryPlan, startSession, submitTextAnswer } from "@/lib/interview/actions";
import { useDuckAmbience } from "@/lib/interview/duck-ambience";
import { playDuckCall, preloadDuckCall } from "@/lib/interview/duck-call";
import { gazeRatio, MIN_GAZE_SAMPLES, type GazeFrame, type GazeSample } from "@/lib/interview/gaze";
import type {
  AnswerStateMessage,
  AttitudeSample,
  QuestionMessage,
  ReactionSnapshot,
} from "@/lib/interview/room-messages";
import { ROUTES } from "@/lib/routes";
import { useGazeStore } from "@/stores/gaze-store";
import { useInterviewStore } from "@/stores/interview-store";
import { useInterviewerPreloadStore } from "@/stores/interviewer-preload-store";
import { deferred } from "@/test/deferred";
import { flushPromises } from "@/test/flush";
import { router } from "@/test/next-navigation";
import type { CurrentQuestion, SessionResponse } from "@/types/api";

import { CHAT_INPUT_PAUSE_MS } from "./chat-panel";
import {
  CHAT_ROOM_RETRIES,
  CHAT_ROOM_RETRY_MS,
  InterviewRoom,
  QUESTION_RECHECK_MS,
  SESSION_POLL_MS,
} from "./interview-room";
import { PAUSE_AFTER_MS, RESTART_WAIT_SECONDS } from "./room-alerts";
import { SAVE_WAIT_MS } from "./use-save-confirmed";
import { SILENT_TOAST_MS } from "./video-panel";

// 경계 mock: Next 런타임(router.refresh · push)과 면접 서버 액션(EndModal · ChatPanel은 진짜로 같이 돈다)
vi.mock("next/navigation", () => import("@/test/next-navigation"));
vi.mock("@/lib/interview/actions", () => ({
  startSession: vi.fn(),
  retryPlan: vi.fn(),
  endSession: vi.fn(),
  submitTextAnswer: vi.fn(),
}));
// 경계 mock: 면접방(LiveKit)을 감싸는 우리 훅(use-interview-room.test.ts가 따로 본다). 테스트가 바꾸는 값을 돌려주고,
// 붙은 횟수를 센다(다시 붙으면 실제 훅은 새로 입장한다). AI 메시지는 테스트가 onAnswerState · question · reaction으로 넣는다
const room = vi.hoisted(() => ({
  status: "idle" as InterviewRoomStatus,
  streamId: null as string | null,
  confirmedText: "",
  interimText: "",
  question: null as QuestionMessage | null,
  reaction: null as ReactionSnapshot | null,
  attitude: [] as AttitudeSample[],
  mounts: 0,
  retry: vi.fn(),
  submitAnswer: vi.fn(async (): Promise<SubmitAnswerResult> => "accepted"),
  sendChatInput: vi.fn(),
  pauseMicrophone: vi.fn(),
  sendFrame: vi.fn(),
}));
vi.mock("@/components/interview/use-interview-room", async () => {
  const { useEffect } = await import("react");
  return {
    useInterviewRoom: vi.fn(() => {
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
        attitude: room.attitude,
        retry: room.retry,
        submitAnswer: room.submitAnswer,
        sendChatInput: room.sendChatInput,
        pauseMicrophone: room.pauseMicrophone,
        sendFrame: room.sendFrame,
      };
    }),
  };
});
// 경계 mock: 면접관 3D 장면(WebGL) · 시선 측정(MediaPipe) · 카메라 · 마이크 · 오디오 · 3D 모델 받기
vi.mock("@/components/interview/interviewer-stage", () => ({
  InterviewerStage: vi.fn(() => null),
}));
vi.mock("@/components/interview/use-gaze-tracker", () => ({ useGazeTracker: vi.fn() }));
const media = vi.hoisted(() => ({ level: null as MotionValue<number> | null }));
vi.mock("./use-interview-media", () => ({
  useInterviewMedia: vi.fn(() => ({ stream: null, level: media.level, unavailable: false })),
}));
vi.mock("@/lib/interview/duck-call", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/interview/duck-call")>()),
  playDuckCall: vi.fn(),
  preloadDuckCall: vi.fn(),
}));
vi.mock("@/lib/interview/duck-ambience", () => ({ useDuckAmbience: vi.fn() }));
vi.mock("@/lib/interviewer/preload", () => ({ preloadInterviewer: vi.fn() }));
// 경계 mock: 연출(motion)은 건너뛴다
vi.mock("motion/react", async (importOriginal) =>
  (await import("@/test/motion")).reducedMotion(importOriginal),
);

// 예시 데이터: Swagger 5.2 200 예시 'S06·S06-B 면접 중' · 5.5 200 예시
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
const QUESTION: CurrentQuestion = {
  id: 303,
  seq: 3,
  content: "흐음~ ○○ 프로젝트라. 거기서 '직접' 한 부분만 쏙 골라서 말해볼래요?",
};
const NEXT: CurrentQuestion = { id: 304, seq: 4, content: "그때 다른 방법은 없었나요?" };
const LAST: CurrentQuestion = { id: 305, seq: 5, content: "마지막으로 하고 싶은 말이 있나요?" };
/** 채팅 질문 준비가 끝나 미리 시작할 차례(5.2 READY · planStatus READY) */
const PREPARED = { mode: "CHAT", status: "READY", planStatus: "READY" } as const;
/** 서버 실패 문구(Swagger 5.4 · 5.8 오류 detail) */
const SERVER_ERROR = "지금은 할 수 없는 요청이에요.";
const FRONT: GazeSample = { headYaw: 0, headPitch: 0, eyeYaw: 0, eyePitch: 0, blinking: false };
const MIC_TOAST = "마이크 소리가 들리지 않아요";
const INTERRUPT = "질문의 핵심에 맞게 답변해 주세요.";

/** 면접 화면. rerender에 같은 요소를 넘기면 다시 그리지 않으므로 매번 새로 만든다 */
function view(question: CurrentQuestion | null = QUESTION, session: Partial<SessionResponse> = {}) {
  return <InterviewRoom session={{ ...SESSION, ...session }} currentQuestion={question} />;
}
function chatView(
  question: CurrentQuestion | null = QUESTION,
  session: Partial<SessionResponse> = {},
) {
  return view(question, { mode: "CHAT", ...session });
}
/** 면접관이 보낸 질문 메시지(AI 명세 6.3 interview.question) */
function questionMessage(
  seq: number,
  speech: QuestionMessage["speech"] = "ended",
  content = `면접관이 말하는 ${seq}번 질문`,
): QuestionMessage {
  return { type: "question", sessionId: 55, seq, content, speech, alignment: null };
}
/** 끼어들기 문구가 있는 리액션 메시지 */
function interruptReaction(questionSeq: number): ReactionSnapshot {
  return {
    receivedAt: 0,
    message: {
      type: "reaction",
      sessionId: 55,
      questionSeq,
      seq: 1,
      reaction: null,
      attitude: { interest: 0.7, trust: 0.3 },
      interrupt: { reason: "OFF_TOPIC", text: INTERRUPT },
    },
  };
}
const roomOptions = () => vi.mocked(useInterviewRoom).mock.lastCall?.[2];
/** 에이전트가 보낸 답변 상태(answer.state)를 화면에 넘긴다 */
function answerState(seq: number, state: AnswerStateMessage["state"]) {
  act(() => roomOptions()?.onAnswerState?.({ type: "answer.state", sessionId: 55, seq, state }));
}
/** 면접방 훅이 면접관 장면에 넘기는 값을 화면에 넘긴다 */
function present(value: RoomPresentation) {
  act(() => roomOptions()?.onPresentation?.(value));
}
const stageProps = () => vi.mocked(InterviewerStage).mock.lastCall?.[0];
function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}
async function advanceAsync(ms: number) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
}
function goOffline() {
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
}
function goOnline() {
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  act(() => {
    window.dispatchEvent(new Event("online"));
  });
}
function leavePage() {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}
const thinking = () => screen.queryByRole("status", { name: "면접관이 생각하는 중" });
const shownQuestion = (content: string) => screen.queryByText(content, { selector: ".sr-only" });
const caption = () => screen.getByRole("region", { name: "내 답변 음성 인식" });
const submitButton = () => screen.getByRole<HTMLButtonElement>("button", { name: "답변 완료" });
const retryButton = () => screen.getByRole<HTMLButtonElement>("button", { name: "다시 시도" });
const sendButton = () => screen.getByRole<HTMLButtonElement>("button", { name: "답변 보내기" });
const answerBox = () => screen.getByRole("textbox", { name: "답변" });
const waitingScreen = () =>
  screen.queryByRole("region", { name: "면접관이 면접을 준비하고 있어요" });
const pausedCard = () => screen.queryByRole("alertdialog", { name: "면접이 잠시 멈췄어요" });
const startFailedCard = () =>
  screen.queryByRole("alertdialog", { name: "면접관을 연결하지 못했어요" });
const banner = () => screen.queryByText(/^연결이 불안정해요/);
const hiddenBox = (element: Element) => element.closest(".hidden");
/** 화상: 내 답변 자막이 있는 상태에서 [답변 완료] */
async function pressSubmit() {
  fireEvent.click(submitButton());
  await flushPromises();
}
/** 채팅: 답변을 쓰고 Enter로 낸다 */
async function answerChat(text: string) {
  fireEvent.input(answerBox(), { target: { value: text } });
  fireEvent.keyDown(answerBox(), { key: "Enter" });
  await flushPromises();
}
const startKeys = () => vi.mocked(startSession).mock.calls.map((call) => call[1]);
/** S06-F2 [다시 시작]은 모달이 열린 뒤 RESTART_WAIT_SECONDS가 지나야 누를 수 있다(room-alerts) */
async function restartAfterWait() {
  advance(RESTART_WAIT_SECONDS * 1000);
  fireEvent.click(screen.getByRole("button", { name: "다시 시작" }));
  await flushPromises();
}
const startFailedView = () => view(QUESTION, { status: "START_FAILED" });

beforeEach(() => {
  vi.useFakeTimers();
  useInterviewStore.getState().reset();
  useGazeStore.getState().reset();
  useInterviewerPreloadStore.setState({ persona: null, status: "idle", progress: 0 });
  Object.assign(room, {
    status: "idle",
    streamId: null,
    confirmedText: "",
    interimText: "",
    question: null,
    reaction: null,
    attitude: [],
    mounts: 0,
  });
  media.level = motionValue(0.5);
  vi.mocked(startSession).mockResolvedValue({});
  vi.mocked(retryPlan).mockResolvedValue({});
  vi.mocked(endSession).mockResolvedValue({});
  vi.mocked(submitTextAnswer).mockResolvedValue({});
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
});

describe("InterviewRoom · 면접 화면", () => {
  describe("면접 화면 고르기", () => {
    describe("화면 표시", () => {
      it.each([{ status: "ANALYZING" }, { status: "COMPLETED" }] as const)(
        "상태가 '$status'이면 결과 분석 화면을 그리고 답변 영역을 그리지 않는다",
        ({ status }) => {
          render(view(null, { status }));

          expect(
            screen.getByRole("heading", { name: "면접관이 답변을 검토하고 있어요" }),
          ).toBeDefined();
          expect(screen.queryByRole("region", { name: "내 답변 음성 인식" })).toBeNull();
        },
      );

      it("결과 분석 중이면 면접관 장면에 반응 · 듣기 · 질문을 넘기지 않는다", () => {
        const { rerender } = render(view());
        present({
          question: questionMessage(3),
          reaction: interruptReaction(3),
          listening: { questionSeq: 3, streamId: "capture-1", speechAt: 0 },
        });

        rerender(view(null, { status: "ANALYZING" }));

        expect(stageProps()).toMatchObject({ feedback: null, listening: null, question: null });
      });

      it("화상 면접 중이면 내 답변 음성 인식 상자를 그린다", () => {
        render(view());

        expect(caption()).toBeDefined();
        expect(screen.queryByRole("textbox", { name: "답변" })).toBeNull();
      });

      it("채팅 면접 중이면 답변 입력창을 그린다", () => {
        render(chatView());

        expect(answerBox()).toBeDefined();
        expect(screen.queryByRole("region", { name: "내 답변 음성 인식" })).toBeNull();
      });

      it("방금 답한 질문이 그대로 오면 질문 대신 '생각 중'을 보인다", () => {
        render(view());

        act(() => useInterviewStore.getState().setAnsweredQuestion(QUESTION.id));

        expect(thinking()).not.toBeNull();
        expect(shownQuestion(QUESTION.content)).toBeNull();
      });

      it("방금 답한 질문과 다른 질문이 오면 그 질문을 보인다", () => {
        const { rerender } = render(view());
        act(() => useInterviewStore.getState().setAnsweredQuestion(QUESTION.id));

        rerender(view(NEXT));

        expect(shownQuestion(NEXT.content)).not.toBeNull();
        expect(thinking()).toBeNull();
      });
    });
  });

  describe("면접 상태 다시 조회", () => {
    describe("시간 경과", () => {
      it("결과 분석 중이면 2초가 될 때 화면을 다시 그린다", () => {
        render(view(null, { status: "ANALYZING" }));

        advance(SESSION_POLL_MS - 1);
        expect(router.refresh).not.toHaveBeenCalled();
        advance(1);
        expect(router.refresh).toHaveBeenCalledTimes(1);
      });

      it("결과가 나왔으면(COMPLETED) 2초가 지나도 다시 그리지 않는다", () => {
        render(view(null, { status: "COMPLETED" }));

        advance(SESSION_POLL_MS * 3);

        expect(router.refresh).not.toHaveBeenCalled();
      });

      it("채팅 질문 준비 중(READY · GENERATING)이면 2초 뒤 다시 그린다", () => {
        render(chatView(null, { status: "READY", planStatus: "GENERATING" }));

        advance(SESSION_POLL_MS);

        expect(router.refresh).toHaveBeenCalledTimes(1);
      });

      it("채팅 질문 준비가 실패했으면(FAILED) 2초가 지나도 다시 그리지 않는다", () => {
        render(chatView(null, { status: "READY", planStatus: "FAILED" }));

        advance(SESSION_POLL_MS * 3);

        expect(router.refresh).not.toHaveBeenCalled();
      });

      it("화상 면접 중 다음 질문이 없으면 2초 뒤 다시 그린다", () => {
        render(view(null));

        advance(SESSION_POLL_MS);

        expect(router.refresh).toHaveBeenCalledTimes(1);
      });

      it("화상 면접 중 질문이 있으면 다시 그리지 않는다", () => {
        render(view());

        advance(SESSION_POLL_MS * 3);

        expect(router.refresh).not.toHaveBeenCalled();
      });

      it("[끝내기] 뒤 저장 확인 중이면 질문이 있어도 2초 뒤 다시 그린다", () => {
        render(view());
        act(() => useInterviewStore.getState().setConfirmingSave(true));

        advance(SESSION_POLL_MS);

        expect(router.refresh).toHaveBeenCalledTimes(1);
      });

      it("다시 그린 뒤에도 기다릴 일이 남아 있으면 2초마다 다시 그린다", () => {
        render(view(null));

        advance(SESSION_POLL_MS);
        advance(SESSION_POLL_MS);

        expect(router.refresh).toHaveBeenCalledTimes(2);
      });

      it("인터넷이 끊기면 2초가 지나도 다시 그리지 않는다", () => {
        goOffline();
        render(view(null));

        advance(SESSION_POLL_MS * 3);

        expect(router.refresh).not.toHaveBeenCalled();
      });

      it("인터넷이 다시 연결되면 그때부터 2초 뒤 다시 그린다", () => {
        goOffline();
        render(view(null));
        advance(SESSION_POLL_MS * 3);

        goOnline();
        advance(SESSION_POLL_MS - 1);
        expect(router.refresh).not.toHaveBeenCalled();
        advance(1);
        expect(router.refresh).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe("페이지 떠나기 확인", () => {
    describe("사용자 조작", () => {
      it("면접 중에 페이지를 떠나려 하면 떠나기를 막아 확인 창을 띄운다", () => {
        render(view());

        expect(leavePage()).toBe(true);
      });

      it("면접 중이 아니면(결과 분석 중) 떠나기를 막지 않는다", () => {
        render(view(null, { status: "ANALYZING" }));

        expect(leavePage()).toBe(false);
      });
    });

    describe("정리", () => {
      it("화면을 떠나면 떠나기 확인을 거둔다", () => {
        const { unmount } = render(view());

        unmount();

        expect(leavePage()).toBe(false);
      });
    });
  });

  describe("지난 면접 상태 정리", () => {
    describe("상태 변화", () => {
      it("결과 분석 중이 아닌 면접에 들어오면 지난 레벨업을 지운다", () => {
        useInterviewStore.setState({ leveledUp: true });

        render(view());

        expect(useInterviewStore.getState().leveledUp).toBeNull();
      });

      it("결과 분석 중인 면접에 들어오면 레벨업은 남긴다", () => {
        useInterviewStore.setState({ leveledUp: true });

        render(view(null, { status: "ANALYZING" }));

        expect(useInterviewStore.getState().leveledUp).toBe(true);
      });
    });
  });

  describe("채팅 미리 시작", () => {
    describe("화면 표시", () => {
      it("채팅 질문 준비가 끝나면 면접 시작을 요청한다", () => {
        render(chatView(null, PREPARED));

        expect(startSession).toHaveBeenCalledTimes(1);
      });
    });

    describe("입력 검증", () => {
      it.each([
        { label: "화상", session: { mode: "VIDEO", status: "READY", planStatus: "READY" } },
        {
          label: "질문 준비 중",
          session: { mode: "CHAT", status: "READY", planStatus: "GENERATING" },
        },
        {
          label: "이미 면접 중",
          session: { mode: "CHAT", status: "IN_PROGRESS", planStatus: "READY" },
        },
      ] as const)("면접이 '$label'이면 면접 시작을 요청하지 않는다", ({ session }) => {
        render(view(null, session));

        expect(startSession).not.toHaveBeenCalled();
      });
    });

    describe("오류 처리", () => {
      it("면접 시작이 실패하면 대기 화면에 서버 문구를 보인다", async () => {
        vi.mocked(startSession).mockResolvedValue({ formError: SERVER_ERROR });

        render(chatView(null, PREPARED));
        await flushPromises();

        const waiting = waitingScreen();
        expect(waiting && within(waiting).getByRole("alert").textContent).toBe(SERVER_ERROR);
      });

      it("면접이 이미 시작됐으면(IN_PROGRESS) 미리 시작 실패 문구를 보이지 않는다", async () => {
        vi.mocked(startSession).mockResolvedValue({ formError: SERVER_ERROR });
        const { rerender } = render(chatView(null, PREPARED));
        await flushPromises();

        rerender(chatView(QUESTION));

        const waiting = waitingScreen();
        expect(waiting).not.toBeNull();
        expect(within(waiting!).queryByRole("alert")).toBeNull();
      });

      it("서버가 실패로 답했으면(keySpent) 새 멱등 키로 다시 요청한다", async () => {
        vi.mocked(startSession)
          .mockResolvedValueOnce({ formError: SERVER_ERROR, keySpent: true })
          .mockResolvedValue({});
        render(chatView(null, PREPARED));
        await flushPromises();

        await advanceAsync(SESSION_POLL_MS);

        const [first, second] = startKeys();
        expect(second).not.toBe(first);
      });

      it("응답 없이 실패했으면 같은 멱등 키로 다시 요청한다", async () => {
        vi.mocked(startSession)
          .mockResolvedValueOnce({ formError: SERVER_ERROR })
          .mockResolvedValue({});
        render(chatView(null, PREPARED));
        await flushPromises();

        await advanceAsync(SESSION_POLL_MS);

        const [first, second] = startKeys();
        expect(second).toBe(first);
      });
    });

    describe("중복 · 경쟁 처리", () => {
      it("개발 모드(StrictMode)에서 효과가 두 번 돌아도 면접 시작을 한 번만 요청한다", () => {
        render(chatView(null, PREPARED), { reactStrictMode: true });

        expect(startSession).toHaveBeenCalledTimes(1);
      });
    });

    describe("시간 경과", () => {
      it("면접 시작이 실패하면 2초 뒤 화면을 다시 그리고 다시 요청한다", async () => {
        vi.mocked(startSession).mockResolvedValue({ formError: SERVER_ERROR });
        render(chatView(null, PREPARED));
        await flushPromises();

        await advanceAsync(SESSION_POLL_MS - 1);
        expect(router.refresh).not.toHaveBeenCalled();
        expect(startSession).toHaveBeenCalledTimes(1);
        await advanceAsync(1);
        expect(router.refresh).toHaveBeenCalledTimes(1);
        expect(startSession).toHaveBeenCalledTimes(2);
      });

      it("면접 시작이 성공하면 2초가 지나도 다시 요청하지 않는다", async () => {
        render(chatView(null, PREPARED));
        await flushPromises();

        await advanceAsync(SESSION_POLL_MS * 3);

        expect(startSession).toHaveBeenCalledTimes(1);
      });
    });

    describe("정리", () => {
      it("다시 요청을 기다리는 중에 화면을 떠나면 다시 요청하지 않는다", async () => {
        vi.mocked(startSession).mockResolvedValue({ formError: SERVER_ERROR });
        const { unmount } = render(chatView(null, PREPARED));
        await flushPromises();

        unmount();
        await advanceAsync(SESSION_POLL_MS * 3);

        expect(router.refresh).not.toHaveBeenCalled();
        expect(startSession).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe("채팅 질문 준비 실패", () => {
    const planFailedView = () => chatView(null, { status: "READY", planStatus: "FAILED" });

    describe("화면 표시", () => {
      it("질문 준비가 실패했으면 대기 화면 대신 '면접 준비에 실패했어요'와 [다시 시도]를 보인다", () => {
        render(planFailedView());

        const prepare = screen.getByRole("region", { name: "면접 준비" });
        expect(prepare.textContent).toContain("면접 준비에 실패했어요");
        expect(within(prepare).getByRole("button", { name: "다시 시도" })).toBeDefined();
        expect(waitingScreen()).toBeNull();
      });
    });

    describe("사용자 조작", () => {
      it("[다시 시도]를 누르면 질문 준비를 다시 요청한다", async () => {
        render(planFailedView());

        fireEvent.click(retryButton());
        await flushPromises();

        expect(retryPlan).toHaveBeenCalledTimes(1);
      });
    });

    describe("오류 처리", () => {
      it("다시 준비 요청이 실패하면 서버 문구를 알린다", async () => {
        vi.mocked(retryPlan).mockResolvedValue({
          formError: "면접 준비가 실패한 상태가 아니에요.",
        });
        render(planFailedView());

        fireEvent.click(retryButton());
        await flushPromises();

        expect(screen.getByRole("alert").textContent).toBe("면접 준비가 실패한 상태가 아니에요.");
      });

      it("실패 뒤 다시 누르면 이전 실패 문구를 지운다", async () => {
        const second = deferred<Awaited<ReturnType<typeof retryPlan>>>();
        vi.mocked(retryPlan)
          .mockResolvedValueOnce({ formError: "면접 준비가 실패한 상태가 아니에요." })
          .mockReturnValueOnce(second.promise);
        render(planFailedView());
        fireEvent.click(retryButton());
        await flushPromises();

        fireEvent.click(retryButton());
        await flushPromises();

        expect(screen.queryByRole("alert")).toBeNull();
        // 기다리던 요청을 끝내 둔다(끝나지 않은 transition이 다음 테스트의 transition을 붙잡지 않게)
        await act(async () => second.resolve({}));
      });
    });

    describe("중복 · 경쟁 처리", () => {
      it("다시 준비 요청을 기다리는 동안 [다시 시도]를 막는다", async () => {
        const response = deferred<Awaited<ReturnType<typeof retryPlan>>>();
        vi.mocked(retryPlan).mockReturnValue(response.promise);
        render(planFailedView());

        fireEvent.click(retryButton());
        await flushPromises();

        expect(retryButton().disabled).toBe(true);
        // 기다리던 요청을 끝내 둔다(끝나지 않은 transition이 다음 테스트의 transition을 붙잡지 않게)
        await act(async () => response.resolve({}));
      });
    });
  });

  describe("채팅 대기 화면", () => {
    describe("화면 표시", () => {
      it("질문 준비 중인 채팅 면접에 들어오면 대기 화면을 띄운다", () => {
        render(chatView(null, { status: "READY", planStatus: "GENERATING" }));

        expect(waitingScreen()).not.toBeNull();
      });

      it("대기 화면이 떠 있는 동안 뒤쪽 화면을 누르거나 Tab으로 닿지 않게 막는다", () => {
        render(chatView(null, { status: "READY", planStatus: "GENERATING" }));

        expect(screen.getByRole("button", { name: "면접 종료" }).closest("[inert]")).not.toBeNull();
      });

      it("이미 면접 중인 채팅 면접에 새로고침으로 들어오면 대기 화면 없이 면접방에 들어간다", () => {
        render(chatView());

        expect(waitingScreen()).toBeNull();
        expect(room.mounts).toBe(1);
      });
    });

    describe("사용자 조작", () => {
      it("[면접 시작]을 누르면 대기 화면을 닫고 면접방에 들어간다", async () => {
        useInterviewerPreloadStore.setState({ persona: "DEVIL", status: "ready", progress: 1 });
        const { rerender } = render(chatView(null, PREPARED));
        await flushPromises();
        rerender(chatView(QUESTION));

        fireEvent.click(screen.getByRole("button", { name: "면접 시작" }));

        expect(waitingScreen()).toBeNull();
        expect(room.mounts).toBe(1);
      });
    });

    describe("상태 변화", () => {
      it("미리 시작된 뒤에도 [면접 시작]을 누르기 전에는 면접방에 들어가지 않는다", async () => {
        const { rerender } = render(chatView(null, PREPARED));
        await flushPromises();

        rerender(chatView(QUESTION));

        expect(waitingScreen()).not.toBeNull();
        expect(useInterviewRoom).not.toHaveBeenCalled();
      });

      it("대기 화면에서 면접관 연결에 실패하면(START_FAILED) 대기 화면을 닫고 연결 실패 카드를 띄운다", async () => {
        const { rerender } = render(chatView(null, PREPARED));
        await flushPromises();

        rerender(chatView(null, { status: "START_FAILED" }));

        expect(waitingScreen()).toBeNull();
        expect(startFailedCard()).not.toBeNull();
      });
    });
  });

  describe("면접방 입장", () => {
    describe("화면 표시", () => {
      it("채팅 면접관 연결에 실패한 상태(START_FAILED)로 들어오면 면접방에 들어가지 않는다", () => {
        render(chatView(QUESTION, { status: "START_FAILED" }));

        expect(useInterviewRoom).not.toHaveBeenCalled();
      });
    });

    describe("상태 변화", () => {
      it("다시 들어가는 데 성공하면 실패 횟수를 처음부터 센다", () => {
        room.status = "failed";
        const { rerender } = render(chatView());
        advance(CHAT_ROOM_RETRY_MS);
        advance(CHAT_ROOM_RETRY_MS);
        advance(CHAT_ROOM_RETRY_MS);

        room.status = "listening";
        rerender(chatView());
        room.status = "failed";
        rerender(chatView());
        advance(CHAT_ROOM_RETRY_MS);

        expect(room.retry).toHaveBeenCalledTimes(CHAT_ROOM_RETRIES + 1);
      });
    });

    describe("경계값", () => {
      it("채팅 면접방에 연달아 3번 다시 들어가도 실패하면 더 들어가지 않는다", () => {
        room.status = "failed";
        render(chatView());

        advance(CHAT_ROOM_RETRY_MS);
        advance(CHAT_ROOM_RETRY_MS);
        advance(CHAT_ROOM_RETRY_MS);
        expect(room.retry).toHaveBeenCalledTimes(CHAT_ROOM_RETRIES);
        advance(CHAT_ROOM_RETRY_MS * 5);
        expect(room.retry).toHaveBeenCalledTimes(CHAT_ROOM_RETRIES);
      });
    });

    describe("시간 경과", () => {
      it("채팅 면접방 연결이 실패하면 2초 뒤 다시 들어간다", () => {
        room.status = "failed";
        render(chatView());

        advance(CHAT_ROOM_RETRY_MS - 1);
        expect(room.retry).not.toHaveBeenCalled();
        advance(1);
        expect(room.retry).toHaveBeenCalledTimes(1);
      });

      it("채팅 면접방에 연결하는 중이면 2초가 지나도 다시 들어가지 않는다", () => {
        room.status = "connecting";
        render(chatView());

        advance(CHAT_ROOM_RETRY_MS * 3);

        expect(room.retry).not.toHaveBeenCalled();
      });
    });
  });

  describe("채팅 질문 메시지", () => {
    describe("화면 표시", () => {
      it("면접관 질문 메시지를 받으면 5.5보다 먼저 그 질문을 말풍선에 보인다", () => {
        room.question = questionMessage(4, "ended", "메시지로 온 질문");

        render(chatView(null));

        expect(shownQuestion("메시지로 온 질문")).not.toBeNull();
      });

      it("이미 답한 순서 이하의 질문 메시지면 버리고 '생각 중'을 보인다", async () => {
        room.question = questionMessage(3, "ended", "방금 답한 질문");
        render(chatView());

        await answerChat("캐시를 바꿨어요");

        expect(thinking()).not.toBeNull();
        expect(shownQuestion("방금 답한 질문")).toBeNull();
      });

      it("5.5 질문보다 앞선 순서의 질문 메시지면 버리고 5.5 질문을 보인다", () => {
        room.question = questionMessage(2, "ended", "지난 질문");

        render(chatView());

        expect(shownQuestion(QUESTION.content)).not.toBeNull();
        expect(shownQuestion("지난 질문")).toBeNull();
      });

      it("면접관 질문이 5.5 질문보다 뒤면 질문 ID가 있어도 보내기를 막는다", () => {
        room.question = questionMessage(4);
        render(chatView());

        fireEvent.input(answerBox(), { target: { value: "먼저 써 둔 답" } });

        expect(sendButton().disabled).toBe(true);
      });

      it("질문 음성이 나오는 동안에는 보내기를 막는다", () => {
        room.question = questionMessage(3, "started");
        render(chatView());

        fireEvent.input(answerBox(), { target: { value: "먼저 써 둔 답" } });

        expect(sendButton().disabled).toBe(true);
      });
    });

    describe("사용자 조작", () => {
      it("입력 신호는 표시 중인 질문 메시지의 순서로 보낸다", () => {
        room.question = questionMessage(4);
        render(chatView());

        fireEvent.input(answerBox(), { target: { value: "쓰는 중인 답" } });
        advance(CHAT_INPUT_PAUSE_MS);

        expect(room.sendChatInput.mock.lastCall?.[0]).toBe(4);
      });
    });
  });

  describe("채팅 질문 확인 조회", () => {
    describe("시간 경과", () => {
      it("질문 메시지를 기다리는 동안(질문 없음)은 2초마다 한 번씩만 다시 그린다", () => {
        render(chatView(null));

        advance(SESSION_POLL_MS - 1);
        expect(router.refresh).not.toHaveBeenCalled();
        advance(1);
        expect(router.refresh).toHaveBeenCalledTimes(1);
        advance(SESSION_POLL_MS);
        expect(router.refresh).toHaveBeenCalledTimes(2);
      });

      it("질문 메시지가 5.5와 어긋나면 바로 화면을 다시 그린다", () => {
        room.question = questionMessage(4);
        render(chatView());

        advance(0);

        expect(router.refresh).toHaveBeenCalledTimes(1);
      });

      it("다시 그린 뒤에도 어긋나면 1초 뒤 다시 그린다", () => {
        room.question = questionMessage(4);
        render(chatView());
        advance(0);

        advance(QUESTION_RECHECK_MS - 1);
        expect(router.refresh).toHaveBeenCalledTimes(1);
        advance(1);
        expect(router.refresh).toHaveBeenCalledTimes(2);
      });

      it("두 번 넘게 어긋나면 2초마다 다시 그린다", () => {
        room.question = questionMessage(4);
        render(chatView());
        advance(0);
        advance(QUESTION_RECHECK_MS);

        advance(SESSION_POLL_MS - 1);
        expect(router.refresh).toHaveBeenCalledTimes(2);
        advance(1);
        expect(router.refresh).toHaveBeenCalledTimes(3);
      });

      it("다른 순서의 질문 메시지가 오면 확인 횟수를 처음부터 센다", () => {
        room.question = questionMessage(4);
        const { rerender } = render(chatView());
        advance(0);
        advance(QUESTION_RECHECK_MS);

        room.question = questionMessage(5);
        rerender(chatView());
        advance(0);

        expect(router.refresh).toHaveBeenCalledTimes(3);
      });

      it("질문 메시지와 5.5가 같으면 다시 그리지 않는다", () => {
        room.question = questionMessage(3);
        render(chatView());

        advance(SESSION_POLL_MS * 3);

        expect(router.refresh).not.toHaveBeenCalled();
      });

      it("인터넷이 끊기면 질문이 어긋나도 다시 그리지 않는다", () => {
        goOffline();
        room.question = questionMessage(4);
        render(chatView());

        advance(SESSION_POLL_MS * 3);

        expect(router.refresh).not.toHaveBeenCalled();
      });
    });
  });

  describe("채팅 [답변 완료] 전송", () => {
    describe("사용자 조작", () => {
      it("답변이 저장되면 그 질문 순서와 글로 에이전트에 [답변 완료]를 보낸다", async () => {
        render(chatView());

        await answerChat("캐시를 바꿨어요");

        expect(room.submitAnswer).toHaveBeenCalledExactlyOnceWith(3, "캐시를 바꿨어요");
      });
    });

    describe("오류 처리", () => {
      it("에이전트가 거절하면 다시 보내지 않는다", async () => {
        room.submitAnswer.mockResolvedValue("rejected");
        render(chatView());
        await answerChat("캐시를 바꿨어요");

        await advanceAsync(CHAT_ROOM_RETRY_MS * 3);

        expect(room.submitAnswer).toHaveBeenCalledTimes(1);
      });
    });

    describe("중복 · 경쟁 처리", () => {
      it("지난 질문의 늦은 결과가 다음 질문의 다시 보내기를 지우지 않는다", async () => {
        const oldResult = deferred<SubmitAnswerResult>();
        room.submitAnswer
          .mockReturnValueOnce(oldResult.promise)
          .mockResolvedValueOnce("failed")
          .mockResolvedValue("accepted");
        const { rerender } = render(chatView());
        await answerChat("3번 답");
        rerender(chatView(NEXT));
        await answerChat("4번 답");

        await act(async () => oldResult.resolve("rejected"));
        await advanceAsync(CHAT_ROOM_RETRY_MS);

        expect(room.submitAnswer).toHaveBeenCalledTimes(3);
        expect(room.submitAnswer).toHaveBeenLastCalledWith(4, "4번 답");
      });
    });

    describe("시간 경과", () => {
      it("[답변 완료]를 보내지 못하면 2초마다 같은 글로 다시 보낸다", async () => {
        room.submitAnswer.mockResolvedValue("failed");
        render(chatView());
        await answerChat("캐시를 바꿨어요");

        await advanceAsync(CHAT_ROOM_RETRY_MS - 1);
        expect(room.submitAnswer).toHaveBeenCalledTimes(1);
        await advanceAsync(1);
        expect(room.submitAnswer).toHaveBeenCalledTimes(2);
        await advanceAsync(CHAT_ROOM_RETRY_MS);
        expect(room.submitAnswer).toHaveBeenCalledTimes(3);
        expect(room.submitAnswer).toHaveBeenLastCalledWith(3, "캐시를 바꿨어요");
      });
    });

    describe("정리", () => {
      it("다시 보내기를 기다리는 중에 화면을 떠나면 보내지 않는다", async () => {
        room.submitAnswer.mockResolvedValue("failed");
        const { unmount } = render(chatView());
        await answerChat("캐시를 바꿨어요");

        unmount();
        await advanceAsync(CHAT_ROOM_RETRY_MS * 3);

        expect(room.submitAnswer).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe("화상 [답변 완료]", () => {
    describe("화면 표시", () => {
      it("질문이 있고 내 답변 자막이 있으면 [답변 완료]를 누를 수 있다", () => {
        room.streamId = "capture-1";
        room.confirmedText = "저는";

        render(view());

        expect(submitButton().disabled).toBe(false);
      });

      it("질문 음성이 나오는 동안에는 [답변 완료]를 막는다", () => {
        room.streamId = "capture-1";
        room.confirmedText = "저는";
        room.question = questionMessage(3, "started");

        render(view());

        expect(submitButton().disabled).toBe(true);
      });
    });

    describe("사용자 조작", () => {
      it("[답변 완료]를 누르면 5.5 질문 순서로 답변 제출을 요청한다", async () => {
        room.streamId = "capture-1";
        room.confirmedText = "저는";
        render(view());

        await pressSubmit();

        expect(room.submitAnswer).toHaveBeenCalledExactlyOnceWith(3);
      });
    });

    describe("상태 변화", () => {
      it("제출이 받아들여지면 내는 중이 되어 [답변 완료]를 막는다", async () => {
        room.streamId = "capture-1";
        room.confirmedText = "저는";
        render(view());

        await pressSubmit();

        expect(submitButton().disabled).toBe(true);
      });
    });

    describe("입력 검증", () => {
      it("질문이 없으면(다음 질문 기다리는 중) 자막이 있어도 [답변 완료]를 막는다", () => {
        room.streamId = "capture-1";
        room.confirmedText = "저는";

        render(view(null));

        expect(submitButton().disabled).toBe(true);
      });

      it("내 답변 자막이 공백뿐이면 [답변 완료]를 막는다", () => {
        room.streamId = "capture-1";
        room.confirmedText = " ";
        room.interimText = "  ";

        render(view());

        expect(submitButton().disabled).toBe(true);
      });

      it("면접관이 말하는 질문이 5.5와 다르면 [답변 완료]를 막는다", () => {
        room.streamId = "capture-1";
        room.confirmedText = "저는";
        room.question = questionMessage(4);

        render(view());

        expect(submitButton().disabled).toBe(true);
      });
    });

    describe("오류 처리", () => {
      it("제출이 거절되면 [답변 완료]를 다시 누를 수 있다", async () => {
        room.streamId = "capture-1";
        room.confirmedText = "저는";
        room.submitAnswer.mockResolvedValue("rejected");
        render(view());

        await pressSubmit();

        expect(submitButton().disabled).toBe(false);
      });
    });

    describe("중복 · 경쟁 처리", () => {
      it("제출 응답을 기다리는 동안 [답변 완료]를 막아 한 번만 요청한다", async () => {
        room.streamId = "capture-1";
        room.confirmedText = "저는";
        const response = deferred<SubmitAnswerResult>();
        room.submitAnswer.mockReturnValue(response.promise);
        render(view());

        await pressSubmit();
        await pressSubmit();

        expect(submitButton().disabled).toBe(true);
        expect(room.submitAnswer).toHaveBeenCalledTimes(1);
        await act(async () => response.resolve("accepted"));
      });
    });
  });

  describe("화상 답변 상태 메시지", () => {
    describe("화면 표시", () => {
      it.each([
        { state: "sttFailed", text: "음성 인식이 끊겼어요" },
        { state: "sttReconnecting", text: "음성 인식을 다시 연결하는 중…" },
        { state: "timedOut", text: "답변을 기다리고 있어요. 말씀을 시작해 주세요" },
      ] as const)("답변 상태가 '$state'이면 '$text'를 알린다", ({ state, text }) => {
        room.streamId = "capture-1";
        render(view());

        answerState(3, state);

        expect(screen.getByText(text)).toBeDefined();
      });

      it("자막 스트림이 음성 인식 실패를 알리면 '음성 인식이 끊겼어요'를 알린다", () => {
        room.status = "sttFailed";

        render(view());

        expect(screen.getByText("음성 인식이 끊겼어요")).toBeDefined();
      });

      it("제출 실패(submitFailed)를 받으면 '답변을 저장하지 못했어요'와 [다시 시도]를 보인다", () => {
        render(view());

        answerState(3, "submitFailed");

        const alert = screen.getByRole("alert");
        expect(within(alert).getByText("답변을 저장하지 못했어요")).toBeDefined();
        expect(within(alert).getByRole("button", { name: "다시 시도" })).toBeDefined();
      });

      it("마지막 답변 저장 중이면 다른 알림보다 '답변을 저장하는 중이에요'를 먼저 보인다", () => {
        room.status = "sttFailed";
        render(view(LAST, { answeredCount: 4 }));

        answerState(5, "submitted");

        expect(screen.getByText("답변을 저장하는 중이에요")).toBeDefined();
        expect(screen.queryByText("음성 인식이 끊겼어요")).toBeNull();
      });
    });

    describe("상태 변화", () => {
      it("자동 제출(autoSubmitted)을 받으면 내는 중이 되어 [답변 완료]를 막는다", () => {
        room.streamId = "capture-1";
        room.confirmedText = "저는";
        render(view());

        answerState(3, "autoSubmitted");

        expect(submitButton().disabled).toBe(true);
      });

      it("제출됨(submitted)을 받으면 면접관이 생각 중이 된다", () => {
        render(view());

        answerState(3, "submitted");

        expect(thinking()).not.toBeNull();
      });

      it("제출됨을 받으면 면접관이 말한 그 질문 메시지도 내리고 '생각 중'을 보인다", () => {
        room.question = questionMessage(3, "ended", "방금 답한 질문");
        render(view());

        answerState(3, "submitted");

        expect(thinking()).not.toBeNull();
        expect(shownQuestion("방금 답한 질문")).toBeNull();
      });

      it("제출됨(submitted)을 받으면 지난 답변 자막을 감춘다", () => {
        room.streamId = "capture-1";
        room.confirmedText = "캐시를 바꿨어요";
        render(view());

        answerState(3, "submitted");

        expect(caption().textContent).not.toContain("캐시를 바꿨어요");
      });

      it("낸 뒤 새 자막 캡처가 열리면 자막을 다시 보이고 다시 낼 수 있다", () => {
        room.streamId = "capture-1";
        room.confirmedText = "음";
        const { rerender } = render(view());
        answerState(3, "autoSubmitted");

        room.streamId = "capture-2";
        room.confirmedText = "다시 말한 답";
        rerender(view());

        expect(caption().textContent).toContain("다시 말한 답");
        expect(submitButton().disabled).toBe(false);
      });

      it("내는 중에 다음 질문(5.5)이 오면 내는 중을 풀고 그 질문을 보인다", () => {
        room.streamId = "capture-1";
        room.confirmedText = "저는";
        const { rerender } = render(view());
        answerState(3, "autoSubmitted");

        rerender(view(NEXT));
        advance(SESSION_POLL_MS * 3);

        expect(shownQuestion(NEXT.content)).not.toBeNull();
        expect(router.refresh).not.toHaveBeenCalled();
      });

      it("면접관이 다음 질문으로 넘어가면 지난 질문의 답변 상태 안내를 내린다", () => {
        const { rerender } = render(view());
        answerState(3, "timedOut");

        room.question = questionMessage(4, "started");
        rerender(view());

        expect(screen.queryByText("답변을 기다리고 있어요. 말씀을 시작해 주세요")).toBeNull();
      });

      it("무응답 안내 중에 말을 시작하면 안내를 내린다", () => {
        room.streamId = "capture-1";
        const { rerender } = render(view());
        answerState(3, "timedOut");

        room.interimText = "답변 시작";
        rerender(view());

        expect(screen.queryByText("답변을 기다리고 있어요. 말씀을 시작해 주세요")).toBeNull();
      });
    });

    describe("입력 검증", () => {
      it("지금 질문이 아닌 순서의 답변 상태는 무시한다", () => {
        render(view());

        answerState(2, "submitted");

        expect(useInterviewStore.getState()).toMatchObject({
          answeredQuestionId: null,
          submittedSeq: null,
        });
      });
    });

    describe("오류 처리", () => {
      it("제출 실패한 질문은 자막이 없어도 [다시 시도]로 다시 낼 수 있다", async () => {
        render(view());
        answerState(3, "submitFailed");

        fireEvent.click(retryButton());
        await flushPromises();

        expect(room.submitAnswer).toHaveBeenCalledExactlyOnceWith(3);
      });

      it("[다시 시도]가 받아들여지면 실패 안내를 내린다", async () => {
        render(view());
        answerState(3, "submitFailed");

        fireEvent.click(retryButton());
        await flushPromises();

        expect(screen.queryByText("답변을 저장하지 못했어요")).toBeNull();
      });
    });
  });

  describe("화상 다음 질문 확인 조회", () => {
    describe("중복 · 경쟁 처리", () => {
      it("[끝내기] 뒤 저장을 기다리는 동안에는 내는 중이어도 2초에 한 번만 다시 그린다", () => {
        room.streamId = "capture-1";
        room.confirmedText = "저는";
        render(view());
        answerState(3, "autoSubmitted");

        act(() => useInterviewStore.getState().setConfirmingSave(true));
        advance(SESSION_POLL_MS);

        expect(router.refresh).toHaveBeenCalledTimes(1);
      });
    });

    describe("시간 경과", () => {
      it("답변을 내는 중이면 2초마다 화면을 다시 그려 다음 질문을 확인한다", () => {
        room.streamId = "capture-1";
        room.confirmedText = "저는";
        render(view());
        answerState(3, "autoSubmitted");

        advance(SESSION_POLL_MS - 1);
        expect(router.refresh).not.toHaveBeenCalled();
        advance(1);
        expect(router.refresh).toHaveBeenCalledTimes(1);
        advance(SESSION_POLL_MS);
        expect(router.refresh).toHaveBeenCalledTimes(2);
      });

      it("면접관이 5.5보다 뒤 질문을 말하면 2초마다 다시 그린다", () => {
        room.question = questionMessage(4);
        render(view());

        advance(SESSION_POLL_MS);
        expect(router.refresh).toHaveBeenCalledTimes(1);
        advance(SESSION_POLL_MS);
        expect(router.refresh).toHaveBeenCalledTimes(2);
      });

      it("면접관이 5.5와 같은 질문을 말하면 다시 그리지 않는다", () => {
        room.question = questionMessage(3);
        render(view());

        advance(SESSION_POLL_MS * 3);

        expect(router.refresh).not.toHaveBeenCalled();
      });

      it("내는 중이어도 인터넷이 끊기면 다시 그리지 않는다", () => {
        goOffline();
        room.streamId = "capture-1";
        room.confirmedText = "저는";
        render(view());
        answerState(3, "autoSubmitted");

        advance(SESSION_POLL_MS * 3);

        expect(router.refresh).not.toHaveBeenCalled();
      });
    });
  });

  describe("화상 마이크 안내", () => {
    describe("사용자 조작", () => {
      it("마이크 안내의 [마이크 확인]을 누르면 마이크 확인 모달을 연다", () => {
        media.level = motionValue(0);
        render(view());
        advance(SILENT_TOAST_MS);

        fireEvent.click(screen.getByRole("button", { name: "마이크 확인" }));

        expect(screen.getByRole("dialog", { name: "마이크 확인" })).toBeDefined();
      });
    });

    describe("시간 경과", () => {
      it.each([
        {
          label: "질문 음성 중",
          question: QUESTION,
          arrange: () => {
            room.question = questionMessage(3, "started");
          },
          afterRender: () => {},
        },
        {
          label: "답변 내는 중",
          question: QUESTION,
          arrange: () => {
            room.streamId = "capture-1";
            room.confirmedText = "저는";
          },
          afterRender: () => answerState(3, "autoSubmitted"),
        },
        {
          label: "다음 질문 기다리는 중",
          question: null,
          arrange: () => {},
          afterRender: () => {},
        },
      ])(
        "'$label'이면 소리가 10초 넘게 없어도 마이크 안내를 띄우지 않는다",
        ({ question, arrange, afterRender }) => {
          media.level = motionValue(0);
          arrange();
          render(view(question));
          afterRender();

          advance(SILENT_TOAST_MS * 2);

          expect(screen.queryByText(MIC_TOAST)).toBeNull();
        },
      );
    });
  });

  describe("화상 마지막 답변 자동 종료", () => {
    describe("상태 변화", () => {
      it("5.2로 답변 5개가 저장된 것이 보이면 면접을 끝낸다", async () => {
        const { rerender } = render(view(LAST, { answeredCount: 4 }));
        await flushPromises();
        expect(endSession).not.toHaveBeenCalled();

        rerender(view(null, { answeredCount: 5 }));
        await flushPromises();

        expect(endSession).toHaveBeenCalledTimes(1);
      });

      it("끝낼 때 면접 동안 잰 시선 비율을 보낸다", async () => {
        const frames = Array<GazeFrame>(MIN_GAZE_SAMPLES).fill(FRONT);
        useGazeStore.setState({ frames });

        render(view(null, { answeredCount: 5 }));
        await flushPromises();

        expect(vi.mocked(endSession).mock.lastCall?.[2]).toBe(gazeRatio(frames));
      });

      it("끝내기가 성공하면 레벨업을 기억한다", async () => {
        vi.mocked(endSession).mockResolvedValue({ leveledUp: true });

        render(view(null, { answeredCount: 5 }));
        await flushPromises();

        expect(useInterviewStore.getState().leveledUp).toBe(true);
      });
    });

    describe("경계값", () => {
      it("마지막이 아닌(4번째) 답변이 제출되면 저장 중 안내도 끝내기도 하지 않는다", async () => {
        render(view(NEXT, { answeredCount: 3 }));

        answerState(4, "submitted");
        await advanceAsync(SAVE_WAIT_MS);

        expect(screen.queryByText("답변을 저장하는 중이에요")).toBeNull();
        expect(endSession).not.toHaveBeenCalled();
      });
    });

    describe("오류 처리", () => {
      it("서버가 실패로 답했으면(keySpent) 새 멱등 키로 다시 끝낸다", async () => {
        vi.mocked(endSession)
          .mockResolvedValueOnce({ formError: SERVER_ERROR, keySpent: true })
          .mockResolvedValue({});
        render(view(null, { answeredCount: 5 }));
        await flushPromises();

        await advanceAsync(SESSION_POLL_MS);

        const [first, second] = vi.mocked(endSession).mock.calls;
        expect(second[1]).not.toBe(first[1]);
      });

      it("응답 없이 실패했으면 같은 멱등 키 · 같은 시선 비율로 다시 끝낸다", async () => {
        const looking = Array<GazeFrame>(MIN_GAZE_SAMPLES).fill(FRONT);
        useGazeStore.setState({ frames: looking });
        vi.mocked(endSession)
          .mockResolvedValueOnce({ formError: SERVER_ERROR })
          .mockResolvedValue({});
        render(view(null, { answeredCount: 5 }));
        await flushPromises();
        useGazeStore.setState({
          frames: [...looking, ...Array<GazeFrame>(MIN_GAZE_SAMPLES).fill(null)],
        });

        await advanceAsync(SESSION_POLL_MS);

        const [first, second] = vi.mocked(endSession).mock.calls;
        expect(second[1]).toBe(first[1]);
        expect(second[2]).toBe(first[2]);
      });
    });

    describe("중복 · 경쟁 처리", () => {
      it("개발 모드(StrictMode)에서 효과가 두 번 돌아도 끝내기를 한 번만 요청한다", async () => {
        render(view(null, { answeredCount: 5 }), { reactStrictMode: true });
        await flushPromises();

        expect(endSession).toHaveBeenCalledTimes(1);
      });

      it("마지막 답변을 기다리는 중 [면접 종료] · [끝내기]를 눌러도 끝내기는 한 번만 요청한다", async () => {
        render(view(LAST, { answeredCount: 4 }));
        answerState(5, "submitted");

        fireEvent.click(screen.getByRole("button", { name: "면접 종료" }));
        fireEvent.click(screen.getByRole("button", { name: "끝내기" }));
        await flushPromises();
        await advanceAsync(SAVE_WAIT_MS);

        expect(endSession).toHaveBeenCalledTimes(1);
      });
    });

    describe("시간 경과", () => {
      it("마지막 답변이 제출되고 10초가 지나도 저장이 보이지 않으면 그대로 끝낸다", async () => {
        render(view(LAST, { answeredCount: 4 }));
        answerState(5, "submitted");

        await advanceAsync(SAVE_WAIT_MS - 1);
        expect(endSession).not.toHaveBeenCalled();
        await advanceAsync(1);
        expect(endSession).toHaveBeenCalledTimes(1);
      });

      it("끝내기가 실패하면 2초 뒤 다시 끝낸다", async () => {
        vi.mocked(endSession).mockResolvedValue({ formError: SERVER_ERROR });
        render(view(null, { answeredCount: 5 }));
        await flushPromises();

        await advanceAsync(SESSION_POLL_MS - 1);
        expect(endSession).toHaveBeenCalledTimes(1);
        await advanceAsync(1);
        expect(endSession).toHaveBeenCalledTimes(2);
      });
    });
  });

  describe("연결 끊김", () => {
    describe("화면 표시", () => {
      it("화면을 숨긴 동안에도 재연결 배너는 보인다", () => {
        room.status = "reconnecting";
        render(view());

        act(() => useInterviewStore.getState().toggleUiHidden());

        expect(hiddenBox(caption())).not.toBeNull();
        const shown = banner();
        expect(shown).not.toBeNull();
        expect(hiddenBox(shown!)).toBeNull();
      });
    });

    describe("사용자 조작", () => {
      it("'잠시 멈춤'의 [면접 끝내기]를 누르면 카드를 닫고 종료 확인 모달을 연다", () => {
        room.status = "failed";
        render(view());

        fireEvent.click(screen.getByRole("button", { name: "면접 끝내기" }));

        expect(pausedCard()).toBeNull();
        expect(screen.getByRole("dialog", { name: "면접을 끝낼까요?" })).toBeDefined();
      });
    });

    describe("상태 변화", () => {
      it("다시 잇기를 포기하면(failed) 기다리지 않고 '잠시 멈춤'을 띄운다", () => {
        room.status = "failed";

        render(view());

        expect(pausedCard()).not.toBeNull();
      });

      it("다시 잇기를 포기하면(failed) 면접 상태를 확인하려 화면을 한 번 다시 그린다", () => {
        room.status = "failed";

        render(view());

        expect(router.refresh).toHaveBeenCalledTimes(1);
      });

      it.each<{
        label: string;
        question: CurrentQuestion | null;
        session: Partial<SessionResponse>;
        before: () => Promise<void>;
      }>([
        {
          label: "면접이 끝난 뒤",
          question: null,
          session: { status: "FAILED" },
          before: async () => {},
        },
        {
          label: "답변 5개 저장돼 끝내는 중",
          question: null,
          session: { answeredCount: 5 },
          before: async () => {},
        },
        {
          label: "마지막 답변 10초 기다린 뒤 끝내는 중",
          question: LAST,
          session: { answeredCount: 4 },
          before: async () => {
            answerState(5, "submitted");
            await advanceAsync(SAVE_WAIT_MS);
          },
        },
      ])(
        "'$label'이면 끊겨도 '잠시 멈춤'을 띄우지 않는다",
        async ({ question, session, before }) => {
          const { rerender } = render(view(question, session));
          await before();

          room.status = "failed";
          rerender(view(question, session));

          expect(pausedCard()).toBeNull();
        },
      );

      it("끝낸 뒤(끊김을 보지 않을 때)에는 다시 연결 중이어도 재연결 배너를 띄우지 않는다", () => {
        room.status = "reconnecting";

        render(view(null, { status: "FAILED" }));

        expect(banner()).toBeNull();
      });
    });

    describe("경계값", () => {
      it("다시 연결이 5초가 되면 배너 대신 '잠시 멈춤'을 띄운다", () => {
        room.status = "reconnecting";
        render(view());

        advance(PAUSE_AFTER_MS - 1000);
        expect(banner()).not.toBeNull();
        expect(pausedCard()).toBeNull();
        advance(1000);
        expect(banner()).toBeNull();
        expect(pausedCard()).not.toBeNull();
      });
    });
  });

  describe("면접관 연결 실패", () => {
    describe("화면 표시", () => {
      it("5.2가 START_FAILED면 '면접관을 연결하지 못했어요'를 띄운다", () => {
        render(startFailedView());

        expect(startFailedCard()).not.toBeNull();
      });
    });

    describe("사용자 조작", () => {
      it("[나가기]를 누르면 홈으로 이동한다", () => {
        render(startFailedView());

        fireEvent.click(screen.getByRole("button", { name: "나가기" }));

        expect(router.push).toHaveBeenCalledExactlyOnceWith(ROUTES.home);
      });

      it("기다린 뒤 [다시 시작]을 누르면 면접 시작을 요청한다", async () => {
        render(startFailedView());

        await restartAfterWait();

        expect(startSession).toHaveBeenCalledTimes(1);
      });

      it("다시 시작이 성공하면 면접방에 처음부터 다시 들어간다", async () => {
        render(startFailedView());
        expect(room.mounts).toBe(1);

        await restartAfterWait();

        expect(room.mounts).toBe(2);
      });
    });

    describe("오류 처리", () => {
      it("다시 시작이 실패하면 서버 문구를 보인다", async () => {
        vi.mocked(startSession).mockResolvedValue({ formError: "다시 시작하지 못했어요" });
        render(startFailedView());

        await restartAfterWait();

        expect(startFailedCard()?.textContent).toContain("다시 시작하지 못했어요");
      });

      it("서버가 실패로 답했으면(keySpent) 다음 다시 시작은 새 키로 요청한다", async () => {
        vi.mocked(startSession).mockResolvedValue({ formError: SERVER_ERROR, keySpent: true });
        render(startFailedView());
        await restartAfterWait();

        fireEvent.click(screen.getByRole("button", { name: "다시 시작" }));
        await flushPromises();

        const [first, second] = startKeys();
        expect(second).not.toBe(first);
      });

      it("응답 없이 실패했으면 다음 다시 시작은 같은 키로 요청한다", async () => {
        vi.mocked(startSession).mockResolvedValue({ formError: SERVER_ERROR });
        render(startFailedView());
        await restartAfterWait();

        fireEvent.click(screen.getByRole("button", { name: "다시 시작" }));
        await flushPromises();

        const [first, second] = startKeys();
        expect(second).toBe(first);
      });

      it("다시 시작이 성공한 뒤 다시 실패하면 다음 다시 시작은 새 키로 요청한다", async () => {
        const { rerender } = render(startFailedView());
        await restartAfterWait();
        rerender(view());
        rerender(startFailedView());

        await restartAfterWait();

        const [first, second] = startKeys();
        expect(second).not.toBe(first);
      });

      it("다시 누르면 이전 실패 문구를 지운다", async () => {
        const second = deferred<Awaited<ReturnType<typeof startSession>>>();
        vi.mocked(startSession)
          .mockResolvedValueOnce({ formError: "다시 시작하지 못했어요" })
          .mockReturnValueOnce(second.promise);
        render(startFailedView());
        await restartAfterWait();

        fireEvent.click(screen.getByRole("button", { name: "다시 시작" }));
        await flushPromises();

        expect(startFailedCard()?.textContent).not.toContain("다시 시작하지 못했어요");
        // 기다리던 요청을 끝내 둔다(끝나지 않은 transition이 다음 테스트의 transition을 붙잡지 않게)
        await act(async () => second.resolve({}));
      });
    });

    describe("중복 · 경쟁 처리", () => {
      it("다시 시작을 기다리는 동안 [나가기] · [다시 시작]을 막는다", async () => {
        const response = deferred<Awaited<ReturnType<typeof startSession>>>();
        vi.mocked(startSession).mockReturnValue(response.promise);
        render(startFailedView());

        await restartAfterWait();

        expect(screen.getByRole<HTMLButtonElement>("button", { name: "나가기" }).disabled).toBe(
          true,
        );
        expect(screen.getByRole<HTMLButtonElement>("button", { name: "다시 시작" }).disabled).toBe(
          true,
        );
        // 기다리던 요청을 끝내 둔다(끝나지 않은 transition이 다음 테스트의 transition을 붙잡지 않게)
        await act(async () => response.resolve({}));
      });
    });
  });

  describe("화면 숨기기", () => {
    describe("화면 표시", () => {
      it("화상에서 화면을 숨기면 내 카메라 · 면접 태도 · 질문 · 내 답변 · 마이크 안내를 숨긴다", () => {
        media.level = motionValue(0);
        render(view());
        advance(SILENT_TOAST_MS);

        fireEvent.click(screen.getByRole("button", { name: "화면 숨기기" }));

        expect(hiddenBox(screen.getByText("나", { exact: true }))).not.toBeNull();
        expect(hiddenBox(screen.getByRole("region", { name: "면접 태도" }))).not.toBeNull();
        expect(hiddenBox(screen.getByRole("region", { name: "악마 면접관 질문" }))).not.toBeNull();
        expect(hiddenBox(caption())).not.toBeNull();
        expect(hiddenBox(screen.getByText(MIC_TOAST))).not.toBeNull();
      });

      it("채팅에서 화면을 숨기면 질문 · 답변 입력을 숨긴다", () => {
        render(chatView());

        fireEvent.click(screen.getByRole("button", { name: "화면 숨기기" }));

        expect(hiddenBox(screen.getByRole("region", { name: "악마 면접관 질문" }))).not.toBeNull();
        expect(hiddenBox(answerBox())).not.toBeNull();
      });
    });
  });

  describe("면접 태도", () => {
    describe("화면 표시", () => {
      it("채팅이면 카메라로 재는 면접 태도를 그리지 않는다", () => {
        render(chatView());

        expect(screen.queryByRole("region", { name: "면접 태도" })).toBeNull();
      });
    });
  });

  describe("면접관 장면 · 리액션", () => {
    describe("화면 표시", () => {
      it("면접관이 질문을 말하는 중이면 장면을 말하는 중으로 둔다", () => {
        render(view());

        present({ question: questionMessage(3, "started"), reaction: null, listening: null });

        expect(stageProps()?.speaking).toBe(true);
      });

      it("지금 질문의 끼어들기 리액션이면 그 문구를 보인다", () => {
        room.reaction = interruptReaction(3);

        render(view());

        expect(screen.getByText(INTERRUPT)).toBeDefined();
      });

      it("지난 질문의 끼어들기 리액션이면 문구를 보이지 않는다", () => {
        room.reaction = interruptReaction(2);

        render(view());

        expect(screen.queryByText(INTERRUPT)).toBeNull();
      });
    });
  });

  describe("오리 면접관 소리", () => {
    const DUCK = { persona: "DUCK" } as const;

    describe("화면 표시", () => {
      it("오리 면접관이면 면접하는 동안 배경음을 켠다", () => {
        render(view(QUESTION, DUCK));

        expect(vi.mocked(useDuckAmbience).mock.lastCall).toEqual([true]);
      });

      it("오리가 아닌 면접관이면 배경음을 켜지 않는다", () => {
        render(view());

        expect(vi.mocked(useDuckAmbience).mock.lastCall).toEqual([false]);
      });

      it.each([
        { mode: "화상", session: DUCK },
        { mode: "채팅", session: { ...DUCK, mode: "CHAT" } },
      ] as const)("'$mode' 면접의 오리 면접관이면 감탄 소리를 미리 받아 둔다", ({ session }) => {
        render(view(QUESTION, session));

        expect(preloadDuckCall).toHaveBeenCalled();
      });

      it.each([
        { mode: "화상", session: {} },
        { mode: "채팅", session: { mode: "CHAT" } },
      ] as const)(
        "'$mode' 면접의 오리가 아닌 면접관이면 감탄 소리를 미리 받지 않는다",
        ({ session }) => {
          render(view(QUESTION, session));

          expect(preloadDuckCall).not.toHaveBeenCalled();
        },
      );
    });

    describe("사용자 조작", () => {
      it("화상에서 [답변 완료]가 받아들여지면 오리 면접관이 감탄 소리를 내고 놀란다", async () => {
        room.streamId = "capture-1";
        room.confirmedText = "저는";
        render(view(QUESTION, DUCK));

        await pressSubmit();

        expect(playDuckCall).toHaveBeenCalledTimes(1);
        expect(useInterviewStore.getState().exclaimedAt).not.toBeNull();
      });

      it("화상에서 [다시 시도]로 낼 때는 감탄 소리를 내지 않는다", async () => {
        render(view(QUESTION, DUCK));
        answerState(3, "submitFailed");

        fireEvent.click(retryButton());
        await flushPromises();

        expect(room.submitAnswer).toHaveBeenCalledTimes(1);
        expect(playDuckCall).not.toHaveBeenCalled();
      });

      it("채팅에서 답변을 내기 시작하면 오리 면접관이 감탄 소리를 내고 놀란다", async () => {
        render(chatView(QUESTION, DUCK));

        await answerChat("캐시를 바꿨어요");

        expect(playDuckCall).toHaveBeenCalledTimes(1);
        expect(useInterviewStore.getState().exclaimedAt).not.toBeNull();
      });

      it.each([
        {
          mode: "화상",
          answer: async () => {
            room.streamId = "capture-1";
            room.confirmedText = "저는";
            render(view());
            await pressSubmit();
          },
        },
        {
          mode: "채팅",
          answer: async () => {
            render(chatView());
            await answerChat("캐시를 바꿨어요");
          },
        },
      ])(
        "'$mode' 면접에서 오리가 아닌 면접관이면 답변을 내도 감탄 소리를 내지 않는다",
        async ({ answer }) => {
          await answer();

          expect(room.submitAnswer).toHaveBeenCalledTimes(1);
          expect(playDuckCall).not.toHaveBeenCalled();
        },
      );
    });

    describe("상태 변화", () => {
      it("결과 분석으로 넘어가면 배경음을 끈다", () => {
        const { rerender } = render(view(QUESTION, DUCK));

        rerender(view(null, { ...DUCK, status: "ANALYZING" }));

        expect(vi.mocked(useDuckAmbience).mock.lastCall).toEqual([false]);
      });

      it("화상에서 자동 제출을 받으면 오리 면접관이 감탄 소리를 낸다", () => {
        room.streamId = "capture-1";
        room.confirmedText = "저는";
        render(view(QUESTION, DUCK));

        answerState(3, "autoSubmitted");

        expect(playDuckCall).toHaveBeenCalledTimes(1);
      });
    });
  });
});
