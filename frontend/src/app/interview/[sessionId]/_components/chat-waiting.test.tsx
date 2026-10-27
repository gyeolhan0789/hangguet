import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useInterviewerPreloadStore } from "@/stores/interviewer-preload-store";

import { blockSpeed, ChatWaiting, overlap, PERFECT_PX } from "./chat-waiting";

// jsdom에는 애니메이션 프레임이 없어 사라지는 애니메이션이 끝나지 않는다. 나타남 · 사라짐만 보도록 바로 빼게 한다.
vi.mock("motion/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("motion/react")>()),
  useReducedMotion: () => true,
  AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
}));
// 3D 모델 받기는 경계다. 받기를 시작하는지만 보고, 상태는 테스트가 store에 직접 둔다.
const preloadInterviewer = vi.fn();
vi.mock("@/lib/interviewer/preload", () => ({
  preloadInterviewer: (...args: unknown[]) => preloadInterviewer(...args),
}));

// 기준: 사용자 요청(2026-10-27: 채팅 대기 화면 · 탑 쌓기 · 막대마다 속도 조금씩 다르게 · 퍼펙트 효과
// · 제목 '면접관이 면접을 준비하고 있어요' · 소제목 '간단한 게임으로 긴장을 풀어볼까요?')
// · 웹 Swagger 5.2(planStatus · planProgress) · 사용자 결정(2026-10-22: 진행률은 질문 준비 · 모델 받기 중 작은 쪽)

