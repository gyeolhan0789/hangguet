// 기준: Figma S08 오늘의 성장 리뷰(18:2710) · S08-C 첫 면접(18:4720) · S08-B 설문 유도(18:4578) · 기획 메모 S08 · S08-C
// · 웹 Swagger 7.1(isFirst → S08-C, streakOnDate로 설문 판단) · 5.8(leveledUp은 화면이 결과 화면까지 기억)
// · 사용자 결정(2026-10-22: S07에서 들어왔고 그날 첫 면접이면 'N일째 달성!'을 한 번 띄운다, 지난 날짜는 '오늘' 문구를 그날 문구로,
//   설문은 오늘 리뷰에서만)
import { act, fireEvent, render, screen } from "@testing-library/react";
import { usePathname } from "next/navigation";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useInterviewStore } from "@/stores/interview-store";
import { useToastStore } from "@/stores/toast-store";
import { deferred } from "@/test/deferred";
import { flushPromises } from "@/test/flush";
import { GROWTH_REVIEW } from "@/test/growth-review-examples";
import { router } from "@/test/next-navigation";
import type { GrowthReviewResponse } from "@/types/api";

import { ReviewView } from "./review-view";

// 경계 mock: Next 라우터(주소 바꾸기 · 지금 주소), 연출(motion)은 건너뛰되 덮개를 흐리게 하는 움직임(animate)만 테스트가 끝낸다.
// 축하(StreakCelebration · StreakIntro · LevelUp)는 실제로 돈다. 시간은 가짜 타이머(설문 1.2초)
vi.mock("next/navigation", () => import("@/test/next-navigation"));
const motionState = vi.hoisted(() => ({ fades: [] as (() => void)[] }));
vi.mock("motion/react", async (importOriginal) => ({
  ...(await (await import("@/test/motion")).reducedMotion(importOriginal)),
  animate: () => {
    const done = deferred();
    motionState.fades.push(() => done.resolve());
    return {
      then: (onDone: () => void, onError: (reason: unknown) => void) =>
        done.promise.then(onDone, onError),
      stop: vi.fn(),
    };
  },
}));

// 예시 데이터: Swagger 7.1 200 예시 'S08 오늘의 성장 리뷰'(2026-10-13 · 8일째) · 'S08-C 첫 면접', 설문 회차(7일째)로 바꾼 리뷰
const { S08, FIRST } = GROWTH_REVIEW;
const ROUND_7 = { ...S08, streakOnDate: 7 };
const SURVEY_URL = "https://forms.test/s?entry.1={userId}&entry.2={streak}";
const SURVEY = { name: "1분만 의견을 들려주세요" };
const CELEBRATION = { name: "8일째 달성! 오늘도 해냈어요 — 내일 또 만나요" };

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(usePathname).mockReturnValue("/reviews/2026-10-13");
  localStorage.clear();
  sessionStorage.clear();
  motionState.fades = [];
  useInterviewStore.getState().reset();
  useToastStore.setState({ toast: null });
});

function renderReview(
  review: GrowthReviewResponse,
  props: Partial<{
    today: boolean;
    fromResult: boolean;
    surveyUrl: string | null;
    userId: number | null;
  }> = {},
) {
  return render(
    <ReviewView
      review={review}
      today
      fromResult={false}
      surveyUrl={SURVEY_URL}
      userId={1}
      {...props}
    />,
  );
}

/** 불 전환의 흐리게 하기를 끝낸다(단계가 그대로인 축하가 끝난다) */
const finishFade = () =>
  act(async () => {
    motionState.fades[0]();
  });
const waitSurvey = (ms: number) => act(() => vi.advanceTimersByTime(ms));

