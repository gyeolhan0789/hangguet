// 기준: API 명세 10.10 그룹 세션의 기존 API 규칙(5.8 내 면접만 끝냄 · 그룹 채팅은 answer.submit을 보내지 않음) · 10.11 그룹 면접방 정보
// (DONE이면 5.8 · 차례가 아니면 '마이크를 꺼 주세요') · BE Swagger 10.8 연장(화상 · 지금 답변자 · 남은 30초 이하 · 한 번)
// · 10.9 작성 중인 답변 저장(0.8초 멈춤마다 최소 5초 간격 · 창을 벗어날 때 · sessionStorage 복구)
// · 사용자 결정(2026-11-13, 빈칸 기본안: 단계 문구 · 내 차례에 마이크를 다시 켬 · 채팅은 내 차례가 아니면 입력 잠금)
import { act, fireEvent, render, screen } from "@testing-library/react";
import { motionValue, type MotionValue } from "motion/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  useInterviewRoom,
  type InterviewRoomStatus,
  type SubmitAnswerResult,
} from "@/components/interview/use-interview-room";
import { extendTurn, saveAnswerDraft } from "@/lib/group/actions";
import { endSession, submitTextAnswer } from "@/lib/interview/actions";
import type { AnswerStateMessage, RoomInfoSnapshot } from "@/lib/interview/room-messages";
import { flushPromises } from "@/test/flush";
import { router } from "@/test/next-navigation";
import type {
  CurrentQuestion,
  GroupPhase,
  ParticipantResponse,
  SessionResponse,
} from "@/types/api";

import { GroupInterviewRoom } from "./group-room";

// 경계 mock: 면접방(LiveKit)을 감싸는 우리 훅(use-interview-room.test.ts가 따로 본다). 테스트가 방 정보 · 상태 · 자막을 정한다
const room = vi.hoisted(() => ({
  status: "listening" as InterviewRoomStatus,
  roomInfo: null as RoomInfoSnapshot | null,
  confirmedText: "",
  submitAnswer: vi.fn(async (): Promise<SubmitAnswerResult> => "accepted"),
  sendChatInput: vi.fn(),
}));
vi.mock("@/components/interview/use-interview-room", () => ({
  useInterviewRoom: vi.fn(() => ({
    status: room.status,
    streamId: "stream-1",
    confirmedText: room.confirmedText,
    interimText: "",
    question: null,
    reaction: null,
    attitude: [],
    roomInfo: room.roomInfo,
    retry: vi.fn(),
    submitAnswer: room.submitAnswer,
    sendChatInput: room.sendChatInput,
    sendFrame: vi.fn(),
    pauseMicrophone: vi.fn(),
  })),
}));
// 경계 mock: 서버 액션(5.7 · 5.8 · 10.8 · 10.9) · 3D 장면 · 시선 측정 · 카메라 · 마이크 · 오디오 · 화면 이동 · 연출
vi.mock("@/lib/interview/actions", () => ({
  endSession: vi.fn(),
  retryPlan: vi.fn(),
  startSession: vi.fn(),
  submitTextAnswer: vi.fn(),
}));
vi.mock("@/lib/group/actions", () => ({
  extendTurn: vi.fn(),
  saveAnswerDraft: vi.fn(),
}));
vi.mock("@/components/interview/interviewer-stage", () => ({
  InterviewerStage: vi.fn(() => null),
}));
vi.mock("@/components/interview/use-gaze-tracker", () => ({ useGazeTracker: vi.fn() }));
const media = vi.hoisted(() => ({
  level: null as MotionValue<number> | null,
  stream: null as MediaStream | null,
}));
vi.mock("./use-interview-media", () => ({
  useInterviewMedia: vi.fn(() => ({
    stream: media.stream,
    level: media.level,
    unavailable: false,
  })),
}));
vi.mock("@/lib/interview/duck-ambience", () => ({ useDuckAmbience: vi.fn() }));
vi.mock("next/navigation", () => import("@/test/next-navigation"));
vi.mock("motion/react", async (importOriginal) =>
  (await import("@/test/motion")).reducedMotion(importOriginal),
);

