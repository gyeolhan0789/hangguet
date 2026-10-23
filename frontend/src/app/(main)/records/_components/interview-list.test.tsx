import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SESSION_LIST } from "@/test/session-list-examples";
import type { SessionListResponse } from "@/types/api";

import { InterviewList } from "./interview-list";

// 줄이 들어오는 스프링은 기다리지 않도록 '동작 줄이기'로 그린다.
vi.mock("motion/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("motion/react")>()),
  useReducedMotion: () => true,
}));

// 기준: Figma 연습 기록 초안 Interview List(232:843: '면접 목록' · 회사 · 직무 · '악마 면접관 · 화상 · 20분' · 한 줄 총평
// · [상세 피드백] · [다시보기] · '분석 중' · ‹ 1 / 1 ›) · 웹 Swagger 5.13 예시 · 웹 mock 서버 2026-10-20 실제 응답
// · COMPLETED만 버튼, ANALYZING · FAILED는 상태만, 총평 null이면 숨김, 범위를 넘으면 첫 페이지 복귀
// · 사용자 결정(2026-10-23: 빈 날 · 범위 초과 문구, 실패는 '분석 실패', 기준별 등급은 보이지 않음)

beforeEach(() => {
  // 줄이 '보이면' 들어오는 연출(whileInView)이 쓰는 IntersectionObserver가 jsdom에 없다.
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const list = () => screen.getByRole("region", { name: "면접 목록" });
const row = (name: string) => within(list()).getByRole("article", { name });

describe("InterviewList · 면접 줄", () => {
  it("완료(COMPLETED): 회사 · 직무, 면접관 · 방식 · 시간, 한 줄 총평, [상세 피드백] · [다시보기]", () => {
    render(<InterviewList date="2026-10-21" list={SESSION_LIST.DAILY} />);

    const done = row("○○전자 백엔드 개발자");
    expect(within(done).getByRole("heading", { level: 3 }).textContent).toBe(
      "○○전자 · 백엔드 개발자",
    );
    expect(within(done).queryByText("악마 면접관 · 화상 · 20분")).not.toBeNull();
    expect(within(done).queryByText("논리는 탄탄했지만, 근거가 조금 아쉬웠어요")).not.toBeNull();
    expect(within(done).getByRole("link", { name: "상세 피드백" }).getAttribute("href")).toBe(
      "/interview/55/result",
    );
    expect(within(done).getByRole("link", { name: "다시보기" }).getAttribute("href")).toBe(
      "/interview/55/replay",
    );
  });

  it("분석 중(ANALYZING): 상태만 보이고 버튼은 없다", () => {
    render(<InterviewList date="2026-10-21" list={SESSION_LIST.DAILY} />);

    const pending = row("△△소프트 서버 개발자");
    expect(within(pending).queryByText("개발자 커피챗 · 채팅 · 12분")).not.toBeNull();
    expect(within(pending).queryByText("분석 중")).not.toBeNull();
    expect(within(pending).queryAllByRole("link")).toHaveLength(0);
  });

  it("실패(FAILED)는 '분석 실패'만, 총평이 없는 완료는 총평 줄 없이 버튼만 보인다", () => {
    render(<InterviewList date="2026-10-20" list={SESSION_LIST.DAY_20} />);

    const failed = row("△△소프트 서버 개발자");
    expect(within(failed).queryByText("분석 실패")).not.toBeNull();
    expect(within(failed).queryAllByRole("link")).toHaveLength(0);
    const done = row("○○전자 백엔드 개발자");
    expect(
      within(done)
        .getAllByRole("paragraph")
        .map((p) => p.textContent),
    ).toEqual(["악마 면접관 · 채팅 · 10분"]);
    expect(within(done).getAllByRole("link")).toHaveLength(2);
  });

  it("기준별 등급(좋아요 · 보통 · 아쉬워요)은 보이지 않는다", () => {
    render(<InterviewList date="2026-10-21" list={SESSION_LIST.DAILY} />);

    expect(within(list()).queryByText(/좋아요|보통|아쉬워요/)).toBeNull();
  });
});

describe("InterviewList · 빈 날 · 페이지", () => {
  it("기록 없는 날은 '이날은 면접 기록이 없어요'만 보이고 페이지 이동은 없다", () => {
    render(<InterviewList date="2026-10-19" list={SESSION_LIST.EMPTY} />);

    expect(within(list()).queryByText("이날은 면접 기록이 없어요")).not.toBeNull();
    expect(screen.queryByRole("navigation", { name: "페이지" })).toBeNull();
  });

  it("범위를 넘은 페이지는 '이 페이지에는 기록이 없어요'와 [첫 페이지로]를 보이고 번호는 숨긴다", () => {
    const beyond: SessionListResponse = {
      ...SESSION_LIST.EMPTY,
      page: { size: 5, number: 5, totalElements: 7, totalPages: 2 },
    };
    render(<InterviewList date="2026-10-21" list={beyond} />);

    expect(within(list()).queryByText("이 페이지에는 기록이 없어요")).not.toBeNull();
    expect(within(list()).getByRole("link", { name: "첫 페이지로" }).getAttribute("href")).toBe(
      "/records?date=2026-10-21",
    );
    expect(screen.queryByRole("navigation", { name: "페이지" })).toBeNull();
  });

  it("한 페이지뿐이면 '1 / 1'이고 ‹ › 모두 누를 수 없다", () => {
    render(<InterviewList date="2026-10-21" list={SESSION_LIST.DAILY} />);

    const pager = screen.getByRole("navigation", { name: "페이지" });
    expect(pager.textContent).toBe("1 / 1");
    expect(within(pager).queryAllByRole("link")).toHaveLength(0);
  });

  it("가운데 페이지면 ‹는 앞 페이지(첫 페이지는 page 없이), ›는 다음 페이지로 간다", () => {
    const middle: SessionListResponse = {
      ...SESSION_LIST.DAILY,
      page: { size: 5, number: 1, totalElements: 12, totalPages: 3 },
    };
    render(<InterviewList date="2026-10-21" list={middle} />);

    const pager = screen.getByRole("navigation", { name: "페이지" });
    expect(pager.textContent).toBe("2 / 3");
    expect(within(pager).getByRole("link", { name: "이전 페이지" }).getAttribute("href")).toBe(
      "/records?date=2026-10-21",
    );
    expect(within(pager).getByRole("link", { name: "다음 페이지" }).getAttribute("href")).toBe(
      "/records?date=2026-10-21&page=2",
    );
  });
});