describe("ReviewView · S08 성장 리뷰", () => {
  describe("리뷰 내용", () => {
    describe("화면 표시", () => {
      it("첫 연습일이 아니면 그날 요약을 '날짜 · 오늘 면접 N회 · M분'으로 보여 준다", () => {
        renderReview(S08);

        expect(screen.getByText("10월 13일 · 오늘 면접 1회 · 18분")).toBeDefined();
      });

      it("지난 날짜면 요약에서 '오늘'을 뺀다", () => {
        renderReview(S08, { today: false });

        expect(screen.getByText("10월 13일 · 면접 1회 · 18분")).toBeDefined();
      });

      it("첫 연습일이면 '오늘이 나의 기준점'이라는 요약을 보여 준다", () => {
        renderReview(FIRST);

        expect(screen.getByText("첫 면접을 마쳤어요 · 오늘이 나의 기준점이에요")).toBeDefined();
      });

      it("첫 연습일인데 지난 날짜면 '이날이 나의 기준점'으로 보여 준다", () => {
        renderReview(FIRST, { today: false });

        expect(screen.getByText("첫 면접을 마쳤어요 · 이날이 나의 기준점이에요")).toBeDefined();
      });

      it("첫 연습일이 아니면 나아진 점 카드를 보여 준다", () => {
        renderReview(S08);

        expect(screen.getByRole("region", { name: "오늘 나아진 점" })).toBeDefined();
        expect(screen.queryByRole("region", { name: "오늘의 기준점" })).toBeNull();
      });

      it("첫 연습일이면 나아진 점 대신 기준점 카드를 보여 준다", () => {
        renderReview(FIRST);

        expect(screen.getByRole("region", { name: "오늘의 기준점" })).toBeDefined();
        expect(screen.queryByRole("region", { name: "오늘 나아진 점" })).toBeNull();
      });
    });
  });

  describe("설문 유도", () => {
    describe("화면 표시", () => {
      it("오늘 리뷰가 설문 회차면 설문을 띄운다", () => {
        renderReview(ROUND_7);

        waitSurvey(1200);

        expect(screen.getByRole("dialog", SURVEY)).toBeDefined();
      });

      it.each([
        { label: "설문 회차 아님", review: S08, props: {} },
        { label: "지난 날짜", review: ROUND_7, props: { today: false } },
        { label: "설문 주소 없음", review: ROUND_7, props: { surveyUrl: null } },
        { label: "회원 id 없음", review: ROUND_7, props: { userId: null } },
      ])("'$label'이면 설문을 띄우지 않는다", ({ review, props }) => {
        renderReview(review, props);

        waitSurvey(1200);

        expect(screen.queryByRole("dialog", SURVEY)).toBeNull();
      });
    });
  });

  describe("면접 마친 뒤 축하", () => {
    describe("화면 표시", () => {
      it("결과 화면에서 왔고 그날 첫 면접이면 리뷰 대신 그날 일수의 'N일째 달성!' 축하를 먼저 보여 준다", async () => {
        renderReview(S08, { fromResult: true });

        expect(screen.getByRole("status", CELEBRATION)).toBeDefined();
        expect(screen.queryByRole("region", { name: "오늘 나아진 점" })).toBeNull();
        await finishFade();
      });

      it.each([
        { label: "결과 화면에서 온 게 아님", review: S08, fromResult: false },
        { label: "그날 두 번째 면접", review: { ...S08, interviewCount: 2 }, fromResult: true },
      ])("'$label'이면 축하 없이 리뷰를 보여 준다", ({ review, fromResult }) => {
        renderReview(review, { fromResult });

        expect(screen.queryByRole("status", CELEBRATION)).toBeNull();
        expect(screen.getByRole("region", { name: "오늘 나아진 점" })).toBeDefined();
      });
    });

    describe("상태 변화", () => {
      it("기억한 레벨업 값이 있으면 축하 뒤 레벨업을 띄운다", async () => {
        useInterviewStore.getState().setLeveledUp(true);
        renderReview(S08, { fromResult: true });

        await flushPromises();

        expect(screen.getByRole("dialog", { name: "푸른 불꽃 달성!" })).toBeDefined();
      });

      it("레벨업 값을 모르면(새로고침 등) 축하 뒤 레벨업 없이 리뷰를 보여 준다", async () => {
        renderReview(S08, { fromResult: true });

        await finishFade();

        expect(screen.queryByRole("dialog")).toBeNull();
        expect(screen.getByRole("region", { name: "오늘 나아진 점" })).toBeDefined();
      });

      it("축하가 끝나면 리뷰를 보여 주고 기억한 레벨업 값과 주소의 들어온 표시를 지운다", async () => {
        useInterviewStore.getState().setLeveledUp(true);
        renderReview(S08, { fromResult: true });
        await flushPromises();

        fireEvent.click(screen.getByRole("button", { name: "계속하기" }));

        expect(screen.getByRole("region", { name: "오늘 나아진 점" })).toBeDefined();
        expect(useInterviewStore.getState().leveledUp).toBeNull();
        expect(router.replace).toHaveBeenCalledTimes(1);
        expect(vi.mocked(router.replace).mock.calls[0][0]).toBe("/reviews/2026-10-13");
      });
    });

    describe("시간 경과", () => {
      it("설문 회차면 축하가 끝난 뒤부터 1.2초를 세어 설문을 띄운다", async () => {
        renderReview(ROUND_7, { fromResult: true });
        waitSurvey(5000);
        expect(screen.queryByRole("dialog", SURVEY)).toBeNull();

        await finishFade();
        waitSurvey(1199);
        expect(screen.queryByRole("dialog", SURVEY)).toBeNull();
        waitSurvey(1);

        expect(screen.getByRole("dialog", SURVEY)).toBeDefined();
      });
    });
  });
});