const NOW = Date.parse("2026-11-04T14:05:00.000+09:00");
beforeEach(() => {
  vi.useFakeTimers({ now: NOW });
  room.status = "listening";
  room.roomInfo = null;
  room.confirmedText = "";
  room.submitAnswer.mockResolvedValue("accepted");
  media.level = motionValue(0.5);
  media.stream = null;
  sessionStorage.clear();
  vi.mocked(endSession).mockResolvedValue({});
  vi.mocked(extendTurn).mockResolvedValue({ ok: true });
  vi.mocked(saveAnswerDraft).mockResolvedValue();
  vi.mocked(submitTextAnswer).mockResolvedValue({});
  vi.spyOn(crypto, "randomUUID").mockReturnValue("key-1" as ReturnType<typeof crypto.randomUUID>);
});

// 예시 데이터: 5.2 그룹 면접(group 7 · 내 면접 55) · API 명세 10.11 면접방 정보 예시
const SESSION = {
  id: 55,
  persona: "COFFEE_CHAT",
  mode: "VIDEO",
  status: "IN_PROGRESS",
  answeredCount: 1,
  elapsedSeconds: 0,
  group: { groupId: 7, status: "IN_PROGRESS" },
} as SessionResponse;
const MEMBERS = [
  { sessionId: 55, nickname: "김하나" },
  { sessionId: 56, nickname: "이두리" },
] as ParticipantResponse[];
const QUESTION: CurrentQuestion = { id: 303, seq: 3, content: "가장 큰 기술적 문제는요?" };
const DRAFT_KEY = "group-draft:55:303";

/** 면접방 정보. answerer가 지금 답변자, remainingSeconds가 남은 답변 시간이다 */
function info({
  answerer = 55,
  phase = "ANSWERING",
  remainingSeconds = 90,
  extended = false,
  myState = "PRESENT",
  endReason = null,
  groupStatus = "IN_PROGRESS",
}: {
  answerer?: number;
  phase?: GroupPhase;
  remainingSeconds?: number;
  extended?: boolean;
  myState?: "PRESENT" | "DONE" | "ENDED";
  endReason?: "AI_FAILURE" | null;
  groupStatus?: "IN_PROGRESS" | "ENDED";
} = {}): RoomInfoSnapshot {
  return {
    offsetMs: 0,
    info: {
      turnVersion: 17,
      serverTime: new Date(NOW).toISOString(),
      groupStatus,
      round: 2,
      phase,
      turn: {
        sessionId: answerer,
        seq: 3,
        kind: "PERSONAL",
        baseIndex: 2,
        announce: "FULL",
        deadlineAt:
          phase === "ANSWERING" ? new Date(NOW + remainingSeconds * 1000).toISOString() : null,
        extended,
        followupsLeft: 2,
      },
      participants: [
        { sessionId: 55, turnOrder: 1, state: myState, absentUntil: null, endReason },
        { sessionId: 56, turnOrder: 2, state: "PRESENT", absentUntil: null, endReason: null },
      ],
      upcoming: [56],
    },
  };
}

/** 면접방 화면. rerender에 같은 요소를 넘기면 다시 그리지 않으므로 매번 새로 만든다 */
function view(
  session: Partial<SessionResponse> = {},
  question: CurrentQuestion | null = QUESTION,
  turn: RoomInfoSnapshot["info"] | null = null,
) {
  return (
    <GroupInterviewRoom
      session={{ ...SESSION, ...session }}
      currentQuestion={question}
      members={MEMBERS}
      turn={turn}
    />
  );
}
const chatView = (question: CurrentQuestion | null = QUESTION) => view({ mode: "CHAT" }, question);
/** 마이크 트랙 하나가 있는 카메라 · 마이크 */
function withMicrophone() {
  const track = { enabled: true };
  media.stream = {
    getAudioTracks: () => [track],
    getVideoTracks: () => [],
  } as unknown as MediaStream;
  return track;
}
/** 에이전트가 보낸 내 답변 상태(answer.state)를 화면에 넘긴다 */
function answerState(state: AnswerStateMessage["state"]) {
  act(() =>
    vi
      .mocked(useInterviewRoom)
      .mock.lastCall?.[2]?.onAnswerState?.({ type: "answer.state", sessionId: 55, seq: 3, state }),
  );
}
function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}
/** 채팅 입력칸에 쓰고 0.8초 멈춘다(리액션 · 10.9 저장 신호) */
function typeAndPause(text: string) {
  fireEvent.input(screen.getByRole("textbox", { name: "답변" }), { target: { value: text } });
  advance(800);
}

