// 기준: 사용자 요청(2026-10-27: 채팅 대기 화면 · 탑 쌓기 · 막대마다 속도를 조금씩 다르게 · 퍼펙트 효과 · 질문 준비가 끝나면 5.4를 미리 보낸다) · 웹 Swagger 5.2(planStatus · planProgress) · 사용자 결정(2026-10-22: 진행률은 질문 준비 · 모델 받기 중 작은 쪽)
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { preloadInterviewer } from "@/lib/interviewer/preload";
import { useInterviewerPreloadStore } from "@/stores/interviewer-preload-store";

import { blockSpeed, ChatWaiting, overlap } from "./chat-waiting";

// 경계 mock: 3D 모델 받기 · 연출(motion) · 캔버스 2D 컨텍스트(jsdom에 없음) · 난수(블록 속도). 그리기 프레임은 가짜 타이머로 진행한다
vi.mock("@/lib/interviewer/preload", () => ({ preloadInterviewer: vi.fn() }));
vi.mock("motion/react", async (importOriginal) =>
  (await import("@/test/motion")).reducedMotion(importOriginal),
);

const fakeContext = {
  clearRect: () => {},
  beginPath: () => {},
  roundRect: () => {},
  fill: () => {},
  createLinearGradient: () => ({ addColorStop: () => {} }),
};
const half = () => 0.5;

function renderWaiting(props: Partial<Parameters<typeof ChatWaiting>[0]> = {}) {
  const all = {
    open: true,
    persona: "DEVIL" as const,
    planStatus: "GENERATING" as const,
    planProgress: 80,
    started: true,
    onStart: vi.fn(),
    ...props,
  };
  return { ...render(<ChatWaiting {...all} />), props: all };
}

const progress = () => screen.getByRole("progressbar", { name: "면접 준비" }).getAttribute("value");
const startButton = () => screen.queryByRole("button", { name: "면접 시작" });
const game = () => screen.getByLabelText("탑 쌓기 게임");
const frames = (count: number) =>
  act(() => {
    for (let i = 0; i < count; i++) vi.advanceTimersToNextFrame();
  });

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(Math, "random").mockReturnValue(0.5);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
    fakeContext as unknown as CanvasRenderingContext2D,
  );
  useInterviewerPreloadStore.setState({ persona: "DEVIL", status: "loading", progress: 0.5 });
});

describe("overlap · 떨어뜨린 블록 겹침", () => {
  describe("정상 처리", () => {
    it("어긋나게 떨어뜨리면 겹친 부분만 남긴다", () => {
      expect(overlap({ x: 100, w: 200 }, { x: 150, w: 200 })).toEqual({
        x: 150,
        w: 150,
        perfect: false,
      });
    });

    it("겹치지 않으면 null을 돌려준다", () => {
      expect(overlap({ x: 100, w: 200 }, { x: 350, w: 200 })).toBeNull();
    });
  });

  describe("경계값", () => {
    it("아래 블록과 4px 차이면 아래 블록 자리 · 너비로 맞춘 퍼펙트다", () => {
      expect(overlap({ x: 100, w: 200 }, { x: 104, w: 180 })).toEqual({
        x: 100,
        w: 200,
        perfect: true,
      });
    });

    it("아래 블록과 5px 어긋나면 퍼펙트가 아니다", () => {
      expect(overlap({ x: 100, w: 200 }, { x: 105, w: 200 })).toEqual({
        x: 105,
        w: 195,
        perfect: false,
      });
    });

    it("가장자리만 닿으면(겹친 너비 0) null을 돌려준다", () => {
      expect(overlap({ x: 100, w: 200 }, { x: 300, w: 200 })).toBeNull();
    });
  });
});

describe("blockSpeed · 블록 속도", () => {
  describe("정상 처리", () => {
    it("층이 오를수록 빨라진다", () => {
      expect(blockSpeed(10, half)).toBeGreaterThan(blockSpeed(0, half));
    });
  });

  describe("경계값", () => {
    it("아무리 높이 올라가도 기본 속도는 7을 넘지 않는다", () => {
      expect(blockSpeed(100, half)).toBeCloseTo(7);
    });

    it("난수가 가장 크면 기본 속도의 1.2배다", () => {
      expect(blockSpeed(0, () => 1) / blockSpeed(0, half)).toBeCloseTo(1.2);
    });
  });
});

