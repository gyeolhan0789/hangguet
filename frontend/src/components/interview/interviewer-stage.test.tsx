import { act, cleanup, render, screen } from "@testing-library/react";
import { Activity } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { InterviewerStage } from "./interviewer-stage";

vi.mock("motion/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("motion/react")>()),
  useReducedMotion: () => true,
}));

// three.js 장면(WebGL)은 jsdom에서 그릴 수 없어 경계만 바꾼다. 실제 3D는 E2E(interview.spec.ts)가 본다.
const dispose = vi.fn();
const createInterviewerScene = vi.fn();
vi.mock("@/lib/interviewer/scene", () => ({
  createInterviewerScene: (...args: unknown[]) => createInterviewerScene(...args),
}));

// 기준: 면접관 표현 결정 ③-3(WebGL 미지원 · 로드 실패 · 컨텍스트 손실이면 정지 이미지)
// · 사용자 결정(2026-10-22: 큰 모델이라 시간 제한(③-3의 10초 Timeout) 없이 받는 중이면 로딩 표시를 계속 둔다)
// · Next.js Preserving UI state(Activity: 떠난 화면을 숨겨 두었다가 돌아오면 효과를 다시 실행)
// · 사용자 요청(2026-10-21: 면접관 로딩 화면 — S06-1 Thinking Avatar) · Swagger 5.1 Persona

beforeEach(() => {
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
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const stage = () => screen.getByTestId("interviewer-stage");
const loading = () => screen.queryByRole("status", { name: "면접관을 불러오는 중" });

describe("InterviewerStage (면접관 3D 장면)", () => {
  it("3D 모델이 없는 면접관(커피챗)이면 아무것도 그리지 않는다", () => {
    const { container } = render(<InterviewerStage persona="COFFEE_CHAT" />);
    expect(container.innerHTML).toBe("");
    expect(createInterviewerScene).not.toHaveBeenCalled();
  });

  it("불러오는 동안 면접관 썸네일 로딩 표시를 두고, 다 불러오면 3D로 바꾼다", async () => {
    let resolve!: (scene: unknown) => void;
    createInterviewerScene.mockReturnValue(new Promise((done) => (resolve = done)));
    render(<InterviewerStage persona="DEVIL" />);

    expect(stage().dataset.state).toBe("loading");
    expect(loading()).toBeTruthy();
    expect(screen.getByRole("img", { name: "악마 면접관" })).toBeTruthy();

    await act(async () => resolve({ setFace: vi.fn(), resize: vi.fn(), dispose }));

    expect(stage().dataset.state).toBe("ready");
    expect(loading()).toBeNull();
    expect(createInterviewerScene).toHaveBeenCalledWith(
      expect.objectContaining({
        model: {
          glb: "/interview/devil/interviewer.glb",
          faceRules: "/interview/devil/face-rules.json",
          animation: "/interview/devil/animation.json",
        },
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

    await act(async () => resolve({ setFace: vi.fn(), resize: vi.fn(), dispose }));
    expect(stage().dataset.state).toBe("ready");
  });

  it("다 받기 전에 화면을 떠나면, 늦게 끝난 장면은 바로 정리한다", async () => {
    let resolve!: (scene: unknown) => void;
    createInterviewerScene.mockReturnValue(new Promise((done) => (resolve = done)));
    const { unmount } = render(<InterviewerStage persona="DEVIL" />);

    unmount();
    await act(async () => resolve({ setFace: vi.fn(), resize: vi.fn(), dispose }));

    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("숨겨졌다(Activity) 다시 보이면 로딩 표시부터 두고 장면을 새로 만든다", async () => {
    createInterviewerScene.mockResolvedValue({ setFace: vi.fn(), resize: vi.fn(), dispose });
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

    await act(async () => resolve({ setFace: vi.fn(), resize: vi.fn(), dispose }));
    expect(stage().dataset.state).toBe("ready");
  });

  it("WebGL 컨텍스트를 잃으면(onLost) 정지 이미지로 바꾼다", async () => {
    createInterviewerScene.mockImplementation(async ({ onLost }: { onLost: () => void }) => {
      queueMicrotask(onLost);
      return { setFace: vi.fn(), resize: vi.fn(), dispose };
    });
    render(<InterviewerStage persona="DEVIL" />);

    await act(async () => {});

    expect(stage().dataset.state).toBe("failed");
  });

  it("화면을 떠나면 장면을 정리하고 캔버스를 뗀다", async () => {
    createInterviewerScene.mockResolvedValue({ setFace: vi.fn(), resize: vi.fn(), dispose });
    const { container, unmount } = render(<InterviewerStage persona="DEVIL" />);
    await act(async () => {});
    const canvas = container.querySelector("canvas");
    expect(canvas).toBeTruthy();

    unmount();

    expect(dispose).toHaveBeenCalledTimes(1);
    expect(canvas?.isConnected).toBe(false);
  });
});
