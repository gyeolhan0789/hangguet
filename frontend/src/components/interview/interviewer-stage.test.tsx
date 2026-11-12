// 기준: Figma S06 · S06-B Interviewer Scene(18:2498 · 18:2575) · 면접관 표현 결정 ③-3(로드 실패 · 컨텍스트 손실이면 정지 이미지)
// · 사용자 결정(2026-10-22: 시간 제한 없이 받는 중이면 로딩 표시) · Next.js Preserving UI state(Activity) · 모션 메모 S06-F(18:4432: 눈 깜빡임)
// · 사용자 요청(2026-10-21: 면접관 로딩 화면 — S06-1 Thinking Avatar) · AI 명세 6.3 interview.question · reaction
// · 사용자 결정(2026-10-27: 150ms 늦춘 립싱크, 동작 줄이기면 입을 움직이지 않음) · 사용자 결정(2026-11-04: 오리 말하기 · 끄덕임 · 놀람 동작)
import { act, render, screen } from "@testing-library/react";
import { Activity, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { interviewerLook } from "@/lib/interviewer/models";
import type {
  QuestionMessage,
  ReactionMessage,
  ReactionSnapshot,
} from "@/lib/interview/room-messages";
import { useInterviewStore } from "@/stores/interview-store";
import { deferred } from "@/test/deferred";
import { flushPromises } from "@/test/flush";
import type { Persona } from "@/types/api";

import { InterviewerStage } from "./interviewer-stage";

// 경계 mock: 3D 장면(three.js · WebGL)과 동작 줄이기 설정. 연출(깜빡임 · 끄덕임 · 립싱크)의 순서가 우리 로직이라
// 공용 reducedMotion 대신 useReducedMotion만 테스트 변수로 바꾼다
const sceneModule = vi.hoisted(() => ({ createInterviewerScene: vi.fn() }));
vi.mock("@/lib/interviewer/scene", () => sceneModule);
const motionPreference = vi.hoisted(() => ({ reduced: false }));
vi.mock("motion/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("motion/react")>()),
  useReducedMotion: () => motionPreference.reduced,
}));
// 경계 mock: 크기 감시(ResizeObserver). 콜백을 보관해 테스트가 부른다
const resizeWatch = vi.hoisted(() => ({
  callback: null as (() => void) | null,
  disconnect: vi.fn(),
}));

function fakeScene() {
  return {
    setFace: vi.fn(),
    setHead: vi.fn(),
    setTalking: vi.fn(),
    nod: vi.fn(),
    surprise: vi.fn(),
    resize: vi.fn(),
    dispose: vi.fn(),
  };
}
type FakeScene = ReturnType<typeof fakeScene>;

// 예시 데이터: AI 명세 6.3 reaction 예시(받은 순간부터 1,200ms)
function reaction(
  patch: Partial<ReactionMessage["reaction"] & object> = {},
  attitude = { interest: 1, trust: 0.5 },
): ReactionSnapshot {
  return {
    receivedAt: performance.now(),
    message: {
      type: "reaction",
      sessionId: 55,
      questionSeq: 3,
      seq: 1,
      reaction: {
        type: "expression",
        expression: "smile",
        gesture: null,
        intensity: 0.4,
        durationMs: 1200,
        ...patch,
      } as ReactionMessage["reaction"],
      attitude,
      interrupt: null,
    },
  };
}
const NOD = { type: "gesture", expression: null, gesture: "nod", intensity: null } as const;
// 예시 데이터: AI 명세 6.3 interview.question(started의 alignment.chars '가' 0~200ms · '이' 200~400ms)
function question(speech: QuestionMessage["speech"], seq = 1): QuestionMessage {
  return {
    type: "question",
    sessionId: 55,
    seq,
    content: "가이",
    speech,
    alignment:
      speech === "started"
        ? {
            chars: [
              { char: "가", startMs: 0, endMs: 200 },
              { char: "이", startMs: 200, endMs: 400 },
            ],
          }
        : null,
  };
}
function speech() {
  return { questionSeq: 3, streamId: "capture-1", speechAt: performance.now() };
}

/** 장면을 바로 만들어 ready까지 그린다 */
async function ready(ui: ReactNode) {
  const scene = fakeScene();
  sceneModule.createInterviewerScene.mockResolvedValue(scene);
  const view = render(ui);
  await flushPromises();
  return { scene, ...view };
}