beforeEach(() => {
  preloadInterviewer.mockReset();
  useInterviewerPreloadStore.setState({ persona: "DEVIL", status: "loading", progress: 0.5 });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("탑 쌓기 규칙", () => {
  it(`아래 블록과 ${PERFECT_PX}px 안으로 맞추면 퍼펙트: 잘리지 않고 아래 블록에 딱 맞춘다`, () => {
    const below = { x: 100, w: 200 };
    expect(overlap(below, { x: 100 + PERFECT_PX, w: 200 })).toEqual({
      x: 100,
      w: 200,
      perfect: true,
    });
    expect(overlap(below, { x: 100 - PERFECT_PX, w: 200 })).toEqual({
      x: 100,
      w: 200,
      perfect: true,
    });
  });

  it("어긋나면 겹친 만큼만 남기고, 겹치지 않으면 끝(null)", () => {
    expect(overlap({ x: 100, w: 200 }, { x: 150, w: 200 })).toEqual({
      x: 150,
      w: 150,
      perfect: false,
    });
    expect(overlap({ x: 100, w: 200 }, { x: 40, w: 200 })).toEqual({
      x: 100,
      w: 140,
      perfect: false,
    });
    expect(overlap({ x: 100, w: 200 }, { x: 300, w: 200 })).toBeNull();
  });

  it("속도는 층이 오를수록 빨라지고(상한 있음), 막대마다 ±20% 안에서 다르다", () => {
    const slowest = () => 0;
    const fastest = () => 1;
    expect(blockSpeed(0, slowest)).toBeCloseTo(2.6 * 0.8);
    expect(blockSpeed(0, fastest)).toBeCloseTo(2.6 * 1.2);
    expect(blockSpeed(10, slowest)).toBeGreaterThan(blockSpeed(0, slowest));
    expect(blockSpeed(100, fastest)).toBeCloseTo(7 * 1.2);
  });
});

describe("ChatWaiting (채팅 대기 화면)", () => {
  const view = (props: Partial<Parameters<typeof ChatWaiting>[0]> = {}) => (
    <ChatWaiting
      open
      persona="DEVIL"
      planStatus="GENERATING"
      planProgress={80}
      onStart={vi.fn()}
      {...props}
    />
  );

  it("닫혀 있으면 그리지 않고 모델도 받지 않는다", () => {
    render(view({ open: false }));
    expect(screen.queryByRole("region")).toBeNull();
    expect(preloadInterviewer).not.toHaveBeenCalled();
  });

  it("제목 · 소제목 · 탑 쌓기를 보이고, 면접관 모델 받기를 시작한다", () => {
    render(view());
    const waiting = screen.getByRole("region", { name: "면접관이 면접을 준비하고 있어요" });
    expect(waiting.textContent).toContain("간단한 게임으로 긴장을 풀어볼까요?");
    expect(screen.getByLabelText("탑 쌓기 게임")).toBeTruthy();
    expect(preloadInterviewer).toHaveBeenCalledWith("DEVIL");
  });

  it("진행률은 질문 준비 · 모델 받기 중 작은 쪽이고, 둘 다 끝나기 전에는 [면접 시작]이 없다", () => {
    const { rerender } = render(view());
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("50");

    act(() => useInterviewerPreloadStore.setState({ progress: 0.95 }));
    rerender(view());
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("80");

    // 질문 준비는 끝났지만 모델이 아직이면 기다린다
    rerender(view({ planStatus: "READY", planProgress: null }));
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("95");
    expect(screen.queryByRole("button", { name: "면접 시작" })).toBeNull();
  });

  it("둘 다 끝나면 [면접 시작]을 보이고, 누르면 알린다", () => {
    const onStart = vi.fn();
    useInterviewerPreloadStore.setState({ status: "ready", progress: 1 });
    render(view({ planStatus: "READY", planProgress: null, onStart }));
    expect(screen.queryByRole("progressbar")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "면접 시작" }));
    expect(onStart).toHaveBeenCalledOnce();
  });

  it("모델 받기에 실패하면 '면접 준비에 실패했어요'와 [다시 시도](모델 다시 받기)를 보인다", () => {
    useInterviewerPreloadStore.setState({ status: "failed" });
    render(view());
    expect(screen.getByRole("alert").textContent).toContain("면접 준비에 실패했어요");
    preloadInterviewer.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(preloadInterviewer).toHaveBeenCalledExactlyOnceWith("DEVIL");
  });

  it("탭하면 블록을 떨어뜨려 층을 올리고, 다 잘리면 끝났다고 알린 뒤 탭으로 다시 한다", () => {
    // 블록은 애니메이션 프레임마다 움직인다. 프레임을 돌리지 않아 블록이 처음 자리에 머물게 한다(실행 속도와 무관하게).
    vi.spyOn(window, "requestAnimationFrame").mockImplementation(() => 0);
    render(view());
    const game = screen.getByLabelText("탑 쌓기 게임");
    // 첫 블록은 왼쪽 끝(0)에서 나오고 아래 블록은 가운데(90)라 겹친 만큼(130)만 남는다
    fireEvent.pointerDown(game);
    expect(screen.getByText("1층")).toBeTruthy();
    // 다음 블록은 오른쪽 끝(400 - 130 = 270)에서 나와 아래(90 ~ 220)와 겹치지 않는다(프레임을 돌리지 않아 움직이지 않는다)
    fireEvent.pointerDown(game);
    expect(screen.getByText("1층 쌓았어요")).toBeTruthy();

    fireEvent.pointerDown(game);
    expect(screen.queryByText("1층 쌓았어요")).toBeNull();
    expect(screen.getByText("0층")).toBeTruthy();
  });

  it("버튼에 초점이 있으면 스페이스를 가로채지 않는다([면접 시작]을 스페이스로 누를 수 있게)", () => {
    vi.spyOn(window, "requestAnimationFrame").mockImplementation(() => 0);
    useInterviewerPreloadStore.setState({ status: "ready", progress: 1 });
    render(view({ planStatus: "READY", planProgress: null }));
    const start = screen.getByRole("button", { name: "면접 시작" });
    const event = new KeyboardEvent("keydown", { code: "Space", bubbles: true, cancelable: true });
    start.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(screen.getByText("0층")).toBeTruthy();
  });

  it("스페이스로도 떨어뜨린다", () => {
    render(view());
    fireEvent.keyDown(window, { code: "Space" });
    expect(screen.getByText("1층")).toBeTruthy();
  });
});
