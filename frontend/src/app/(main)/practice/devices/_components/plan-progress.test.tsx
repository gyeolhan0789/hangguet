import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { FormActionResult } from "@/lib/api/problem-detail";

import { PLAN_POLL_MS, PlanProgress, type ModelPreload } from "./plan-progress";

// 기준: Figma S05 Preparing(18:2472) · Swagger 5.2(2초마다 다시 조회) · 5.3 면접 플랜 재생성
// · 기획 메모 S05(18:752: 생성 실패 시 재시도 안내)
// · 사용자 결정(2026-10-22: 모델 받기와 합친 진행률(작은 쪽) · 실패 문구 '면접 준비에 실패했어요' · [다시 시도]는 실패한 쪽만
//   · 인터넷이 끊기면 조회를 멈췄다가 다시 연결되면 이어서)
// 다시 조회는 router.refresh(서버 컴포넌트가 5.2를 다시 부름), 재시도는 서버 액션 경계만 바꾼다.

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const retryPlan = vi.fn<(sessionId: number) => Promise<FormActionResult<never>>>();
vi.mock("@/lib/interview/actions", () => ({
  retryPlan: (sessionId: number) => retryPlan(sessionId),
}));

const onRetryModel = vi.fn();
const MODEL_READY: ModelPreload = { status: "ready", progress: 1 };

/** 모델은 다 받았다고 두고 질문 준비만 바꿔 본다 */
const plan = (
  status: "GENERATING" | "READY" | "FAILED",
  progress: number | null,
  model: ModelPreload = MODEL_READY,
) => (
  <PlanProgress
    sessionId={55}
    status={status}
    progress={progress}
    model={model}
    onRetryModel={onRetryModel}
  />
);

let online = true;
beforeEach(() => {
  online = true;
  vi.spyOn(navigator, "onLine", "get").mockImplementation(() => online);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
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
    render(plan("GENERATING", 78));

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
    const { rerender } = render(plan("GENERATING", 78));

    rerender(plan("READY", null));
    act(() => vi.advanceTimersByTime(PLAN_POLL_MS * 3));

    expect(refresh).not.toHaveBeenCalled();
    expect(screen.getByText("면접관이 질문을 준비했어요")).toBeDefined();
    expect(screen.getByText("100%")).toBeDefined();
  });

  it("준비 중인데 진행률이 아직 없으면(null) 0%로 보여 준다", () => {
    render(plan("GENERATING", null));

    expect(screen.getByText("0%")).toBeDefined();
  });

  it("인터넷이 끊기면 조회를 멈추고, 다시 연결되면 2초 뒤 이어서 조회한다", () => {
    online = false;
    render(plan("GENERATING", 78));

    act(() => vi.advanceTimersByTime(PLAN_POLL_MS * 5));
    expect(refresh).not.toHaveBeenCalled();

    online = true;
    act(() => window.dispatchEvent(new Event("online")));
    act(() => vi.advanceTimersByTime(PLAN_POLL_MS));
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});

describe("PlanProgress · 면접관 모델 받기", () => {
  it("질문 준비와 모델 받기 중 작은 쪽 진행률을 보여 준다", () => {
    const { rerender } = render(plan("GENERATING", 78, { status: "loading", progress: 0.305 }));
    expect(screen.getByText("30%")).toBeDefined();

    rerender(plan("GENERATING", 40, { status: "loading", progress: 0.9 }));
    expect(screen.getByText("40%")).toBeDefined();
  });

  it("질문 준비가 끝나도 모델을 받는 중이면 아직 준비 중으로 보여 준다", () => {
    render(plan("READY", null, { status: "loading", progress: 0.6 }));

    expect(screen.getByText("면접관이 질문을 준비하고 있어요")).toBeDefined();
    expect(screen.getByText("60%")).toBeDefined();
  });

  it("아직 받기 전(idle)이면 0%로 보여 준다", () => {
    render(plan("READY", null, { status: "idle", progress: 0 }));

    expect(screen.getByText("0%")).toBeDefined();
  });

  it("둘 다 끝나야 '면접관이 질문을 준비했어요' 100%", () => {
    render(plan("READY", null));

    expect(screen.getByText("면접관이 질문을 준비했어요")).toBeDefined();
    expect(screen.getByText("100%")).toBeDefined();
  });
});

describe("PlanProgress · 준비 실패(5.3)", () => {
  it("실패하면(FAILED) 조회를 멈추고 [다시 시도]로 5.3을 부른다", async () => {
    retryPlan.mockResolvedValue({});
    render(plan("FAILED", null));
    expect(screen.getByText("면접 준비에 실패했어요")).toBeDefined();
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
    render(plan("FAILED", null));

    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));

    expect((await screen.findByRole("alert")).textContent).toBe("잠시 후 다시 시도해 주세요.");
  });

  it("질문 준비만 실패했으면 [다시 시도]는 5.3만 부르고 모델은 다시 받지 않는다", async () => {
    retryPlan.mockResolvedValue({});
    render(plan("FAILED", null));

    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));

    expect(retryPlan).toHaveBeenCalledTimes(1);
    expect(onRetryModel).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "다시 시도" }).hasAttribute("disabled")).toBe(
        false,
      ),
    );
  });

  it("모델 받기만 실패했으면 같은 문구를 보여 주고, [다시 시도]는 모델만 다시 받는다", () => {
    render(plan("READY", null, { status: "failed", progress: 0.3 }));
    expect(screen.getByText("면접 준비에 실패했어요")).toBeDefined();
    expect(screen.queryByRole("progressbar")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));

    expect(onRetryModel).toHaveBeenCalledTimes(1);
    expect(retryPlan).not.toHaveBeenCalled();
  });

  it("둘 다 실패했으면 [다시 시도]가 둘 다 다시 한다", async () => {
    retryPlan.mockResolvedValue({});
    render(plan("FAILED", null, { status: "failed", progress: 0 }));

    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));

    expect(onRetryModel).toHaveBeenCalledTimes(1);
    expect(retryPlan).toHaveBeenCalledWith(55);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "다시 시도" }).hasAttribute("disabled")).toBe(
        false,
      ),
    );
  });
});