function advance(ms: number) {
  act(() => vi.advanceTimersByTime(ms));
}

const stage = () => screen.getByTestId("interviewer-stage");
const loading = () => screen.queryByRole("status", { name: "면접관을 불러오는 중" });
const emotions = (scene: FakeScene) =>
  scene.setFace.mock.calls.map(([face]) => face).filter((face) => "emotion" in face);
const lastEmotion = (scene: FakeScene) => emotions(scene).at(-1);
const mouths = (scene: FakeScene) =>
  scene.setFace.mock.calls.map(([face]) => face.mouth).filter(Boolean);
const blinks = (scene: FakeScene) =>
  scene.setFace.mock.calls.map(([face]) => face.blink).filter((blink) => blink !== undefined);
const headMoved = (scene: FakeScene) =>
  scene.setHead.mock.calls.some(([pitch, roll]) => pitch !== 0 || roll !== 0);

beforeEach(() => {
  vi.useFakeTimers();
  motionPreference.reduced = false;
  resizeWatch.callback = null;
  vi.spyOn(Math, "random").mockReturnValue(0);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: () => void) {
        resizeWatch.callback = callback;
      }
      observe() {}
      disconnect() {
        resizeWatch.disconnect();
      }
    },
  );
  useInterviewStore.setState({ exclaimedAt: null });
});

