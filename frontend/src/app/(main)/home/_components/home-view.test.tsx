// 기준: Figma S02 홈(오늘 미완료) · S02-B(완료) · S02-C(끊김) · S02-D(첫 방문) · 웹 Swagger 3.1 HomeResponse(homeState)
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  FIXTURE_TODAY,
  HOME_BROKEN,
  HOME_DONE,
  HOME_FIRST,
  HOME_NOT_DONE,
} from "@/lib/home/fixtures";

import { HomeView } from "./home-view";

// 경계 mock: 연출(motion, 이번 주 파도 · 뱃지)은 건너뛴다. 오늘 남은 시간이 현재 시각을 읽어 시각을 고정한다
vi.mock("motion/react", async (importOriginal) =>
  (await import("@/test/motion")).reducedMotion(importOriginal),
);

// 예시 데이터: Swagger 3.1 예시 4상태(현 lib/home/fixtures.ts, 오늘 2026-10-15)
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-15T23:00:00+09:00"));
});

const heading = (name: string) => screen.getByRole("heading", { level: 1, name });
const link = (name: string) => screen.getByRole("link", { name });

describe("HomeView · S02 홈", () => {
  describe("화면 표시", () => {
    it("오늘 아직이면 N일째 · 오늘 남은 시간 · [오늘의 연습 시작하기] · 어제의 나에게서 카드를 보여 준다", () => {
      render(<HomeView home={HOME_NOT_DONE} today={FIXTURE_TODAY} />);

      expect(heading("7일째")).toBeDefined();
      expect(screen.getByText(/오늘 남은 시간/)).toBeDefined();
      expect(link("오늘의 연습 시작하기")).toBeDefined();
      expect(screen.getByText("어제의 나에게서")).toBeDefined();
    });

    it("오늘 마쳤으면 N일째 · 내일 이어질 일수 · 오늘 면접 횟수와 시간 · [한 번 더 연습하기] · 오늘 나아진 점 카드를 보여 준다", () => {
      render(<HomeView home={HOME_DONE} today={FIXTURE_TODAY} />);

      expect(heading("8일째")).toBeDefined();
      expect(screen.getByText("내일 자정 전에 하면 9일째")).toBeDefined();
      expect(screen.getByText("오늘 면접 1회 · 18분")).toBeDefined();
      expect(link("한 번 더 연습하기")).toBeDefined();
      expect(screen.getByText("오늘 나아진 점")).toBeDefined();
    });

    it("끊겼으면 0일째 · 지난 최고 기록 · [다시 1일째 시작하기] · 지난번 마지막 연습 카드를 보여 준다", () => {
      render(<HomeView home={HOME_BROKEN} today={FIXTURE_TODAY} />);

      expect(heading("0일째")).toBeDefined();
      expect(screen.getByText("지난 최고 기록 7일")).toBeDefined();
      expect(link("다시 1일째 시작하기")).toBeDefined();
      expect(screen.getByText("지난번 마지막 연습")).toBeDefined();
    });

    it("첫 방문이면 0일째 · 첫 연습 안내 · [첫 면접 시작하기] · 빈 최근 리뷰 안내를 보여 준다", () => {
      render(<HomeView home={HOME_FIRST} today={FIXTURE_TODAY} />);

      expect(heading("0일째")).toBeDefined();
      expect(screen.getByText("첫 연습을 시작해볼까요?")).toBeDefined();
      expect(link("첫 면접 시작하기")).toBeDefined();
      expect(
        screen.getByText("최근 성장 리뷰 · 첫 면접을 마치면 여기에 차곡차곡 쌓여요"),
      ).toBeDefined();
    });
  });
});
