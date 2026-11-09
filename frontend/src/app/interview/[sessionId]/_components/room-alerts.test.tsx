import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  PausedModal,
  ReconnectBanner,
  RESTART_WAIT_SECONDS,
  StartFailedModal,
  useReconnectSeconds,
} from "./room-alerts";

// jsdom에는 애니메이션 프레임이 없어 사라지는 애니메이션이 끝나지 않는다. 나타남 · 사라짐만 보도록 바로 빼게 한다.
vi.mock("motion/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("motion/react")>()),
  useReducedMotion: () => true,
  AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
}));

// 기준: Figma S06-F 연결 끊김(18:4323) · S06-F2 면접관 연결 실패(345:1815) · 기획 메모 S06-F(18:3575) · S06-F2(340:1886)

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("ReconnectBanner · useReconnectSeconds (S06-F 연결이 불안정해요)", () => {
  it("배너는 지난 초를 함께 알린다", () => {
    render(<ReconnectBanner seconds={3} />);
    expect(screen.getByRole("status").textContent).toBe(
      "연결이 불안정해요 · 다시 연결하는 중… 3초",
    );
  });

  it("다시 연결하는 동안 1초마다 세고, 연결되면 0으로 돌아가 다음에 처음부터 센다", () => {
    const { result, rerender } = renderHook(({ on }) => useReconnectSeconds(on), {
      initialProps: { on: true },
    });
    expect(result.current).toBe(0);
    act(() => vi.advanceTimersByTime(2000));
    expect(result.current).toBe(2);

    rerender({ on: false });
    expect(result.current).toBe(0);
    act(() => vi.advanceTimersByTime(3000));
    expect(result.current).toBe(0);

    rerender({ on: true });
    act(() => vi.advanceTimersByTime(1000));
    expect(result.current).toBe(1);
  });
});

describe("PausedModal (S06-F 면접이 잠시 멈췄어요)", () => {
  it("닫혀 있으면 그리지 않는다", () => {
    render(<PausedModal open={false} onEnd={vi.fn()} onRetry={vi.fn()} />);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("안내 문구와 [면접 끝내기] · [다시 시도]를 보이고, 각 버튼이 알린다", () => {
    const onEnd = vi.fn();
    const onRetry = vi.fn();
    render(<PausedModal open onEnd={onEnd} onRetry={onRetry} />);
    const dialog = screen.getByRole("alertdialog", { name: "면접이 잠시 멈췄어요" });
    expect(dialog.textContent).toContain("답하던 질문은 처음부터 다시 답해요");
    // 열리면 마지막 버튼([다시 시도])에 초점이 간다
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "다시 시도" }));

    fireEvent.click(screen.getByRole("button", { name: "면접 끝내기" }));
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(onEnd).toHaveBeenCalledOnce();
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("Tab은 모달 안 버튼 사이에서만 돈다", () => {
    render(<PausedModal open onEnd={vi.fn()} onRetry={vi.fn()} />);
    const dialog = screen.getByRole("alertdialog");
    const end = screen.getByRole("button", { name: "면접 끝내기" });
    const retry = screen.getByRole("button", { name: "다시 시도" });

    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(document.activeElement).toBe(end);
    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(retry);
  });
});

describe("StartFailedModal (S06-F2 면접관을 연결하지 못했어요)", () => {
  const dialog = () => screen.getByRole("alertdialog", { name: "면접관을 연결하지 못했어요" });
  const restart = () => screen.getByRole("button", { name: "다시 시작" });

  it("열리면 [다시 시작]을 RESTART_WAIT_SECONDS 동안 막고 남은 초를 보이다가, 다 지나면 누를 수 있다", () => {
    const onRestart = vi.fn();
    render(<StartFailedModal open restarting={false} onLeave={vi.fn()} onRestart={onRestart} />);
    expect(restart()).toHaveProperty("disabled", true);
    expect(restart().textContent).toContain(`(${RESTART_WAIT_SECONDS}초)`);
    expect(dialog().textContent).toContain("잠시 뒤 다시 시작할 수 있어요");
    // 남은 초는 버튼 이름에 넣지 않는다(위 getByRole이 이름 '다시 시작'으로 찾는다)

    act(() => vi.advanceTimersByTime((RESTART_WAIT_SECONDS - 1) * 1000));
    expect(restart()).toHaveProperty("disabled", true);
    expect(restart().textContent).toContain("(1초)");
    fireEvent.click(restart());
    expect(onRestart).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(1000));
    expect(restart()).toHaveProperty("disabled", false);
    expect(restart().textContent).not.toContain("초)");
    expect(dialog().textContent).toContain("다시 시작해 주세요");
  });

  it("닫혔다 다시 열리면 처음부터 다시 센다", () => {
    const props = { restarting: false, onLeave: vi.fn(), onRestart: vi.fn() };
    const { rerender } = render(<StartFailedModal open {...props} />);
    act(() => vi.advanceTimersByTime(RESTART_WAIT_SECONDS * 1000));
    expect(restart()).toHaveProperty("disabled", false);

    rerender(<StartFailedModal open={false} {...props} />);
    rerender(<StartFailedModal open {...props} />);
    expect(restart()).toHaveProperty("disabled", true);
    expect(restart().textContent).toContain(`(${RESTART_WAIT_SECONDS}초)`);
  });

  it("[나가기]는 기다리는 동안에도 · [다시 시작]은 기다린 뒤 각각 알린다", () => {
    const onLeave = vi.fn();
    const onRestart = vi.fn();
    render(<StartFailedModal open restarting={false} onLeave={onLeave} onRestart={onRestart} />);
    fireEvent.click(screen.getByRole("button", { name: "나가기" }));
    expect(onLeave).toHaveBeenCalledOnce();

    act(() => vi.advanceTimersByTime(RESTART_WAIT_SECONDS * 1000));
    fireEvent.click(restart());
    expect(onRestart).toHaveBeenCalledOnce();
  });

  it("다시 시작하는 중에는 두 버튼을 막고, 실패하면 서버 문구를 보인다", () => {
    const { rerender } = render(
      <StartFailedModal open restarting onLeave={vi.fn()} onRestart={vi.fn()} />,
    );
    act(() => vi.advanceTimersByTime(RESTART_WAIT_SECONDS * 1000));
    const restart = screen.getByRole("button", { name: "다시 시작" });
    expect(restart).toHaveProperty("disabled", true);
    expect(restart.getAttribute("aria-busy")).toBe("true");
    expect(screen.getByRole("button", { name: "나가기" })).toHaveProperty("disabled", true);

    rerender(
      <StartFailedModal
        open
        restarting={false}
        error="면접관을 배정하지 못했어요"
        onLeave={vi.fn()}
        onRestart={vi.fn()}
      />,
    );
    const dialog = screen.getByRole("alertdialog");
    expect(dialog.textContent).toContain("면접관을 배정하지 못했어요");
    expect(dialog.textContent).not.toContain("다시 시작해 주세요");
  });
});
