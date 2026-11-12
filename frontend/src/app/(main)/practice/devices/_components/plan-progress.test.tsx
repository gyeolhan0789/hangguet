// 기준: Figma S05 Preparing(18:2472) · Swagger 5.2 면접 조회(planStatus · planProgress, 2초마다) · 5.3 면접 플랜 재생성
// · 기획 메모 S05(18:752: 생성 실패 시 재시도 안내) · 사용자 결정(2026-10-22: 진행률은 질문 준비 · 모델 받기 중 작은 쪽,
//   실패 문구는 '면접 준비에 실패했어요' 하나, [다시 시도]는 실패한 쪽만, 인터넷이 끊기면 조회를 멈췄다가 다시 연결되면 이어서)
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { FormActionResult } from "@/lib/api/problem-detail";
import { retryPlan } from "@/lib/interview/actions";
import { deferred } from "@/test/deferred";
import { router } from "@/test/next-navigation";

import { PLAN_POLL_MS, PlanProgress, type ModelPreload } from "./plan-progress";

// 경계 mock: 서버 액션(5.3) · Next 라우터(다시 그리기 = 5.2 다시 조회) · 연출(motion) · navigator.onLine(getter만) · 시간(가짜 타이머)
vi.mock("@/lib/interview/actions", () => ({ retryPlan: vi.fn() }));
vi.mock("next/navigation", () => import("@/test/next-navigation"));
vi.mock("motion/react", async (importOriginal) =>
  (await import("@/test/motion")).reducedMotion(importOriginal),
);

let online: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.useFakeTimers();
  online = vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
});

// 예시 데이터: Swagger 5.2 200 예시(면접 55 · GENERATING 78%)
// · 실패 문구는 Swagger 5.3 409 PLAN_NOT_FAILED 예시 detail(대체 문구 RETRY_LATER와 다르다)
const SERVER_DETAIL = "면접 준비가 실패한 상태가 아니에요.";
const MODEL_READY: ModelPreload = { status: "ready", progress: 1 };
const FAILED: FormActionResult<never> = { formError: SERVER_DETAIL };
const onRetryModel = vi.fn();

function plan(
  status: "GENERATING" | "READY" | "FAILED",
  progress: number | null,
  model: ModelPreload = MODEL_READY,
) {
  return (
    <PlanProgress
      sessionId={55}
      status={status}
      progress={progress}
      model={model}
      onRetryModel={onRetryModel}
    />
  );
}

const advance = (ms: number) => act(() => vi.advanceTimersByTime(ms));
const retryButton = () => screen.getByRole("button", { name: "다시 시도" });

/** [다시 시도]를 누르고, 테스트가 응답을 정하는 5.3 요청 하나를 돌려준다 */
function retryWith() {
  const response = deferred<FormActionResult<never>>();
  vi.mocked(retryPlan).mockReturnValueOnce(response.promise);
  fireEvent.click(retryButton());
  return response;
}