describe("GroupInterviewRoom · 그룹 면접방", () => {
  describe("차례 알약", () => {
    describe("화면 표시", () => {
      it("내 차례면 '내 차례예요' · 기본 질문 번호 · 남은 답변 시간을 보인다", () => {
        room.roomInfo = info({ remainingSeconds: 65 });

        render(view());
        advance(0);

        expect(screen.getByText("내 차례예요")).toBeDefined();
        expect(screen.getByText("질문 2 / 4")).toBeDefined();
        expect(screen.getByText("1:05")).toBeDefined();
      });

      it("다른 사람 차례면 그 사람이 답하고 있다고 알리고 내 답변 자막을 두지 않는다", () => {
        room.roomInfo = info({ answerer: 56 });

        render(view());

        expect(screen.getByText("이두리 님이 답하고 있어요")).toBeDefined();
        expect(screen.queryByRole("region", { name: "내 답변 음성 인식" })).toBeNull();
      });

      it("화면을 숨기면 차례 알약도 숨긴다", () => {
        room.roomInfo = info({ answerer: 56 });
        render(view());

        fireEvent.click(screen.getByRole("button", { name: "화면 숨기기" }));

        expect(screen.getByText("이두리 님이 답하고 있어요").closest(".invisible")).not.toBeNull();
      });
    });

    describe("시간 경과", () => {
      it("내 차례에 남은 시간이 10초가 되면 읽기 프로그램에 알린다", () => {
        room.roomInfo = info({ remainingSeconds: 11 });
        render(view());
        advance(0);
        expect(screen.queryByText("답변 시간이 10초 남았어요")).toBeNull();

        advance(1000);

        expect(screen.getByText("답변 시간이 10초 남았어요")).toBeDefined();
      });

      it("다른 사람 차례면 10초가 남아도 알리지 않는다", () => {
        room.roomInfo = info({ answerer: 56, remainingSeconds: 10 });

        render(view());
        advance(0);

        expect(screen.queryByText("답변 시간이 10초 남았어요")).toBeNull();
      });
    });
  });

  describe("마이크 끄기", () => {
    describe("화면 표시", () => {
      it("다른 사람 차례면 마이크를 꺼 달라고 안내한다", () => {
        withMicrophone();
        room.roomInfo = info({ answerer: 56 });

        render(view());

        expect(screen.getByText("마이크를 꺼 주세요")).toBeDefined();
      });
    });

    describe("사용자 조작", () => {
      it("[마이크 끄기]를 누르면 내 마이크 소리를 막고 안내를 거둔다", () => {
        const track = withMicrophone();
        room.roomInfo = info({ answerer: 56 });
        render(view());

        fireEvent.click(screen.getByRole("button", { name: "마이크 끄기" }));

        expect(track.enabled).toBe(false);
        expect(screen.queryByText("마이크를 꺼 주세요")).toBeNull();
      });
    });

    describe("상태 변화", () => {
      it("마이크를 끈 뒤 내 차례가 되면 다시 켠다", () => {
        const track = withMicrophone();
        room.roomInfo = info({ answerer: 56 });
        const { rerender } = render(view());
        fireEvent.click(screen.getByRole("button", { name: "마이크 끄기" }));

        room.roomInfo = info({ answerer: 55 });
        rerender(view());

        expect(track.enabled).toBe(true);
      });
    });
  });

  describe("화상 답변", () => {
    describe("사용자 조작", () => {
      it("내 차례에 [답변 완료]를 누르면 내 질문 순서로 답변을 낸다", async () => {
        room.confirmedText = "캐시를 붙였어요";
        room.roomInfo = info();
        render(view());

        await act(async () => fireEvent.click(screen.getByRole("button", { name: "답변 완료" })));

        expect(room.submitAnswer).toHaveBeenCalledWith(3);
      });
    });

    describe("오류 처리", () => {
      it("답변을 저장하지 못했으면(submitFailed) 알리고 [다시 시도]로 같은 질문을 다시 낸다", async () => {
        room.roomInfo = info();
        render(view());

        answerState("submitFailed");
        expect(screen.getByText("답변을 저장하지 못했어요")).toBeDefined();
        await act(async () => fireEvent.click(screen.getByRole("button", { name: "다시 시도" })));

        expect(room.submitAnswer).toHaveBeenCalledWith(3);
      });
    });

    describe("상태 변화", () => {
      it("자동 제출(autoSubmitted)을 받으면 [답변 완료]를 잠근다", () => {
        room.confirmedText = "캐시를 붙였어요";
        room.roomInfo = info();
        render(view());

        answerState("autoSubmitted");

        expect(screen.getByRole("button", { name: "답변 완료" }).hasAttribute("disabled")).toBe(
          true,
        );
      });
    });
  });

  describe("채팅 답변", () => {
    describe("화면 표시", () => {
      it("다른 사람 차례면 입력칸을 잠근다", () => {
        room.roomInfo = info({ answerer: 56 });

        render(chatView());

        expect(screen.getByRole("textbox", { name: "답변" }).hasAttribute("readonly")).toBe(true);
      });

      it("내 차례에 받은 질문이 그 차례면 쓸 수 있다", () => {
        room.roomInfo = info();

        render(chatView());

        expect(screen.getByRole("textbox", { name: "답변" }).hasAttribute("readonly")).toBe(false);
      });

      it("다른 사람 차례에 면접관 질문을 아직 받지 못했으면 내 질문을 말풍선에 미리 보이지 않는다", () => {
        room.roomInfo = info({ answerer: 56 });

        render(chatView());

        expect(screen.queryByText(QUESTION.content)).toBeNull();
      });
    });
  });

  describe("채팅 답변 내기", () => {
    describe("사용자 조작", () => {
      it("답변을 내도(5.7) 면접관에게 [답변 완료](answer.submit)를 보내지 않는다", async () => {
        room.roomInfo = info();
        render(chatView());
        fireEvent.input(screen.getByRole("textbox", { name: "답변" }), {
          target: { value: "캐시를 붙였어요" },
        });

        fireEvent.keyDown(screen.getByRole("textbox", { name: "답변" }), { key: "Enter" });
        await flushPromises();

        expect(submitTextAnswer).toHaveBeenCalledTimes(1);
        expect(room.submitAnswer).not.toHaveBeenCalled();
      });
    });
  });

  describe("작성 중인 답변 저장", () => {
    describe("사용자 조작", () => {
      it("답변 중에 입력이 0.8초 멈추면 그 글을 저장한다", () => {
        room.roomInfo = info();
        render(chatView());

        typeAndPause("캐시");

        expect(saveAnswerDraft).toHaveBeenCalledWith(55, 303, "캐시");
      });

      it("글을 쓰면 sessionStorage에도 둔다", () => {
        room.roomInfo = info();
        render(chatView());

        fireEvent.input(screen.getByRole("textbox", { name: "답변" }), {
          target: { value: "캐시" },
        });

        expect(sessionStorage.getItem(DRAFT_KEY)).toBe("캐시");
      });
    });

    describe("시간 경과", () => {
      it("5초 안에 다시 멈추면 바로 보내지 않고 5초가 되는 때 가장 최근 글로 저장한다", () => {
        room.roomInfo = info();
        render(chatView());
        typeAndPause("캐시");

        typeAndPause("캐시를");
        typeAndPause("캐시를 붙였어요");
        expect(saveAnswerDraft).toHaveBeenCalledTimes(1);
        advance(5000);

        expect(saveAnswerDraft).toHaveBeenCalledTimes(2);
        expect(saveAnswerDraft).toHaveBeenLastCalledWith(55, 303, "캐시를 붙였어요");
      });
    });

    describe("상태 변화", () => {
      it("질문 음성 중에 쓴 글은 그때 보내지 않고 답변 중이 되면 한 번 보낸다", () => {
        room.roomInfo = info({ phase: "SPEAKING" });
        const { rerender } = render(chatView());
        typeAndPause("캐시");
        expect(saveAnswerDraft).not.toHaveBeenCalled();

        room.roomInfo = info({ phase: "ANSWERING" });
        rerender(chatView());

        expect(saveAnswerDraft).toHaveBeenCalledWith(55, 303, "캐시");
      });

      it("저장을 기다리는 중에 답변 시간이 끝나면(ANSWERING이 아님) 기다리던 저장을 보내지 않는다", () => {
        room.roomInfo = info();
        const { rerender } = render(chatView());
        typeAndPause("캐시");
        typeAndPause("캐시를");

        room.roomInfo = info({ phase: "DECIDING" });
        rerender(chatView());
        advance(5000);

        expect(saveAnswerDraft).toHaveBeenCalledTimes(1);
      });

      it("새로고침하면 sessionStorage에 둔 글로 입력칸을 시작한다", () => {
        sessionStorage.setItem(DRAFT_KEY, "쓰던 답변");
        room.roomInfo = info();

        render(chatView());

        expect(screen.getByRole("textbox", { name: "답변" })).toHaveProperty("value", "쓰던 답변");
      });

      it("답변을 내면 sessionStorage의 글을 지운다", async () => {
        room.roomInfo = info();
        render(chatView());
        fireEvent.input(screen.getByRole("textbox", { name: "답변" }), {
          target: { value: "캐시를 붙였어요" },
        });

        fireEvent.keyDown(screen.getByRole("textbox", { name: "답변" }), { key: "Enter" });
        await flushPromises();

        expect(sessionStorage.getItem(DRAFT_KEY)).toBeNull();
      });
    });

    describe("경계값", () => {
      it("탭을 벗어나면 5초가 지나지 않았어도 바로 저장한다", () => {
        room.roomInfo = info();
        render(chatView());
        typeAndPause("캐시");
        fireEvent.input(screen.getByRole("textbox", { name: "답변" }), {
          target: { value: "캐시를 붙였어요" },
        });

        vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
        fireEvent(document, new Event("visibilitychange"));

        expect(saveAnswerDraft).toHaveBeenLastCalledWith(55, 303, "캐시를 붙였어요");
      });

      it("창을 떠나면(pagehide) 5초가 지나지 않았어도 바로 저장한다", () => {
        room.roomInfo = info();
        render(chatView());
        typeAndPause("캐시");
        fireEvent.input(screen.getByRole("textbox", { name: "답변" }), {
          target: { value: "캐시를 붙였어요" },
        });

        fireEvent(window, new Event("pagehide"));

        expect(saveAnswerDraft).toHaveBeenLastCalledWith(55, 303, "캐시를 붙였어요");
      });
    });
  });

  describe("답변 시간 연장", () => {
    describe("경계값", () => {
      it.each([
        { label: "30초", remainingSeconds: 30, shown: true },
        { label: "31초", remainingSeconds: 31, shown: false },
      ])(
        "화상 내 차례에서 남은 시간이 $label이면 [+1분] 보임이 $shown이다",
        ({ remainingSeconds, shown }) => {
          room.roomInfo = info({ remainingSeconds });

          render(view());
          advance(0);

          expect(screen.queryByRole("button", { name: "+1분" }) !== null).toBe(shown);
        },
      );
    });

    describe("화면 표시", () => {
      it("이미 연장한 질문이면 [+1분]을 보이지 않는다", () => {
        room.roomInfo = info({ remainingSeconds: 20, extended: true });

        render(view());
        advance(0);

        expect(screen.queryByRole("button", { name: "+1분" })).toBeNull();
      });

      it("채팅이면 남은 시간이 30초 이하여도 [+1분]을 보이지 않는다", () => {
        room.roomInfo = info({ remainingSeconds: 20 });

        render(chatView());
        advance(0);

        expect(screen.queryByRole("button", { name: "+1분" })).toBeNull();
      });
    });

    describe("사용자 조작", () => {
      it("[+1분]을 누르면 이 그룹의 답변 시간 연장을 요청한다", async () => {
        room.roomInfo = info({ remainingSeconds: 20 });
        render(view());
        advance(0);

        await act(async () => fireEvent.click(screen.getByRole("button", { name: "+1분" })));

        expect(extendTurn).toHaveBeenCalledWith(7);
      });
    });

    describe("오류 처리", () => {
      it("연장하지 못하면 서버 문구를 보인다", async () => {
        vi.mocked(extendTurn).mockResolvedValue({ ok: false, formError: "이미 연장했어요." });
        room.roomInfo = info({ remainingSeconds: 20 });
        render(view());
        advance(0);

        await act(async () => fireEvent.click(screen.getByRole("button", { name: "+1분" })));

        expect(screen.getByText("이미 연장했어요.")).toBeDefined();
      });
    });

    describe("상태 변화", () => {
      it("차례가 바뀌면 지난 연장 실패 문구를 지운다", async () => {
        vi.mocked(extendTurn).mockResolvedValue({ ok: false, formError: "이미 연장했어요." });
        room.roomInfo = info({ remainingSeconds: 20 });
        const { rerender } = render(view());
        advance(0);
        await act(async () => fireEvent.click(screen.getByRole("button", { name: "+1분" })));

        room.roomInfo = {
          ...info(),
          info: { ...info().info, turn: { ...info().info.turn!, seq: 4 } },
        };
        rerender(view());

        expect(screen.queryByText("이미 연장했어요.")).toBeNull();
      });
    });
  });

  describe("연결", () => {
    describe("오류 처리", () => {
      it("면접방 연결이 끊기면(failed) 잠시 멈춤 카드를 띄우고 다시 그려 상태를 확인한다", () => {
        room.status = "failed";
        room.roomInfo = info();

        render(view());

        expect(screen.getByText("면접이 잠시 멈췄어요")).toBeDefined();
        expect(router.refresh).toHaveBeenCalledTimes(1);
      });

      it("내 질문을 다 마친 뒤(DONE) 방에서 나가져 끊긴 것은 잠시 멈춤으로 보지 않는다", () => {
        room.status = "failed";
        room.roomInfo = info({ answerer: 56, myState: "DONE" });

        render(view());

        expect(screen.queryByText("면접이 잠시 멈췄어요")).toBeNull();
      });
    });
  });

  describe("면접관 장애", () => {
    describe("오류 처리", () => {
      it("그룹이 끝났고 다른 참가자가 면접관 장애로 끝났으면(AI_FAILURE) 내게도 알린다", () => {
        const ended = info({ groupStatus: "ENDED", myState: "ENDED" });
        ended.info.participants[1] = {
          ...ended.info.participants[1],
          state: "ENDED",
          endReason: "AI_FAILURE",
        };
        room.roomInfo = ended;

        render(view());

        expect(screen.getByText("면접관 연결이 끊겨 면접을 마쳤습니다")).toBeDefined();
      });

      it("면접관 장애로 끝나면(AI_FAILURE) 알리고 [확인]을 누른 뒤에야 다시 그린다", () => {
        room.roomInfo = info({ myState: "ENDED", endReason: "AI_FAILURE" });
        render(view());
        expect(screen.getByText("면접관 연결이 끊겨 면접을 마쳤습니다")).toBeDefined();
        expect(router.refresh).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole("button", { name: "확인" }));

        expect(router.refresh).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe("내 면접 끝", () => {
    describe("상태 변화", () => {
      it("내 질문이 모두 끝나면(DONE) 내 면접 끝내기를 한 번 요청한다", async () => {
        room.roomInfo = info({ answerer: 56, myState: "DONE" });

        const { rerender } = render(view());
        await flushPromises();
        rerender(view());

        expect(endSession).toHaveBeenCalledTimes(1);
        expect(vi.mocked(endSession).mock.lastCall?.slice(0, 2)).toEqual([55, "key-1"]);
      });

      it("그룹이 끝나면(ENDED) 다시 그려 결과 분석으로 넘어간다", () => {
        room.roomInfo = info({ groupStatus: "ENDED" });

        render(view());

        expect(router.refresh).toHaveBeenCalledTimes(1);
      });
    });

    describe("오류 처리", () => {
      it("서버가 실패로 답했으면(keySpent) 2초 뒤 새 키로 다시 요청한다", async () => {
        let keys = 0;
        vi.mocked(crypto.randomUUID).mockImplementation(
          () => `key-${++keys}` as ReturnType<typeof crypto.randomUUID>,
        );
        vi.mocked(endSession).mockResolvedValueOnce({
          formError: "지금은 할 수 없는 요청이에요.",
          keySpent: true,
        });
        room.roomInfo = info({ answerer: 56, myState: "DONE" });
        render(view());
        await flushPromises();

        advance(2000);
        await flushPromises();

        expect(vi.mocked(endSession).mock.calls.map((call) => call[1])).toEqual(["key-1", "key-2"]);
      });

      it("끝내기에 실패하면 2초 뒤 같은 키로 다시 요청한다", async () => {
        vi.mocked(endSession).mockResolvedValueOnce({ formError: "잠시 후 다시 시도해 주세요." });
        room.roomInfo = info({ answerer: 56, myState: "DONE" });
        render(view());
        await flushPromises();

        advance(2000);
        await flushPromises();

        expect(vi.mocked(endSession).mock.calls.map((call) => call[1])).toEqual(["key-1", "key-1"]);
      });
    });
  });

  describe("면접방 정보", () => {
    describe("상태 변화", () => {
      it("다시 그릴 때 10.4가 잠깐 실패해도(undefined) 직전에 받은 닉네임으로 차례를 보인다", () => {
        room.roomInfo = info({ answerer: 56 });
        const { rerender } = render(view());

        rerender(
          <GroupInterviewRoom session={SESSION} currentQuestion={QUESTION} members={undefined} />,
        );

        expect(screen.getByText("이두리 님이 답하고 있어요")).toBeDefined();
      });

      it("면접방 정보를 받기 전이면 10.4의 차례 정보로 차례를 보인다", () => {
        room.roomInfo = null;

        render(view({}, QUESTION, info({ answerer: 56 }).info));

        expect(screen.getByText("이두리 님이 답하고 있어요")).toBeDefined();
      });
    });

    describe("시간 경과", () => {
      it("들어간 뒤 3초가 지나도 면접방 정보를 받지 못하면 한 번만 다시 그려 10.4를 다시 받는다", () => {
        room.roomInfo = null;
        render(view());

        advance(2999);
        expect(router.refresh).not.toHaveBeenCalled();
        advance(1);
        advance(3000);

        expect(router.refresh).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe("다음 질문", () => {
    describe("시간 경과", () => {
      it("내 차례인데 받은 질문이 아직 그 차례가 아니면 2초 뒤 다시 그려 받는다", () => {
        room.roomInfo = info();
        render(view({}, { ...QUESTION, seq: 2 }));

        advance(2000);

        expect(router.refresh).toHaveBeenCalledTimes(1);
      });
    });
  });
});
