import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { motionValue } from "motion/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AnswerNotice, MicToast, SelfCamera, SILENT_TOAST_MS, VideoControls } from "./video-panel";

// jsdom에는 애니메이션 프레임이 없어 사라지는 애니메이션이 끝나지 않는다. 나타남 · 사라짐만 보도록 바로 빼게 한다.
vi.mock("motion/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("motion/react")>()),
  useReducedMotion: () => true,
  AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
}));

// 기준: Figma S06 Self Camera · STT Bubble Bottom(18:2519 · 18:2539) · S06-F Mic Toast(18:4421) · S06-A 답변 상태 토스트
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

  it("내 답변 상자 맨 아래 줄은 파형만 있고(마이크 · [답변 완료] 없음), 질문을 말하는 중(locked)이면 흐리게 한다", () => {
    const { rerender } = render(<VideoControls level={motionValue(0)} />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("img", { name: "마이크 듣는 중" })).toBeNull();
    const wave = () => screen.getByTestId("waveform").parentElement?.className;
    expect(wave()).not.toContain("opacity-30");
    rerender(<VideoControls level={motionValue(0)} locked />);
    expect(wave()).toContain("opacity-30");
  });
});

describe("AnswerNotice (S06-A 답변 상태 토스트)", () => {
  it("버튼이 없으면 상태 알림으로 문구만 보인다", () => {
    render(<AnswerNotice message="음성 인식을 다시 연결하는 중…" />);
    expect(screen.getByRole("status").textContent).toBe("음성 인식을 다시 연결하는 중…");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("버튼이 있으면 경고 알림으로 오른쪽에 두고, 누르면 알린다", () => {
    const onClick = vi.fn();
    render(
      <AnswerNotice message="답변을 저장하지 못했어요" action={{ label: "다시 시도", onClick }} />,
    );
    expect(screen.getByRole("alert").textContent).toContain("답변을 저장하지 못했어요");
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(onClick).toHaveBeenCalledOnce();
  });
});
