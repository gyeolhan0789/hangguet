// 기준: Figma 연습 기록 초안 면접 목록(232:843: 회사 · 직무, '악마 면접관 · 화상 · 20분', 총평, [상세 피드백] · [다시보기])
// · 웹 Swagger 5.13(content · page, status ANALYZING · FAILED · COMPLETED, summary null 가능)
// · 사용자 결정(2026-10-23: 실패는 '분석 실패', 범위를 넘은 페이지는 [첫 페이지로])
import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SESSION_LIST } from "@/test/session-list-examples";
import type { SessionListResponse } from "@/types/api";

import { InterviewList } from "./interview-list";

// 경계 mock: 연출(motion)은 건너뛰고, 줄이 보이는지 감지(IntersectionObserver, whileInView)는 아무것도 알리지 않는 대역으로 둔다
vi.mock("motion/react", async (importOriginal) =>
  (await import("@/test/motion")).reducedMotion(importOriginal),
);

// 예시 데이터: 웹 Swagger 5.13 '완료·분석 중'(2026-10-21) · 웹 목 서버 2026-10-20(실패 · 총평 없는 완료) · '기록 없는 날짜'
const { DAILY, DAY_20, EMPTY } = SESSION_LIST;
const [COMPLETED, ANALYZING] = DAILY.content;
const NO_SUMMARY = DAY_20.content[1];
const DATE = "2026-10-21";

beforeEach(() => {
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

const renderList = (list: SessionListResponse) => render(<InterviewList date={DATE} list={list} />);
const withRows = (content: SessionListResponse["content"]) => ({ ...DAILY, content });
const withPage = (number: number, totalPages: number, content = DAILY.content) => ({
  ...DAILY,
  content,
  page: { ...DAILY.page, number, totalPages, totalElements: totalPages * 5 },
});
const row = (name: string) => screen.getByRole("article", { name });
const href = (name: string) => screen.getByRole("link", { name }).getAttribute("href");

describe("InterviewList · 면접 목록", () => {
  describe("면접 줄", () => {
    describe("화면 표시", () => {
      it("분석이 끝난 면접은 회사 · 직무, 메타, 총평과 [상세 피드백] · [다시보기] 링크를 보여 준다", () => {
        renderList(withRows([COMPLETED]));

        const item = row("○○전자 백엔드 개발자");
        expect(within(item).getByRole("heading", { name: "○○전자 · 백엔드 개발자" })).toBeDefined();
        expect(within(item).getByText("악마 면접관 · 화상 · 20분")).toBeDefined();
        expect(within(item).getByText("논리는 탄탄했지만, 근거가 조금 아쉬웠어요")).toBeDefined();
        expect(href("상세 피드백")).toBe("/interview/55/result");
        expect(href("다시보기")).toBe("/interview/55/replay");
      });

      it("총평이 없으면(null) 총평 줄 없이 버튼만 보여 준다", () => {
        renderList(withRows([NO_SUMMARY]));

        const item = row("○○전자 백엔드 개발자");
        expect(
          within(item)
            .getAllByRole("paragraph")
            .map((line) => line.textContent),
        ).toEqual(["악마 면접관 · 채팅 · 10분"]);
        expect(within(item).getAllByRole("link")).toHaveLength(2);
      });

      it("분석 중이면 상태 문구만 보이고 총평 · 버튼은 숨긴다", () => {
        renderList(withRows([{ ...ANALYZING, summary: "총평이 있어도 숨긴다" }]));

        const item = row("△△소프트 서버 개발자");
        expect(within(item).getByText("분석 중")).toBeDefined();
        expect(within(item).queryByText("총평이 있어도 숨긴다")).toBeNull();
        expect(within(item).queryByRole("link")).toBeNull();
      });
    });
  });

  describe("빈 목록", () => {
    describe("화면 표시", () => {
      it("그날 기록이 없으면 '이날은 면접 기록이 없어요'만 보이고 페이지 이동은 숨긴다", () => {
        renderList(EMPTY);

        expect(screen.getByText("이날은 면접 기록이 없어요")).toBeDefined();
        expect(screen.queryByRole("navigation", { name: "페이지" })).toBeNull();
      });

      it("범위를 넘은 페이지면 '이 페이지에는 기록이 없어요'와 [첫 페이지로]를 보이고 페이지 번호는 숨긴다", () => {
        renderList(withPage(3, 2, []));

        expect(screen.getByText("이 페이지에는 기록이 없어요")).toBeDefined();
        expect(href("첫 페이지로")).toBe("/records?date=2026-10-21");
        expect(screen.queryByRole("navigation", { name: "페이지" })).toBeNull();
      });
    });
  });

  describe("페이지", () => {
    describe("화면 표시", () => {
      it("가운데 페이지면 [이전 페이지] · [다음 페이지]가 앞뒤 페이지로 간다", () => {
        renderList(withPage(1, 3));

        expect(href("이전 페이지")).toBe("/records?date=2026-10-21");
        expect(href("다음 페이지")).toBe("/records?date=2026-10-21&page=2");
      });
    });

    describe("경계값", () => {
      it("한 페이지뿐이면 [이전 페이지] · [다음 페이지]를 누를 수 없다", () => {
        renderList(withPage(0, 1));

        expect(screen.queryByRole("link", { name: "이전 페이지" })).toBeNull();
        expect(screen.queryByRole("link", { name: "다음 페이지" })).toBeNull();
      });
    });
  });
});