describe("ChatWaiting · 채팅 대기 화면", () => {
  describe("준비 상태", () => {
    describe("화면 표시", () => {
      it("닫혀 있으면 그리지 않는다", () => {
        renderWaiting({ open: false });

        expect(screen.queryByRole("region")).toBeNull();
      });

      it.each([
        { label: "모델 받기가 작음", model: 0.5, percent: "50" },
        { label: "질문 준비가 작음", model: 0.95, percent: "80" },
      ])("'$label'이면 진행률은 질문 준비와 모델 받기 중 작은 쪽이다", ({ model, percent }) => {
        useInterviewerPreloadStore.setState({ progress: model });

        renderWaiting({ planProgress: 80 });

        expect(progress()).toBe(percent);
      });

      it("다른 면접관의 모델 받기 상태는 쓰지 않는다", () => {
        useInterviewerPreloadStore.setState({ persona: "DUCK", status: "ready", progress: 1 });

        renderWaiting({ planStatus: "READY", planProgress: null });

        expect(progress()).toBe("0");
        expect(startButton()).toBeNull();
      });

      it.each([
        { label: "질문 준비", planStatus: "GENERATING", model: "ready", started: true },
        { label: "모델 받기", planStatus: "READY", model: "loading", started: true },
        { label: "미리 시작", planStatus: "READY", model: "ready", started: false },
      ] as const)(
        "'$label'이 끝나지 않았으면 [면접 시작]을 보이지 않는다",
        ({ planStatus, model, started }) => {
          useInterviewerPreloadStore.setState({ status: model, progress: 1 });

          renderWaiting({ planStatus, planProgress: null, started });

          expect(startButton()).toBeNull();
        },
      );

      it("질문 준비 · 모델 받기 · 미리 시작이 모두 끝나면 [면접 시작]을 보인다", () => {
        useInterviewerPreloadStore.setState({ status: "ready", progress: 1 });

        renderWaiting({ planStatus: "READY", planProgress: null, started: true });

        expect(startButton()).not.toBeNull();
        expect(screen.queryByRole("progressbar")).toBeNull();
      });

      it("모델 받기에 실패하면 '면접 준비에 실패했어요'와 [다시 시도]를 보인다", () => {
        useInterviewerPreloadStore.setState({ status: "failed" });

        renderWaiting();

        expect(screen.getByRole("alert").textContent).toContain("면접 준비에 실패했어요");
        expect(screen.getByRole("button", { name: "다시 시도" })).toBeDefined();
      });

      it("미리 시작이 실패했으면 진행 막대 아래에 서버 문구를 보인다", () => {
        renderWaiting({ started: false, startError: "지금은 할 수 없는 요청이에요." });

        expect(progress()).toBe("50");
        expect(screen.getByRole("alert").textContent).toBe("지금은 할 수 없는 요청이에요.");
      });

      it("열리면 그 면접관 모델 받기를 시작한다", () => {
        renderWaiting();

        expect(preloadInterviewer).toHaveBeenCalledWith("DEVIL");
      });

      it("닫혀 있으면 모델을 받지 않는다", () => {
        renderWaiting({ open: false });

        expect(preloadInterviewer).not.toHaveBeenCalled();
      });
    });

    describe("사용자 조작", () => {
      it("[다시 시도]를 누르면 그 면접관 모델을 다시 받는다", () => {
        useInterviewerPreloadStore.setState({ status: "failed" });
        renderWaiting();
        vi.mocked(preloadInterviewer).mockClear();

        fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));

        expect(preloadInterviewer).toHaveBeenCalledExactlyOnceWith("DEVIL");
      });
    });

    describe("경계값", () => {
      it("질문 준비가 끝났으면(READY) 질문 준비를 100%로 본다", () => {
        useInterviewerPreloadStore.setState({ progress: 1 });

        renderWaiting({ planStatus: "READY", planProgress: 30 });

        expect(progress()).toBe("100");
      });

      it("질문 준비 진행률이 없으면(null) 0%로 본다", () => {
        renderWaiting({ planStatus: "GENERATING", planProgress: null });

        expect(progress()).toBe("0");
      });
    });
  });

  describe("탑 쌓기", () => {
    describe("화면 표시", () => {
      it("퍼펙트로 맞추면 '퍼펙트!'를 보인다", () => {
        renderWaiting();
        // 블록이 왼쪽 끝(0)에서 프레임마다 2.6씩 움직여 35프레임 뒤 91에 온다(아래 블록 90)
        frames(35);

        fireEvent.pointerDown(game());

        expect(screen.getByText("퍼펙트!")).toBeDefined();
      });

      it("연달아 퍼펙트면 횟수를 붙여 보인다", () => {
        renderWaiting();
        frames(35);
        fireEvent.pointerDown(game());
        // 다음 블록은 오른쪽 끝(180)에서 프레임마다 2.82씩 와 32프레임 뒤 89.76에 온다
        frames(32);

        fireEvent.pointerDown(game());

        expect(screen.getByText("퍼펙트! ×2")).toBeDefined();
      });

      it("퍼펙트 뒤 어긋나게 쌓으면 퍼펙트 표시를 내린다", () => {
        renderWaiting();
        frames(35);
        fireEvent.pointerDown(game());

        fireEvent.pointerDown(game());

        expect(screen.queryByText(/퍼펙트!/)).toBeNull();
        expect(screen.getByText("2층")).toBeDefined();
      });
    });

    describe("사용자 조작", () => {
      it("탭하면 블록을 쌓아 층을 올린다", () => {
        renderWaiting();

        fireEvent.pointerDown(game());

        expect(screen.getByText("1층")).toBeDefined();
      });

      it("다 잘리면 몇 층 쌓았는지 알린다", () => {
        renderWaiting();
        // 첫 블록은 왼쪽 끝(0)에서 그대로 떨어져 130만 남고, 다음 블록은 오른쪽 끝(270)이라 겹치지 않는다
        fireEvent.pointerDown(game());

        fireEvent.pointerDown(game());

        expect(screen.getByText("1층 쌓았어요")).toBeDefined();
      });

      it("끝난 뒤 탭하면 처음부터 다시 한다", () => {
        renderWaiting();
        fireEvent.pointerDown(game());
        fireEvent.pointerDown(game());

        fireEvent.pointerDown(game());

        expect(screen.queryByText("1층 쌓았어요")).toBeNull();
        expect(screen.getByText("0층")).toBeDefined();
      });

      it("스페이스를 누르면 블록을 떨어뜨린다", () => {
        renderWaiting();

        fireEvent.keyDown(window, { code: "Space" });

        expect(screen.getByText("1층")).toBeDefined();
      });

      it("스페이스를 누른 채 반복 입력이면 떨어뜨리지 않는다", () => {
        renderWaiting();

        fireEvent.keyDown(window, { code: "Space", repeat: true });

        expect(screen.getByText("0층")).toBeDefined();
      });

      it("버튼에 초점이 있으면 스페이스를 가로채지 않는다", () => {
        useInterviewerPreloadStore.setState({ status: "ready", progress: 1 });
        renderWaiting({ planStatus: "READY", planProgress: null });
        const event = new KeyboardEvent("keydown", {
          code: "Space",
          bubbles: true,
          cancelable: true,
        });

        screen.getByRole("button", { name: "면접 시작" }).dispatchEvent(event);

        expect(event.defaultPrevented).toBe(false);
        expect(screen.getByText("0층")).toBeDefined();
      });

      it("블록이 캔버스 끝에 닿으면 반대로 움직인다", () => {
        renderWaiting();
        // 프레임마다 2.6씩 움직여 70프레임 뒤 오른쪽 끝(182)에서 돌아서고, 35프레임 더 가면 91(아래 블록 90)에 온다
        frames(105);

        fireEvent.pointerDown(game());

        expect(screen.getByText("퍼펙트!")).toBeDefined();
      });
    });

    describe("정리", () => {
      it("화면을 떠나면 그리기를 멈춘다", () => {
        const clearRect = vi.spyOn(fakeContext, "clearRect");
        const { unmount } = renderWaiting();
        frames(60);

        unmount();
        clearRect.mockClear();
        frames(60);

        expect(clearRect).not.toHaveBeenCalled();
      });
    });
  });
});
