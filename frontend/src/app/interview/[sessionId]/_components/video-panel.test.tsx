import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { motionValue } from "motion/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MicToast, SelfCamera, SILENT_TOAST_MS, VideoControls } from "./video-panel";

// jsdom에는 애니메이션 프레임이 없어 사라지는 애니메이션이 끝나지 않는다. 나타남 · 사라짐만 보도록 바로 빼게 한다.
vi.mock("motion/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("motion/react")>()),
  useReducedMotion: () => true,
  AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
}));

// 기준: Figma S06 Self Camera · Controls(18:2519 · 18:2544) · S06-F Mic Toast(18:4421)
// · 기획 메모 S06-F(18:3575: 마이크 입력이 10초 이상 0이면 하단 토스트, 화상에서만)

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const TOAST = "마이크 소리가 들리지 않아요";

describe("MicToast (S06-F 마이크 끊김)", () => {
  it("마이크 입력이 10초 넘게 0이면 토스트를 띄운다", () => {
    const level = motionValue(0);
    render(<MicToast level={level} />);

    act(() => vi.advanceTimersByTime(SILENT_TOAST_MS - 1000));
    expect(screen.queryByText(TOAST)).toBeNull();
    act(() => vi.advanceTimersByTime(1000));

    expect(screen.getByText(TOAST)).toBeTruthy();
    expect(screen.getByText("마이크 확인")).toBeTruthy();
  });

  it("소리가 들어오면 0이 이어진 시간을 처음부터 다시 세고, 떠 있던 토스트를 내린다", () => {
    const level = motionValue(0);
    render(<MicToast level={level} />);

    act(() => vi.advanceTimersByTime(SILENT_TOAST_MS - 2000));
    act(() => level.set(0.4));
    act(() => level.set(0));
    act(() => vi.advanceTimersByTime(SILENT_TOAST_MS - 2000));
    expect(screen.queryByText(TOAST)).toBeNull();

    act(() => vi.advanceTimersByTime(3000));
    expect(screen.getByText(TOAST)).toBeTruthy();
    act(() => level.set(0.3));
    expect(screen.queryByText(TOAST)).toBeNull();
  });
});

describe("SelfCamera · VideoControls", () => {
  it("카메라가 없으면 사람 아이콘과 '나' 칩만 보이고, 영상은 숨긴다", () => {
    render(<SelfCamera stream={null} />);
    expect(screen.getByText("나")).toBeTruthy();
    expect(screen.getByLabelText("내 카메라 화면").className).toContain("hidden");
  });

  it("[답변 완료]는 낼 수 있을 때(canSubmit)만 누를 수 있고, 누르면 알린다", () => {
    const onSubmit = vi.fn();
    const { rerender } = render(<VideoControls level={motionValue(0)} onSubmit={onSubmit} />);
    const button = () => screen.getByRole("button", { name: "답변 완료" });
    expect(button()).toHaveProperty("disabled", true);
    expect(screen.getByRole("img", { name: "마이크 듣는 중" })).toBeTruthy();

    rerender(<VideoControls level={motionValue(0)} canSubmit onSubmit={onSubmit} />);
    fireEvent.click(button());
    expect(onSubmit).toHaveBeenCalledTimes(1);

    // 내는 중에는 누를 수 없고 바쁨을 알린다
    rerender(<VideoControls level={motionValue(0)} canSubmit submitting onSubmit={onSubmit} />);
    expect(button()).toHaveProperty("disabled", true);
    expect(button().getAttribute("aria-busy")).toBe("true");
  });
});
