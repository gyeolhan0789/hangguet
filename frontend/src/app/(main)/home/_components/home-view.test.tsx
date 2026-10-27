import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  FIXTURE_TODAY,
  HOME_BROKEN,
  HOME_DONE,
  HOME_FIRST,
  HOME_NOT_DONE,
} from "@/lib/home/fixtures";

import { HomeView } from "./home-view";

// vitest 전역 모드가 아니라 테스트마다 직접 정리한다.
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

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

  it("S02-B 오늘 나아진 점의 링크 날짜는 FE의 오늘이 아니라 응답의 가장 최근 성장 리뷰 날짜다(자정 직후)", () => {
    render(<HomeView home={HOME_DONE} today="2026-10-16" />);

    expect(screen.getByRole("link", { name: /전달력 \+8 · 논리성 \+4/ }).getAttribute("href")).toBe(
      "/reviews/2026-10-15",
    );
  });

  it("웹 Swagger 3.1 homeState 4개 밖의 값이면 빈 화면 대신 오류를 던져 오류 화면으로 보낸다", () => {
    const unknown = {
      ...HOME_NOT_DONE,
      homeState: "SOMETHING_ELSE",
    } as unknown as typeof HOME_NOT_DONE;
    vi.spyOn(console, "error").mockImplementation(() => {});

    expect(() => render(<HomeView home={unknown} today={FIXTURE_TODAY} />)).toThrow(
      "알 수 없는 홈 상태: SOMETHING_ELSE",
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

  // 사용자 결정(2026-10-27): 오른 기준이 없으면 BE가 전달력 0을 주고("전달력 +0"), 첫 연습일(null)이면 배지를 숨긴다
  it("최근 성장 리뷰: 오른 기준이 없으면 '전달력 +0', 첫 연습일이면 배지 없이 날짜 · 회사만", () => {
    const [review] = HOME_NOT_DONE.recentReviews;
    render(
      <HomeView
        home={{
          ...HOME_NOT_DONE,
          recentReviews: [
            { ...review, practiceDate: "2026-10-14", criterion: "DELIVERY", delta: 0 },
            { ...review, practiceDate: "2026-10-13", criterion: null, delta: null },
          ],
        }}
        today={FIXTURE_TODAY}
      />,
    );

    expect(
      screen.getByRole("link", { name: `10.14 ${review.companyName} 전달력 +0 성장 리뷰 보기` }),
    ).toBeDefined();
    const first = screen.getByRole("link", { name: `10.13 ${review.companyName} 성장 리뷰 보기` });
    expect(first.textContent).not.toMatch(/undefined|null|\+/);
  });

  it("S02-C 끊김: 마지막 연습이 첫 연습일이면 날짜만 보여 준다", () => {
    const [review] = HOME_BROKEN.recentReviews;
    render(
      <HomeView
        home={{ ...HOME_BROKEN, recentReviews: [{ ...review, criterion: null, delta: null }] }}
        today={FIXTURE_TODAY}
      />,
    );
    const card = screen.getByText("지난번 마지막 연습").closest("a");
    expect(card?.textContent).toContain("10.12");
    expect(card?.textContent).not.toContain("10.12 ·");
    expect(document.body.textContent).not.toMatch(/undefined|null/);
  });

  it("S02-D 첫 방문: 0일째 · 첫 연습 안내 · 3단계 · 빈 최근 리뷰", () => {
    render(<HomeView home={HOME_FIRST} today={FIXTURE_TODAY} />);

    expect(screen.getByRole("heading", { level: 1, name: "0일째" })).toBeDefined();
    expect(screen.getByText("첫 연습을 시작해볼까요?")).toBeDefined();
    expect(screen.queryByText(/지난 최고 기록/)).toBeNull();
    expect(screen.getByRole("link", { name: /첫 면접 시작하기/ })).toBeDefined();
    expect(screen.getByText("2. 3D 면접관과 면접")).toBeDefined();
    expect(screen.getByText(/첫 면접을 마치면 여기에 차곡차곡 쌓여요/)).toBeDefined();
    expect(screen.queryByText("최근 성장 리뷰")).toBeNull();
  });
});
