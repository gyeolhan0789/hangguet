import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  FIXTURE_TODAY,
  HOME_BROKEN,
  HOME_DONE,
  HOME_FIRST,
  HOME_NOT_DONE,
} from "@/lib/home/fixtures";

import { HomeView } from "./home-view";

// vitest 전역 모드가 아니라 테스트마다 직접 정리한다.
afterEach(cleanup);

// mock 서버는 오늘 미완료 상태만 주므로, 나머지 상태(S02-B · C · D)는 여기서 확인한다.
describe("HomeView", () => {
  it("S02 오늘 미완료: N일째 · 남은 시간 · 시작 버튼 · 어제의 나에게서", () => {
    render(<HomeView home={HOME_NOT_DONE} today={FIXTURE_TODAY} />);

    expect(screen.getByRole("heading", { level: 1, name: "7일째" })).toBeDefined();
    expect(screen.getByText("오늘도 불태워볼까요?")).toBeDefined();
    expect(screen.getByText(/오늘 남은 시간/)).toBeDefined();
    expect(screen.getByRole("link", { name: /오늘의 연습 시작하기/ })).toBeDefined();
    expect(screen.getByText("“꼬리 질문엔 근거부터 짧게”")).toBeDefined();
    expect(screen.getByText("10.14 성장 리뷰의 ‘다음에 해볼 것’")).toBeDefined();
    expect(
      screen
        .getByRole("link", { name: "10.14 ○○전자 전달력 +8 성장 리뷰 보기" })
        .getAttribute("href"),
    ).toBe("/reviews/2026-10-14");
  });

  it("S02-B 오늘 완료: 한 번 더 연습 · 오늘 나아진 점", () => {
    render(<HomeView home={HOME_DONE} today={FIXTURE_TODAY} />);

    expect(screen.getByRole("heading", { level: 1, name: "8일째" })).toBeDefined();
    expect(screen.getByText("내일 자정 전에 하면 9일째")).toBeDefined();
    expect(screen.getByRole("link", { name: "한 번 더 연습하기" })).toBeDefined();
    expect(screen.getByText("오늘 면접 1회 · 18분")).toBeDefined();
    expect(screen.getByRole("link", { name: /전달력 \+8 · 논리성 \+4/ }).getAttribute("href")).toBe(
      "/reviews/2026-10-15",
    );
  });

  it("S02-C 끊김: 0일째 · 지난 최고 기록 · 지난번 마지막 연습", () => {
    render(<HomeView home={HOME_BROKEN} today={FIXTURE_TODAY} />);

    expect(screen.getByRole("heading", { level: 1, name: "0일째" })).toBeDefined();
    expect(screen.getByText("지난 최고 기록 7일")).toBeDefined();
    expect(screen.getByRole("link", { name: /다시 1일째 시작하기/ })).toBeDefined();
    expect(screen.getByText("10.12 · 전달력 +8")).toBeDefined();
    expect(screen.getAllByText("빠짐", { exact: false }).length).toBe(3);
  });

  it("S02-D 첫 방문: 첫 연습 안내 · 3단계 · 빈 최근 리뷰", () => {
    render(<HomeView home={HOME_FIRST} today={FIXTURE_TODAY} />);

    expect(
      screen.getByRole("heading", { level: 1, name: "첫 연습을 시작해볼까요?" }),
    ).toBeDefined();
    expect(screen.getByRole("link", { name: /첫 면접 시작하기/ })).toBeDefined();
    expect(screen.getByText("2. 3D 면접관과 면접")).toBeDefined();
    expect(screen.getByText(/첫 면접을 마치면 여기에 차곡차곡 쌓여요/)).toBeDefined();
    expect(screen.queryByText("최근 성장 리뷰")).toBeNull();
  });

  // 7.2 RecentReviewItem: 첫 연습일이면 비교할 날이 없어 criterion · delta가 함께 null이다(mock DTO · API 명세 7장).
  it("최근 성장 리뷰가 첫 연습일(criterion · delta null)이면 점수 칩 없이 날짜 · 회사명만 보여 준다", () => {
    const firstDay = { ...HOME_BROKEN.recentReviews[0], criterion: null, delta: null };
    render(
      <HomeView
        home={{ ...HOME_BROKEN, recentReviews: [firstDay, HOME_BROKEN.recentReviews[1]] }}
        today={FIXTURE_TODAY}
      />,
    );

    // 지난번 마지막 연습 카드: 점수 대신 회사명
    expect(screen.getByText("10.12 · ○○전자")).toBeDefined();
    expect(screen.queryByText(/null|undefined/)).toBeNull();
    // 최근 성장 리뷰 행: 칩 없이 날짜 · 회사명, 화면 읽기 이름에도 null이 없다
    expect(screen.getByRole("link", { name: "10.12 ○○전자 성장 리뷰 보기" })).toBeDefined();
    expect(
      screen.getByRole("link", { name: "10.11 △△소프트 논리성 +4 성장 리뷰 보기" }),
    ).toBeDefined();
  });
});