describe("InterviewerStage · 면접관 3D 장면", () => {
  describe("장면 불러오기", () => {
    describe("화면 표시", () => {
      it("불러오는 동안 면접관 썸네일 로딩 표시를 둔다", async () => {
        const created = deferred<FakeScene>();
        sceneModule.createInterviewerScene.mockReturnValue(created.promise);
        render(<InterviewerStage persona="DEVIL" />);

        expect(loading()?.contains(screen.getByRole("img", { name: "악마 면접관" }))).toBe(true);
        await act(async () => created.resolve(fakeScene()));
      });

      it("다 불러오면 로딩 표시를 없애고 3D를 보인다", async () => {
        const { container } = await ready(<InterviewerStage persona="DEVIL" />);

        expect(loading()).toBeNull();
        expect(stage().dataset.state).toBe("ready");
        expect(container.querySelector("canvas")?.parentElement?.className).not.toContain("hidden");
      });
    });

    describe("상태 변화", () => {
      it("화면 크기가 바뀌면 장면 크기를 맞춘다", async () => {
        const { scene } = await ready(<InterviewerStage persona="DEVIL" />);

        act(() => resizeWatch.callback!());

        expect(scene.resize).toHaveBeenCalledTimes(1);
      });

      it("숨겨졌다 다시 보이면 로딩 표시부터 두고 장면을 새로 만든다", async () => {
        const { scene, rerender } = await ready(
          <Activity mode="visible">
            <InterviewerStage persona="DEVIL" />
          </Activity>,
        );
        const again = deferred<FakeScene>();
        sceneModule.createInterviewerScene.mockReturnValue(again.promise);

        rerender(
          <Activity mode="hidden">
            <InterviewerStage persona="DEVIL" />
          </Activity>,
        );
        expect(scene.dispose).toHaveBeenCalledTimes(1);
        rerender(
          <Activity mode="visible">
            <InterviewerStage persona="DEVIL" />
          </Activity>,
        );
        await flushPromises();

        expect(stage().dataset.state).toBe("loading");
        expect(sceneModule.createInterviewerScene).toHaveBeenCalledTimes(2);
        await act(async () => again.resolve(fakeScene()));
        expect(stage().dataset.state).toBe("ready");
      });
    });

    describe("오류 처리", () => {
      it("장면을 만들지 못하면 정지 이미지를 보여 준다", async () => {
        sceneModule.createInterviewerScene.mockRejectedValue(new Error("WebGL 없음"));
        const { container } = render(<InterviewerStage persona="DEVIL" />);
        await flushPromises();

        expect(stage().dataset.state).toBe("failed");
        expect(
          container.querySelector(`img[src="${interviewerLook("DEVIL")!.still}"]`),
        ).not.toBeNull();
        expect(container.querySelector("canvas")?.parentElement?.className).toContain("hidden");
      });

      it("그리던 중 WebGL 컨텍스트를 잃으면 정지 이미지로 바꾼다", async () => {
        const { container } = await ready(<InterviewerStage persona="DEVIL" />);
        const { onLost } = sceneModule.createInterviewerScene.mock.calls[0][0] as {
          onLost: () => void;
        };

        act(() => onLost());

        expect(stage().dataset.state).toBe("failed");
        expect(
          container.querySelector(`img[src="${interviewerLook("DEVIL")!.still}"]`),
        ).not.toBeNull();
      });
    });

    describe("중복 · 경쟁 처리", () => {
      it("장면을 다 만들기 전에 화면을 떠나면 늦게 끝난 장면을 바로 정리한다", async () => {
        const created = deferred<FakeScene>();
        sceneModule.createInterviewerScene.mockReturnValue(created.promise);
        const { unmount } = render(<InterviewerStage persona="DEVIL" />);
        await flushPromises();
        const late = fakeScene();

        unmount();
        await act(async () => created.resolve(late));

        expect(late.dispose).toHaveBeenCalledTimes(1);
      });
    });

    describe("정리", () => {
      it("화면을 떠나면 장면을 정리하고 캔버스를 떼며 크기 감시를 멈춘다", async () => {
        const { scene, container, unmount } = await ready(<InterviewerStage persona="DEVIL" />);
        const canvas = container.querySelector("canvas")!;

        unmount();

        expect(scene.dispose).toHaveBeenCalledTimes(1);
        expect(canvas.isConnected).toBe(false);
        expect(resizeWatch.disconnect).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe("리액션", () => {
    describe("화면 표시", () => {
      it("리액션을 받으면 남은 시간 동안 프레임마다 표정과 고개를 그린다", async () => {
        const { scene } = await ready(<InterviewerStage persona="DEVIL" feedback={reaction()} />);

        advance(100);
        const early = lastEmotion(scene)!.emotionWeight;
        advance(500);

        // 받은 시각에서 멀어질수록(가운데 시점까지) 세기가 커지므로 프레임마다 다시 그린 것이다
        expect(early).toBeGreaterThan(0);
        expect(lastEmotion(scene)!.emotion).toBe("Smile");
        expect(lastEmotion(scene)!.emotionWeight).toBeGreaterThan(early);
        expect(headMoved(scene)).toBe(true);
      });

      it("동작 줄이기를 켰으면 리액션 가운데 시점의 표정만 두었다가 끝나면 되돌린다", async () => {
        motionPreference.reduced = true;
        const { scene } = await ready(<InterviewerStage persona="DEVIL" feedback={reaction()} />);

        expect(lastEmotion(scene)).toEqual({ emotion: "Smile", emotionWeight: 0.4 });
        advance(1199);
        expect(lastEmotion(scene)).toEqual({ emotion: "Smile", emotionWeight: 0.4 });
        advance(1);
        expect(lastEmotion(scene)).toEqual({ emotion: "neutral", emotionWeight: 0 });
      });

      it("동작 클립 면접관은 리액션에 고개를 직접 돌리지 않는다", async () => {
        const { scene } = await ready(<InterviewerStage persona="DUCK" feedback={reaction(NOD)} />);

        advance(600);

        expect(emotions(scene).length).toBeGreaterThan(2);
        expect(headMoved(scene)).toBe(false);
      });
    });

    describe("상태 변화", () => {
      it("리액션 시간이 지나면 프레임 그리기를 멈춘다", async () => {
        const { scene } = await ready(<InterviewerStage persona="DEVIL" feedback={reaction()} />);
        advance(1300);
        const drawn = emotions(scene).length;

        advance(1000);

        expect(emotions(scene)).toHaveLength(drawn);
        expect(lastEmotion(scene)).toEqual({ emotion: "neutral", emotionWeight: 0 });
      });

      it("질문 음성이 나오는 동안은 그리지 않고 음성이 끝나면 남은 시간만 그린다", async () => {
        const feedback = reaction();
        const { scene, rerender } = await ready(
          <InterviewerStage persona="DEVIL" feedback={feedback} speaking />,
        );
        advance(1000);
        expect(emotions(scene).every((face) => face.emotion === "neutral")).toBe(true);

        rerender(<InterviewerStage persona="DEVIL" feedback={feedback} />);
        advance(16);
        expect(lastEmotion(scene)!.emotion).toBe("Smile");

        advance(300);
        const drawn = emotions(scene).length;
        advance(500);
        expect(emotions(scene)).toHaveLength(drawn);
      });
    });

    describe("입력 검증", () => {
      it("동작 클립 면접관은 보이지 않는 반응이면 표정을 바꾸지 않는다", async () => {
        const { scene } = await ready(
          <InterviewerStage persona="DUCK" feedback={reaction({ expression: "frown" })} />,
        );

        advance(600);

        expect(emotions(scene).every((face) => face.emotion === "neutral")).toBe(true);
      });
    });

    describe("경계값", () => {
      it("장면이 늦게 만들어져 이미 끝난 리액션은 그리지 않는다", async () => {
        // 동작 줄이기에서는 가운데 시점 표정을 바로 두므로, 끝난 리액션을 거르지 않으면 표정이 한 번 바뀐다
        motionPreference.reduced = true;
        const created = deferred<FakeScene>();
        sceneModule.createInterviewerScene.mockReturnValue(created.promise);
        render(<InterviewerStage persona="DEVIL" feedback={reaction()} />);
        advance(1201);
        const scene = fakeScene();

        await act(async () => created.resolve(scene));
        advance(100);

        expect(emotions(scene).every((face) => face.emotion === "neutral")).toBe(true);
      });

      it("동작 클립 면접관은 끄덕임 반응을 받은 지 300ms 안이면 끄덕임 동작을 한 번 한다", async () => {
        const { scene } = await ready(<InterviewerStage persona="DUCK" feedback={reaction(NOD)} />);

        advance(1300);

        expect(scene.nod).toHaveBeenCalledTimes(1);
      });

      it("동작 클립 면접관은 끄덕임 반응을 받은 지 300ms가 지나 다시 그리면 끄덕이지 않는다", async () => {
        const feedback = reaction(NOD);
        const { scene, rerender } = await ready(
          <InterviewerStage persona="DUCK" feedback={feedback} speaking />,
        );
        advance(301);

        rerender(<InterviewerStage persona="DUCK" feedback={feedback} />);
        advance(100);

        expect(scene.nod).not.toHaveBeenCalled();
      });
    });

    describe("정리", () => {
      it("화면을 떠나면 리액션 그리기를 멈추고 표정을 되돌린다", async () => {
        const { scene, unmount } = await ready(
          <InterviewerStage persona="DEVIL" feedback={reaction()} />,
        );
        advance(300);

        unmount();
        const drawn = emotions(scene).length;
        advance(1000);

        expect(lastEmotion(scene)).toEqual({ emotion: "neutral", emotionWeight: 0 });
        expect(scene.setHead).toHaveBeenLastCalledWith(0, 0);
        expect(emotions(scene)).toHaveLength(drawn);
      });
    });
  });

  describe("듣는 중 끄덕임", () => {
    describe("화면 표시", () => {
      it("말이 멈추고 1초 뒤 한 번 끄덕이고 고개를 되돌린다", async () => {
        const { scene } = await ready(<InterviewerStage persona="DEVIL" listening={speech()} />);

        advance(999);
        expect(headMoved(scene)).toBe(false);
        advance(301);
        expect(scene.setHead.mock.lastCall![0]).toBeGreaterThan(0);
        advance(1000);
        expect(scene.setHead).toHaveBeenLastCalledWith(0, 0);
        const moved = scene.setHead.mock.calls.length;
        advance(5000);
        expect(scene.setHead).toHaveBeenCalledTimes(moved);
      });

      it("동작 클립 면접관은 1초 뒤 끄덕임 동작을 한 번 한다", async () => {
        const { scene } = await ready(<InterviewerStage persona="DUCK" listening={speech()} />);

        advance(999);
        expect(scene.nod).not.toHaveBeenCalled();
        advance(3000);
        expect(scene.nod).toHaveBeenCalledTimes(1);
      });
    });

    describe("상태 변화", () => {
      it("새 발화가 오면 끄덕일 때를 다시 잡는다", async () => {
        const { scene, rerender } = await ready(
          <InterviewerStage persona="DEVIL" listening={speech()} />,
        );
        advance(700);

        rerender(<InterviewerStage persona="DEVIL" listening={speech()} />);
        advance(600);
        expect(headMoved(scene)).toBe(false);
        advance(700);
        expect(scene.setHead.mock.lastCall![0]).toBeGreaterThan(0);
      });

      it("끄덕임 정보가 없어지면 기다리던 끄덕임을 취소한다", async () => {
        const { scene, rerender } = await ready(
          <InterviewerStage persona="DEVIL" listening={speech()} />,
        );
        advance(500);

        rerender(<InterviewerStage persona="DEVIL" />);
        advance(3000);

        expect(headMoved(scene)).toBe(false);
      });
    });

    describe("입력 검증", () => {
      it.each([
        { label: "질문 음성 중", speaking: true, reacting: false, reduced: false },
        { label: "리액션 중", speaking: false, reacting: true, reduced: false },
        { label: "동작 줄이기", speaking: false, reacting: false, reduced: true },
      ])("'$label'이면 끄덕이지 않는다", async ({ speaking, reacting, reduced }) => {
        motionPreference.reduced = reduced;
        // 고개를 움직이지 않는 리액션(관심 0.5의 웃음)이 끄덕일 때(1~2.2초)를 덮는다
        const feedback = reacting
          ? reaction({ durationMs: 2400 }, { interest: 0.5, trust: 0.5 })
          : null;
        const { scene } = await ready(
          <InterviewerStage
            persona="DEVIL"
            listening={speech()}
            speaking={speaking}
            feedback={feedback}
          />,
        );

        advance(2500);

        expect(headMoved(scene)).toBe(false);
      });
    });

    describe("경계값", () => {
      it("장면이 늦게 만들어져 끄덕일 때가 이미 지났으면 끄덕이지 않는다", async () => {
        const created = deferred<FakeScene>();
        sceneModule.createInterviewerScene.mockReturnValue(created.promise);
        render(<InterviewerStage persona="DUCK" listening={speech()} />);
        advance(2300);
        const scene = fakeScene();

        await act(async () => created.resolve(scene));
        advance(1000);

        expect(scene.nod).not.toHaveBeenCalled();
      });
    });

    describe("정리", () => {
      it("끄덕이는 중에 화면을 떠나면 이후 프레임을 그리지 않는다", async () => {
        const { scene, unmount } = await ready(
          <InterviewerStage persona="DEVIL" listening={speech()} />,
        );
        advance(1300);
        expect(headMoved(scene)).toBe(true);

        unmount();
        const drawn = scene.setHead.mock.calls.length;
        advance(3000);

        expect(scene.setHead).toHaveBeenCalledTimes(drawn);
        expect(scene.setHead).toHaveBeenLastCalledWith(0, 0);
      });
    });
  });

  describe("입 모양", () => {
    describe("화면 표시", () => {
      it("질문 음성이 시작되면 150ms 뒤부터 발음 시각대로 입 모양을 바꾸고 끝나면 닫는다", async () => {
        const { scene } = await ready(
          <InterviewerStage persona="DEVIL" question={question("started")} />,
        );

        advance(140);
        expect(mouths(scene).every((mouth) => mouth.A === 0 && mouth.I === 0)).toBe(true);
        advance(160);
        expect(mouths(scene).at(-1).A).toBeGreaterThan(0);
        advance(200);
        expect(mouths(scene).at(-1).I).toBeGreaterThan(0);
        advance(300);
        expect(mouths(scene).at(-1)).toEqual({ A: 0, I: 0, U: 0, E: 0, O: 0 });
      });

      it("동작 클립 면접관은 말하는 구간 동안 말하기 동작을 하고 끝나면 멈춘다", async () => {
        const { scene } = await ready(
          <InterviewerStage persona="DUCK" question={question("started")} />,
        );

        advance(140);
        expect(scene.setTalking).not.toHaveBeenCalled();
        advance(100);
        expect(scene.setTalking.mock.calls).toEqual([[true]]);
        advance(500);
        expect(scene.setTalking.mock.calls).toEqual([[true], [false]]);
        expect(mouths(scene)).toEqual([]);
      });
    });

    describe("상태 변화", () => {
      it.each([
        { label: "다음 질문", next: question("started", 2) },
        { label: "음성 끝남", next: question("ended") },
      ])("'$label'이면 입을 닫는다", async ({ next }) => {
        const { scene, rerender } = await ready(
          <InterviewerStage persona="DEVIL" question={question("started")} />,
        );
        advance(300);
        expect(mouths(scene).at(-1).A).toBeGreaterThan(0);

        rerender(<InterviewerStage persona="DEVIL" question={next} />);

        expect(mouths(scene).at(-1)).toEqual({ A: 0, I: 0, U: 0, E: 0, O: 0 });
      });
    });

    describe("입력 검증", () => {
      it.each([
        {
          label: "발음 시각 없음",
          message: { ...question("started"), alignment: null },
          reduced: false,
        },
        { label: "동작 줄이기", message: question("started"), reduced: true },
      ])("'$label'이면 입을 움직이지 않는다", async ({ message, reduced }) => {
        motionPreference.reduced = reduced;
        const { scene } = await ready(<InterviewerStage persona="DEVIL" question={message} />);

        advance(500);

        expect(mouths(scene)).toEqual([]);
      });
    });
  });

  describe("감탄", () => {
    describe("입력 검증", () => {
      it.each([
        { label: "사람 면접관", persona: "DEVIL" as Persona, reduced: false },
        { label: "동작 줄이기", persona: "DUCK" as Persona, reduced: true },
      ])("'$label'이면 놀라지 않는다", async ({ persona, reduced }) => {
        motionPreference.reduced = reduced;
        const { scene } = await ready(<InterviewerStage persona={persona} />);

        act(() => useInterviewStore.getState().exclaim());

        expect(scene.surprise).not.toHaveBeenCalled();
      });
    });

    describe("경계값", () => {
      it("동작 클립 면접관은 감탄 직후 300ms 안이면 놀람 동작을 한 번 한다", async () => {
        const { scene } = await ready(<InterviewerStage persona="DUCK" />);

        act(() => useInterviewStore.getState().exclaim());

        expect(scene.surprise).toHaveBeenCalledTimes(1);
      });

      it("감탄한 지 300ms가 지나 다시 그리면 놀라지 않는다", async () => {
        useInterviewStore.getState().exclaim();
        const created = deferred<FakeScene>();
        sceneModule.createInterviewerScene.mockReturnValue(created.promise);
        render(<InterviewerStage persona="DUCK" />);
        advance(301);
        const scene = fakeScene();

        await act(async () => created.resolve(scene));

        expect(scene.surprise).not.toHaveBeenCalled();
      });
    });
  });

  describe("눈 깜빡임", () => {
    describe("입력 검증", () => {
      it("동작 줄이기를 켰으면 깜빡이지 않는다", async () => {
        motionPreference.reduced = true;
        const { scene } = await ready(<InterviewerStage persona="DEVIL" />);

        advance(10_000);

        expect(blinks(scene)).toEqual([]);
      });
    });

    describe("시간 경과", () => {
      it("고른 간격이 지나면 눈을 감았다 뜬다", async () => {
        const { scene } = await ready(<InterviewerStage persona="DEVIL" />);

        advance(2499);
        expect(blinks(scene)).toEqual([]);
        advance(100);
        expect(blinks(scene).some((blink) => blink > 0)).toBe(true);
        advance(200);
        expect(blinks(scene).at(-1)).toBe(0);
      });

      it("깜빡임이 끝나면 다음 깜빡임을 다시 건다", async () => {
        const { scene } = await ready(<InterviewerStage persona="DEVIL" />);
        advance(2800);
        const first = blinks(scene).length;

        advance(2600);

        expect(
          blinks(scene)
            .slice(first)
            .some((blink) => blink > 0),
        ).toBe(true);
      });
    });

    describe("정리", () => {
      it("화면을 떠나면 깜빡임을 멈추고 눈을 뜬 채로 둔다", async () => {
        const { scene, unmount } = await ready(<InterviewerStage persona="DEVIL" />);
        advance(2560);
        expect(blinks(scene).at(-1)).toBeGreaterThan(0);

        unmount();
        const drawn = blinks(scene).length;
        advance(5000);

        expect(blinks(scene).at(-1)).toBe(0);
        expect(blinks(scene)).toHaveLength(drawn);
      });
    });
  });
});
