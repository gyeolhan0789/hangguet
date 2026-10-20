import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { FormActionResult } from "@/lib/api/problem-detail";

import { PLAN_POLL_MS, PlanProgress } from "./plan-progress";

// 기준: Figma S05 Preparing(18:2472) · Swagger 5.2(2초마다 다시 조회) · 5.3 면접 플랜 재생성
// · 기획 메모 S05(18:752: 생성 실패 시 재시도 안내)
// 다시 조회는 router.refresh(서버 컴포넌트가 5.2를 다시 부름), 재시도는 서버 액션 경계만 바꾼다.

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const retryPlan = vi.fn<(sessionId: number) => Promise<FormActionResult<never>>>();
vi.mock("@/lib/interview/actions", () => ({
  retryPlan: (sessionId: number) => retryPlan(sessionId),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("PlanProgress · 다시 조회(5.2)", () => {
  // 조회 간격만 가짜 타이머로 본다. 실패 · 재시도 쪽은 waitFor가 실제 타이머로 돌아야 해서 이 묶음 밖에 둔다.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("준비 중이면 진행률을 보여 주고, 다시 그리기가 끝날 때마다 2초 뒤 다시 조회한다", () => {
    render(<PlanProgress sessionId={55} status="GENERATING" progress={78} />);

    expect(screen.getByText("면접관이 질문을 준비하고 있어요")).toBeDefined();
    expect(screen.getByText("78%")).toBeDefined();
    expect(
      screen.getByRole("progressbar", { name: "질문 준비" }).getAttribute("aria-valuenow"),
    ).toBe("78");

    act(() => vi.advanceTimersByTime(PLAN_POLL_MS - 1));
    expect(refresh).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(refresh).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(PLAN_POLL_MS));
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("준비가 끝나면(READY) 100%를 보여 주고 더 조회하지 않는다", () => {
    const { rerender } = render(<PlanProgress sessionId={55} status="GENERATING" progress={78} />);

    rerender(<PlanProgress sessionId={55} status="READY" progress={null} />);
    act(() => vi.advanceTimersByTime(PLAN_POLL_MS * 3));

    expect(refresh).not.toHaveBeenCalled();
    expect(screen.getByText("면접관이 질문을 준비했어요")).toBeDefined();
    expect(screen.getByText("100%")).toBeDefined();
  });

  it("준비 중인데 진행률이 아직 없으면(null) 0%로 보여 준다", () => {
    render(<PlanProgress sessionId={55} status="GENERATING" progress={null} />);

    expect(screen.getByText("0%")).toBeDefined();
  });
});

describe("PlanProgress · 준비 실패(5.3)", () => {
  it("실패하면(FAILED) 조회를 멈추고 [다시 시도]로 5.3을 부른다", async () => {
    retryPlan.mockResolvedValue({});
    render(<PlanProgress sessionId={55} status="FAILED" progress={null} />);
    expect(screen.getByText("질문을 준비하지 못했어요")).toBeDefined();
    expect(screen.queryByRole("progressbar")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));

    expect(retryPlan).toHaveBeenCalledWith(55);
    // 다시 그리는 일(refresh)은 서버 액션이 한다. 성공하면 안내 문구가 없다.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "다시 시도" }).hasAttribute("disabled")).toBe(
        false,
      ),
    );
    expect(screen.queryByRole("alert")).toBeNull();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("5.3이 실패하면 안내 문구를 보여 준다", async () => {
    retryPlan.mockResolvedValue({ formError: "잠시 후 다시 시도해 주세요." });
    render(<PlanProgress sessionId={55} status="FAILED" progress={null} />);

    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));

    expect((await screen.findByRole("alert")).textContent).toBe("잠시 후 다시 시도해 주세요.");
  });
});
