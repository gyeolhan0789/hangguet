// 기준: Figma 지원 관리 · 목록(아래 '‹ 1 / 1 ›') · Swagger 4.3 · 4.6 page
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ApplicationPager } from "./application-pager";

const pathOf = (page: number) => `/x?page=${page}`;

describe("ApplicationPager · 쪽 넘김", () => {
  describe("화면 표시", () => {
    it("지금 쪽과 전체 쪽 수를 'N / M'으로 보여 준다", () => {
      render(<ApplicationPager page={1} totalPages={3} pathOf={pathOf} />);

      expect(screen.getByRole("navigation", { name: "페이지" }).textContent).toContain("2 / 3");
    });

    it("가운데 쪽이면 이전 · 다음 링크가 앞뒤 쪽 주소로 간다", () => {
      render(<ApplicationPager page={1} totalPages={3} pathOf={pathOf} />);

      expect(screen.getByRole("link", { name: "이전 페이지" }).getAttribute("href")).toBe(
        "/x?page=0",
      );
      expect(screen.getByRole("link", { name: "다음 페이지" }).getAttribute("href")).toBe(
        "/x?page=2",
      );
    });
  });

  describe("경계값", () => {
    it("첫 쪽이면 이전 링크가 없다", () => {
      render(<ApplicationPager page={0} totalPages={3} pathOf={pathOf} />);

      expect(screen.queryByRole("link", { name: "이전 페이지" })).toBeNull();
    });

    it("마지막 쪽이면 다음 링크가 없다", () => {
      render(<ApplicationPager page={2} totalPages={3} pathOf={pathOf} />);

      expect(screen.queryByRole("link", { name: "다음 페이지" })).toBeNull();
    });
  });
});