describe("PlanProgress · 질문 준비 진행", () => {
  describe("질문 준비 조회", () => {
    describe("시간 경과", () => {
      it("준비 중이면 2초마다 화면을 다시 그려 다시 조회한다", () => {
        render(plan("GENERATING", 78));

        advance(PLAN_POLL_MS - 1);
        expect(router.refresh).not.toHaveBeenCalled();
        advance(1);
        expect(router.refresh).toHaveBeenCalledTimes(1);
        advance(PLAN_POLL_MS);
        expect(router.refresh).toHaveBeenCalledTimes(2);
      });

      it.each(["READY", "FAILED"] as const)("질문 준비가 '%s'면 다시 조회하지 않는다", (status) => {
        render(plan(status, null));

        advance(PLAN_POLL_MS * 2);

        expect(router.refresh).not.toHaveBeenCalled();
      });

      it("인터넷이 끊기면 조회를 멈추고 다시 연결되면 2초 뒤 이어서 조회한다", () => {
        render(plan("GENERATING", 78));
        advance(PLAN_POLL_MS / 2);

        online.mockReturnValue(false);
        act(() => void window.dispatchEvent(new Event("offline")));
        advance(PLAN_POLL_MS * 2);
        expect(router.refresh).not.toHaveBeenCalled();

        online.mockReturnValue(true);
        act(() => void window.dispatchEvent(new Event("online")));
        advance(PLAN_POLL_MS - 1);
        expect(router.refresh).not.toHaveBeenCalled();
        advance(1);
        expect(router.refresh).toHaveBeenCalledTimes(1);
      });
    });

    describe("정리", () => {
      it("화면을 떠나면 예약한 다시 조회를 취소한다", () => {
        const { unmount } = render(plan("GENERATING", 78));

        unmount();
        advance(PLAN_POLL_MS);

        expect(router.refresh).not.toHaveBeenCalled();
      });
    });
  });

  describe("진행률", () => {
    describe("화면 표시", () => {
      it("질문 준비와 모델 받기 중 작은 쪽 진행률을 보여 준다", () => {
        render(plan("GENERATING", 78, { status: "loading", progress: 0.4 }));

        expect(screen.getByText("40%")).toBeDefined();
      });

      it("준비 중인데 진행률이 아직 없으면 0%로 보여 준다", () => {
        render(plan("GENERATING", null));

        expect(screen.getByText("0%")).toBeDefined();
      });

      it("질문 준비가 끝나도 모델을 받는 중이면 '준비하고 있어요'와 모델 진행률을 보여 준다", () => {
        render(plan("READY", null, { status: "loading", progress: 0.4 }));

        expect(screen.getByText("면접관이 질문을 준비하고 있어요")).toBeDefined();
        expect(screen.getByText("40%")).toBeDefined();
      });

      it("질문 준비와 모델 받기가 모두 끝나면 '면접관이 질문을 준비했어요'와 100%를 보여 준다", () => {
        render(plan("READY", null));

        expect(screen.getByText("면접관이 질문을 준비했어요")).toBeDefined();
        expect(screen.getByText("100%")).toBeDefined();
      });
    });

    describe("경계값", () => {
      it.each([
        { progress: -5, percent: "0%" },
        { progress: 120, percent: "100%" },
      ])(
        "질문 준비 진행률이 '$progress'면 '$percent'로 잘라 보여 준다",
        ({ progress, percent }) => {
          render(plan("GENERATING", progress));

          expect(screen.getByText(percent)).toBeDefined();
        },
      );

      it("모델 진행률은 소수점 아래를 버린다", () => {
        render(plan("GENERATING", 100, { status: "loading", progress: 0.999 }));

        expect(screen.getByText("99%")).toBeDefined();
      });
    });
  });

  describe("준비 실패", () => {
    describe("화면 표시", () => {
      it.each([
        { label: "질문 준비", status: "FAILED" as const, model: MODEL_READY },
        {
          label: "모델 받기",
          status: "READY" as const,
          model: { status: "failed", progress: 0.3 } satisfies ModelPreload,
        },
      ])(
        "'$label'이 실패했으면 '면접 준비에 실패했어요'와 [다시 시도]를 보여 준다",
        ({ status, model }) => {
          render(plan(status, null, model));

          expect(screen.getByText("면접 준비에 실패했어요")).toBeDefined();
          expect(retryButton()).toBeDefined();
          expect(screen.queryByRole("progressbar")).toBeNull();
        },
      );
    });

    describe("사용자 조작", () => {
      it("질문 준비만 실패했으면 [다시 시도]는 질문 준비만 다시 하고 모델은 다시 받지 않는다", async () => {
        render(plan("FAILED", null));

        const response = retryWith();

        expect(retryPlan).toHaveBeenCalledTimes(1);
        expect(onRetryModel).not.toHaveBeenCalled();
        await act(async () => response.resolve({}));
      });

      it("모델 받기만 실패했으면 [다시 시도]는 모델만 다시 받고 질문 준비는 다시 하지 않는다", () => {
        render(plan("READY", null, { status: "failed", progress: 0.3 }));

        fireEvent.click(retryButton());

        expect(onRetryModel).toHaveBeenCalledTimes(1);
        expect(retryPlan).not.toHaveBeenCalled();
      });
    });

    describe("상태 변화", () => {
      it("[다시 시도]를 다시 누르면 지난 문구를 지운다", async () => {
        render(plan("FAILED", null));
        const first = retryWith();
        await act(async () => first.resolve(FAILED));
        expect(screen.getByRole("alert").textContent).toBe(SERVER_DETAIL);

        const second = retryWith();

        expect(screen.queryByRole("alert")).toBeNull();
        await act(async () => second.resolve({}));
      });
    });

    describe("오류 처리", () => {
      it("질문 준비를 다시 시작하지 못하면 그 문구를 보여 준다", async () => {
        render(plan("FAILED", null));
        const response = retryWith();

        await act(async () => response.resolve(FAILED));

        expect(screen.getByRole("alert").textContent).toBe(SERVER_DETAIL);
      });
    });

    describe("중복 · 경쟁 처리", () => {
      it("다시 시작 응답을 기다리는 동안 [다시 시도]를 누를 수 없다", async () => {
        render(plan("FAILED", null));

        const response = retryWith();

        expect(retryButton().hasAttribute("disabled")).toBe(true);
        expect(retryButton().getAttribute("aria-busy")).toBe("true");
        await act(async () => response.resolve({}));
        expect(retryButton().hasAttribute("disabled")).toBe(false);
      });
    });
  });
});
