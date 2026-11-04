import { act, cleanup, render, screen } from "@testing-library/react";
import { Activity } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { interviewerLook } from "@/lib/interviewer/models";
import type { QuestionMessage, ReactionSnapshot } from "@/lib/interview/room-messages";

import { InterviewerStage } from "./interviewer-stage";

const motionPreference = vi.hoisted(() => ({ reduced: true }));

vi.mock("motion/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("motion/react")>()),
  useReducedMotion: () => motionPreference.reduced,
}));

// three.js 장면(WebGL)은 jsdom에서 그릴 수 없어 경계만 바꾼다. 실제 3D는 E2E(interview.spec.ts)가 본다.
const dispose = vi.fn();
const createInterviewerScene = vi.fn();
vi.mock("@/lib/interviewer/scene", () => ({
  createInterviewerScene: (...args: unknown[]) => createInterviewerScene(...args),
}));

// 지금은 모든 면접관에 모델이 있어, 모델이 없는 면접관은 테스트에서 interviewerLook이 null을 돌려주게 해 본다.
vi.mock("@/lib/interviewer/models", async (importOriginal) => {
  const models = await importOriginal<typeof import("@/lib/interviewer/models")>();
  return { ...models, interviewerLook: vi.fn(models.interviewerLook) };
});

// 기준: 면접관 표현 결정 ③-3(WebGL 미지원 · 로드 실패 · 컨텍스트 손실이면 정지 이미지)
// · 사용자 결정(2026-10-22: 큰 모델이라 시간 제한(③-3의 10초 Timeout) 없이 받는 중이면 로딩 표시를 계속 둔다)
// · Next.js Preserving UI state(Activity: 떠난 화면을 숨겨 두었다가 돌아오면 효과를 다시 실행)
// · 사용자 요청(2026-10-21: 면접관 로딩 화면 — S06-1 Thinking Avatar) · Swagger 5.1 Persona
// · 사용자 결정(2026-10-26: 커피챗 면접관도 3D 모델을 쓰고, 카페 실내 그림을 배경으로 깐다)

