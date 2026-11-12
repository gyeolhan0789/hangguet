// 기준: Figma S02 '어제의 나에게서' · S02-B '오늘 나아진 점' · S02-C '지난번 마지막 연습' · '최근 성장 리뷰'
// · 웹 Swagger 3.1(nextActions · nextActionsDate · todayImprovements · recentReviews, 오늘의 집계는 한국 시간 면접 시작 날짜 기준)
// · 사용자 결정(2026-10-27: 첫 연습일이면 점수 배지를 숨긴다)
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { HOME_BROKEN, HOME_DONE, HOME_NOT_DONE } from "@/lib/home/fixtures";

import {
  LastPracticeCard,
  NextActionCard,
  RecentReviewsCard,
  TodayImprovedCard,
} from "./home-cards";

// 예시 데이터: Swagger 3.1 예시(현 lib/home/fixtures.ts) · 첫 연습일 리뷰(criterion · delta null)
const FIRST_DAY_REVIEW = { ...HOME_NOT_DONE.recentReviews[0], criterion: null, delta: null };

const href = (name: string | RegExp) => screen.getByRole("link", { name }).getAttribute("href");

describe("NextActionCard · 어제의 나에게서 카드", () => {
  describe("경계값", () => {
    it("다음에 해볼 것이 없으면 카드를 그리지 않는다", () => {
      const { container } = render(<NextActionCard home={{ ...HOME_NOT_DONE, nextActions: [] }} />);

      expect(container.firstChild).toBeNull();
    });
  });
});

describe("TodayImprovedCard · 오늘 나아진 점 카드", () => {
  describe("화면 표시", () => {
    it("오늘 오른 기준을 ' · '로 이어 보여 주고 FE의 오늘이 아닌 가장 최근 성장 리뷰 날짜로 간다", () => {
      // 자정을 넘겨 FE의 오늘은 10-16이어도 오늘의 집계는 면접을 시작한 10-15 리뷰다
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-10-16T00:30:00+09:00"));

      render(<TodayImprovedCard home={HOME_DONE} />);

      expect(href(/전달력 \+8 · 논리성 \+4/)).toBe("/reviews/2026-10-15");
    });
  });

  describe("경계값", () => {
    it("오늘 오른 기준이 없으면 카드를 그리지 않는다", () => {
      const { container } = render(
        <TodayImprovedCard home={{ ...HOME_DONE, todayImprovements: [] }} />,
      );

      expect(container.firstChild).toBeNull();
    });
  });
});

describe("LastPracticeCard · 지난번 마지막 연습 카드", () => {
  describe("화면 표시", () => {
    it("마지막 연습이 첫 연습일이면 날짜만 보여 준다", () => {
      const home = {
        ...HOME_BROKEN,
        recentReviews: [{ ...HOME_BROKEN.recentReviews[0], criterion: null, delta: null }],
      };

      render(<LastPracticeCard home={home} />);

      expect(screen.getByText("10.12")).toBeDefined();
    });
  });

  describe("경계값", () => {
    it("최근 리뷰가 없으면(지난 면접이 모두 분석 실패) 카드를 그리지 않는다", () => {
      const { container } = render(
        <LastPracticeCard home={{ ...HOME_BROKEN, recentReviews: [] }} />,
      );

      expect(container.firstChild).toBeNull();
    });
  });
});

describe("RecentReviewsCard · 최근 성장 리뷰 카드", () => {
  describe("화면 표시", () => {
    it("첫 연습일 리뷰는 점수 배지 없이 날짜 · 회사만 보여 준다", () => {
      render(<RecentReviewsCard reviews={[FIRST_DAY_REVIEW]} />);

      expect(screen.getByRole("link", { name: "10.14 ○○전자 성장 리뷰 보기" }).textContent).toBe(
        "10.14○○전자",
      );
    });
  });

  describe("경계값", () => {
    it("리뷰가 없으면 카드를 그리지 않는다", () => {
      const { container } = render(<RecentReviewsCard reviews={[]} />);

      expect(container.firstChild).toBeNull();
    });
  });
});