beforeEach(() => {
  motionPreference.reduced = true;
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  // 모델이 없는 면접관으로 바꾼 값을 다음 테스트로 넘기지 않는다(실제 interviewerLook으로 되돌린다).
  vi.mocked(interviewerLook).mockReset();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const stage = () => screen.getByTestId("interviewer-stage");
const loading = () => screen.queryByRole("status", { name: "면접관을 불러오는 중" });

describe("InterviewerStage (면접관 3D 장면)", () => {
  function animated() {
    vi.useFakeTimers();
    motionPreference.reduced = false;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
      window.setTimeout(() => callback(performance.now()), 16),
    );
    vi.stubGlobal("cancelAnimationFrame", (id: number) => window.clearTimeout(id));
    const setFace = vi.fn(),
      setHead = vi.fn();
    createInterviewerScene.mockResolvedValue({ setFace, setHead, resize: vi.fn(), dispose });
    return { setFace, setHead };
  }
  const activity = () => ({ questionSeq: 3, streamId: "capture-1", speechAt: performance.now() });
  // 기준: AI 명세 6.3 interview.question(started의 alignment.chars) · 사용자 결정(2026-10-27: 150ms 늦춰 모음별 입 모양,
  // 동작 줄이기면 입을 움직이지 않는다)
  const question = (speech: QuestionMessage["speech"]): QuestionMessage => ({
    type: "question",
    sessionId: 55,
    seq: 1,
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
  });
  const lastMouth = (setFace: ReturnType<typeof vi.fn>) =>
    setFace.mock.calls.filter(([face]) => face.mouth).at(-1)?.[0].mouth;

  it("질문 음성이 시작되면 150ms 뒤부터 발음 시각대로 입을 바꾸고 끝나면 닫는다", async () => {
    const { setFace } = animated();
    const { rerender } = render(
      <InterviewerStage persona="DEVIL" question={question("started")} />,
    );
    await act(async () => {});
    act(() => vi.advanceTimersByTime(140));
    expect(lastMouth(setFace) ?? { A: 0 }).toMatchObject({ A: 0 });
    act(() => vi.advanceTimersByTime(160));
    expect(lastMouth(setFace).A).toBeGreaterThan(0);
    act(() => vi.advanceTimersByTime(200));
    expect(lastMouth(setFace).I).toBeGreaterThan(0);

    rerender(<InterviewerStage persona="DEVIL" question={question("ended")} />);
    expect(lastMouth(setFace)).toEqual({ A: 0, I: 0, U: 0, E: 0, O: 0 });
    const count = setFace.mock.calls.length;
    act(() => vi.advanceTimersByTime(1000));
    expect(setFace).toHaveBeenCalledTimes(count);
  });
  it("발음 시각이 없거나 동작 줄이기를 켰으면 입을 움직이지 않는다", async () => {
    const { setFace } = animated();
    const { rerender } = render(
      <InterviewerStage persona="DEVIL" question={{ ...question("started"), alignment: null }} />,
    );
    await act(async () => {});
    act(() => vi.advanceTimersByTime(500));
    expect(lastMouth(setFace)).toBeUndefined();

    motionPreference.reduced = true;
    rerender(<InterviewerStage persona="DEVIL" question={question("started")} />);
    act(() => vi.advanceTimersByTime(500));
    expect(lastMouth(setFace)).toBeUndefined();
  });
  it("자막 변경 뒤 1초 동안 대기한 다음 한 번만 작게 끄덕이고 복귀한다", async () => {
    const { setHead } = animated();
    render(<InterviewerStage persona="DEVIL" listening={activity()} />);
    await act(async () => {});
    act(() => vi.advanceTimersByTime(999));
    expect(setHead).toHaveBeenLastCalledWith(0, 0);
    act(() => vi.advanceTimersByTime(301));
    expect(setHead.mock.lastCall?.[0]).toBeGreaterThan(0);
    act(() => vi.advanceTimersByTime(1000));
    expect(setHead).toHaveBeenLastCalledWith(0, 0);
    const count = setHead.mock.calls.length;
    act(() => vi.advanceTimersByTime(10_000));
    expect(setHead).toHaveBeenCalledTimes(count);
  });
  it("새 발화가 발생하면 대기를 다시 계산하고 발화 정보 제거 시 재생도 취소한다", async () => {
    const { setHead } = animated();
    const { rerender } = render(<InterviewerStage persona="DEVIL" listening={activity()} />);
    await act(async () => {});
    act(() => vi.advanceTimersByTime(700));
    rerender(<InterviewerStage persona="DEVIL" listening={activity()} />);
    act(() => vi.advanceTimersByTime(600));
    expect(setHead).toHaveBeenLastCalledWith(0, 0);
    act(() => vi.advanceTimersByTime(700));
    expect(setHead.mock.lastCall?.[0]).toBeGreaterThan(0);
    rerender(<InterviewerStage persona="DEVIL" />);
    const count = setHead.mock.calls.length;
    act(() => vi.advanceTimersByTime(3000));
    expect(setHead).toHaveBeenCalledTimes(count);
    expect(setHead).toHaveBeenLastCalledWith(0, 0);
  });
  it("질문 음성과 수신 리액션에는 자동 끄덕임을 겹치지 않는다", async () => {
    const { setHead, setFace } = animated();
    const current = activity();
    const { rerender } = render(<InterviewerStage persona="DEVIL" listening={current} speaking />);
    await act(async () => {});
    act(() => vi.advanceTimersByTime(1300));
    expect(setHead).toHaveBeenLastCalledWith(0, 0);
    rerender(<InterviewerStage persona="DEVIL" listening={current} feedback={feedback()} />);
    act(() => vi.advanceTimersByTime(300));
    expect(setFace.mock.lastCall?.[0].emotion).toBe("Smile");
    expect(setHead.mock.calls.every(([pitch, roll]) => pitch === 0 && roll === 0)).toBe(true);
    act(() => vi.advanceTimersByTime(1300));
    expect(setHead).toHaveBeenLastCalledWith(0, 0);
  });
  it("동작 줄이기 설정과 화면 이탈에서는 자동 끄덕임을 재생하지 않는다", async () => {
    const { setHead } = animated();
    motionPreference.reduced = true;
    const { unmount } = render(<InterviewerStage persona="DEVIL" listening={activity()} />);
    await act(async () => {});
    act(() => vi.advanceTimersByTime(1300));
    expect(setHead.mock.calls.every(([pitch, roll]) => pitch === 0 && roll === 0)).toBe(true);
    unmount();
    const count = setHead.mock.calls.length;
    act(() => vi.advanceTimersByTime(3000));
    expect(setHead).toHaveBeenCalledTimes(count);
    expect(dispose).toHaveBeenCalledTimes(1);
  });
  it("자동 끄덕임 재생 중 화면 이탈 시 이후 프레임을 실행하지 않는다", async () => {
    const { setHead } = animated();
    const { unmount } = render(<InterviewerStage persona="DEVIL" listening={activity()} />);
    await act(async () => {});
    act(() => vi.advanceTimersByTime(1300));
    expect(setHead.mock.lastCall?.[0]).toBeGreaterThan(0);
    unmount();
    const count = setHead.mock.calls.length;
    act(() => vi.advanceTimersByTime(3000));
    expect(setHead).toHaveBeenCalledTimes(count);
    expect(setHead).toHaveBeenLastCalledWith(0, 0);
  });
  it("모델 로딩이 늦어 만료된 자동 끄덕임은 다시 재생하지 않는다", async () => {
    const { setFace, setHead } = animated();
    let finish!: (value: unknown) => void;
    createInterviewerScene.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    render(<InterviewerStage persona="DEVIL" listening={activity()} />);
    act(() => vi.advanceTimersByTime(2300));
    await act(async () => finish({ setFace, setHead, resize: vi.fn(), dispose }));
    expect(setHead.mock.calls.every(([pitch, roll]) => pitch === 0 && roll === 0)).toBe(true);
  });
  const feedback = (): ReactionSnapshot => ({
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
      },
      attitude: { interest: 0.5, trust: 0.5 },
      interrupt: null,
    },
  });
  it("수신 시각부터 1,200ms 뒤 표정을 복구하고 화면 이탈 시 동작도 정리한다", async () => {
    vi.useFakeTimers();
    const setFace = vi.fn(),
      setHead = vi.fn();
    createInterviewerScene.mockResolvedValue({ setFace, setHead, resize: vi.fn(), dispose });
    const { unmount } = render(<InterviewerStage persona="DEVIL" feedback={feedback()} />);
    await act(async () => {});
    expect(setFace).toHaveBeenLastCalledWith({ emotion: "Smile", emotionWeight: 0.4 });
    act(() => vi.advanceTimersByTime(1199));
    expect(setFace).toHaveBeenLastCalledWith({ emotion: "Smile", emotionWeight: 0.4 });
    act(() => vi.advanceTimersByTime(1));
    expect(setFace).toHaveBeenLastCalledWith({ emotion: "neutral", emotionWeight: 0 });
    expect(setHead).toHaveBeenLastCalledWith(0, 0);
    unmount();
    expect(dispose).toHaveBeenCalledTimes(1);
  });
  it("수신한 durationMs(2,400ms) 동안 표정을 유지한다", async () => {
    vi.useFakeTimers();
    const setFace = vi.fn(),
      setHead = vi.fn();
    createInterviewerScene.mockResolvedValue({ setFace, setHead, resize: vi.fn(), dispose });
    const current = feedback();
    current.message.reaction = { ...current.message.reaction!, durationMs: 2400 };
    render(<InterviewerStage persona="DEVIL" feedback={current} />);
    await act(async () => {});
    act(() => vi.advanceTimersByTime(2399));
    expect(setFace).toHaveBeenLastCalledWith({ emotion: "Smile", emotionWeight: 0.4 });
    act(() => vi.advanceTimersByTime(1));
    expect(setFace).toHaveBeenLastCalledWith({ emotion: "neutral", emotionWeight: 0 });
  });
  it("질문 음성이 반응보다 우선하며 재생 종료 뒤에는 남은 시간만 표현한다", async () => {
    vi.useFakeTimers();
    const setFace = vi.fn(),
      setHead = vi.fn();
    createInterviewerScene.mockResolvedValue({ setFace, setHead, resize: vi.fn(), dispose });
    const current = feedback();
    const { rerender } = render(<InterviewerStage persona="DEVIL" feedback={current} speaking />);
    await act(async () => {});
    expect(setFace).toHaveBeenLastCalledWith({ emotion: "neutral", emotionWeight: 0 });
    act(() => vi.advanceTimersByTime(1000));
    rerender(<InterviewerStage persona="DEVIL" feedback={current} />);
    expect(setFace).toHaveBeenLastCalledWith({ emotion: "Smile", emotionWeight: 0.4 });
    act(() => vi.advanceTimersByTime(200));
    expect(setFace).toHaveBeenLastCalledWith({ emotion: "neutral", emotionWeight: 0 });
  });
  it("모델 로딩 지연으로 이미 종료된 리액션은 다시 재생하지 않는다", async () => {
    vi.useFakeTimers();
    let finish!: (value: unknown) => void;
    const setFace = vi.fn(),
      setHead = vi.fn();
    createInterviewerScene.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    render(<InterviewerStage persona="DEVIL" feedback={feedback()} />);
    act(() => vi.advanceTimersByTime(1201));
    await act(async () => finish({ setFace, setHead, resize: vi.fn(), dispose }));
    expect(setFace).not.toHaveBeenCalledWith({ emotion: "Smile", emotionWeight: 0.4 });
    expect(setHead).toHaveBeenLastCalledWith(0, 0);
  });
  it("3D 모델이 없는 면접관이면 아무것도 그리지 않는다", () => {
    vi.mocked(interviewerLook).mockReturnValue(null);
    const { container } = render(<InterviewerStage persona="COFFEE_CHAT" />);
    expect(container.innerHTML).toBe("");
    expect(createInterviewerScene).not.toHaveBeenCalled();
  });

  it("커피챗 면접관은 자기 모델 · 구도 · 카페 배경 그림 · 조명으로 그리고, 폭풍 배경(비네트)은 깔지 않는다", async () => {
    const coffee = interviewerLook("COFFEE_CHAT")!;
    createInterviewerScene.mockResolvedValue({
      setFace: vi.fn(),
      setHead: vi.fn(),
      resize: vi.fn(),
      dispose,
    });
    render(<InterviewerStage persona="COFFEE_CHAT" />);
    expect(screen.getByRole("img", { name: "개발자 커피챗" })).toBeTruthy();

    await act(async () => {});

    expect(stage().dataset.state).toBe("ready");
    expect(screen.queryByTestId("storm-vignette")).toBeNull();
    expect(coffee.model.glb).toBe("/interview/coffee-chat/interviewer.glb");
    expect(createInterviewerScene).toHaveBeenCalledWith(
      expect.objectContaining({
        model: coffee.model,
        frame: coffee.frame,
        storm: undefined,
        interior: undefined,
        background: coffee.background,
        lights: coffee.lights,
      }),
    );
  });

  it("불러오는 동안 면접관 썸네일 로딩 표시를 두고, 다 불러오면 3D로 바꾼다", async () => {
    let resolve!: (scene: unknown) => void;
    createInterviewerScene.mockReturnValue(new Promise((done) => (resolve = done)));
    render(<InterviewerStage persona="DEVIL" />);

    expect(stage().dataset.state).toBe("loading");
    expect(loading()).toBeTruthy();
    expect(screen.getByRole("img", { name: "악마 면접관" })).toBeTruthy();

    await act(async () =>
      resolve({ setFace: vi.fn(), setHead: vi.fn(), resize: vi.fn(), dispose }),
    );

    expect(stage().dataset.state).toBe("ready");
    expect(loading()).toBeNull();
    expect(createInterviewerScene).toHaveBeenCalledWith(
      expect.objectContaining({
        model: expect.objectContaining({
          glb: "/interview/devil/interviewer.glb",
          faceRules: "/interview/devil/face-rules.json",
          animation: "/interview/devil/animation.json",
        }),
      }),
    );
  });

  it("불러오지 못하면 정지 이미지를 보여 준다", async () => {
    createInterviewerScene.mockRejectedValue(new Error("WebGL 없음"));
    const { container } = render(<InterviewerStage persona="DEVIL" />);

    await act(async () => {});

    expect(stage().dataset.state).toBe("failed");
    expect(container.querySelector('img[src="/interview/devil/still.webp"]')).toBeTruthy();
    expect(container.querySelector("canvas")?.parentElement?.className).toContain("hidden");
  });

  it("받는 중이면 시간이 얼마나 지나도 로딩 표시를 두고, 다 받으면 3D로 바꾼다", async () => {
    vi.useFakeTimers();
    let resolve!: (scene: unknown) => void;
    createInterviewerScene.mockReturnValue(new Promise((done) => (resolve = done)));
    render(<InterviewerStage persona="DEVIL" />);

    // 10분이 지나도 시간으로는 실패하지 않는다.
    await act(async () => vi.advanceTimersByTime(10 * 60_000));
    expect(stage().dataset.state).toBe("loading");
    expect(loading()).toBeTruthy();

    await act(async () =>
      resolve({ setFace: vi.fn(), setHead: vi.fn(), resize: vi.fn(), dispose }),
    );
    expect(stage().dataset.state).toBe("ready");
  });

  it("다 받기 전에 화면을 떠나면, 늦게 끝난 장면은 바로 정리한다", async () => {
    let resolve!: (scene: unknown) => void;
    createInterviewerScene.mockReturnValue(new Promise((done) => (resolve = done)));
    const { unmount } = render(<InterviewerStage persona="DEVIL" />);

    unmount();
    await act(async () =>
      resolve({ setFace: vi.fn(), setHead: vi.fn(), resize: vi.fn(), dispose }),
    );

    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("숨겨졌다(Activity) 다시 보이면 로딩 표시부터 두고 장면을 새로 만든다", async () => {
    createInterviewerScene.mockResolvedValue({
      setFace: vi.fn(),
      setHead: vi.fn(),
      resize: vi.fn(),
      dispose,
    });
    const { rerender } = render(
      <Activity mode="visible">
        <InterviewerStage persona="DEVIL" />
      </Activity>,
    );
    await act(async () => {});
    expect(stage().dataset.state).toBe("ready");

    let resolve!: (scene: unknown) => void;
    createInterviewerScene.mockReturnValue(new Promise((done) => (resolve = done)));
    await act(async () =>
      rerender(
        <Activity mode="hidden">
          <InterviewerStage persona="DEVIL" />
        </Activity>,
      ),
    );
    expect(dispose).toHaveBeenCalledTimes(1);

    await act(async () =>
      rerender(
        <Activity mode="visible">
          <InterviewerStage persona="DEVIL" />
        </Activity>,
      ),
    );
    expect(stage().dataset.state).toBe("loading");
    expect(createInterviewerScene).toHaveBeenCalledTimes(2);

    await act(async () =>
      resolve({ setFace: vi.fn(), setHead: vi.fn(), resize: vi.fn(), dispose }),
    );
    expect(stage().dataset.state).toBe("ready");
  });

  it("WebGL 컨텍스트를 잃으면(onLost) 정지 이미지로 바꾼다", async () => {
    createInterviewerScene.mockImplementation(async ({ onLost }: { onLost: () => void }) => {
      queueMicrotask(onLost);
      return { setFace: vi.fn(), setHead: vi.fn(), resize: vi.fn(), dispose };
    });
    render(<InterviewerStage persona="DEVIL" />);

    await act(async () => {});

    expect(stage().dataset.state).toBe("failed");
  });

  it("화면을 떠나면 장면을 정리하고 캔버스를 뗀다", async () => {
    createInterviewerScene.mockResolvedValue({
      setFace: vi.fn(),
      setHead: vi.fn(),
      resize: vi.fn(),
      dispose,
    });
    const { container, unmount } = render(<InterviewerStage persona="DEVIL" />);
    await act(async () => {});
    const canvas = container.querySelector("canvas");
    expect(canvas).toBeTruthy();

    unmount();

    expect(dispose).toHaveBeenCalledTimes(1);
    expect(canvas?.isConnected).toBe(false);
  });
});
