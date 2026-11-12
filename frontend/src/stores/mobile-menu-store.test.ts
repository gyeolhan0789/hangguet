// @vitest-environment node
// 기준: 모바일(sm 미만) 헤더 햄버거 메뉴(사용자 결정 2026-10-26) · 메뉴에서 고른 공지는 메뉴를 닫고 C02로 연다 · Swagger 8.8 NoticeItem
import { beforeEach, describe, expect, it } from "vitest";

import type { NoticeItem } from "@/types/api";

import { useMobileMenuStore } from "./mobile-menu-store";

// 예시 데이터: Swagger 8.8 200 예시의 첫 공지
const NOTICE: NoticeItem = {
  id: 3,
  title: "10월 점검 안내",
  content: "10월 30일 02:00~04:00 서비스 점검이 있어요.",
  startsAt: "2026-10-23T09:00:00+09:00",
  read: false,
};

beforeEach(() => {
  useMobileMenuStore.setState({ open: false, notice: null });
});

describe("useMobileMenuStore · 모바일 메뉴 상태", () => {
  describe("상태 변화", () => {
    it.each([
      { label: "닫힘", open: false },
      { label: "열림", open: true },
    ])("'$label' 상태에서 토글하면 반대로 바꾼다", ({ open }) => {
      useMobileMenuStore.setState({ open });

      useMobileMenuStore.getState().toggle();

      expect(useMobileMenuStore.getState().open).toBe(!open);
    });

    it("공지를 고르면 메뉴를 닫고 그 공지를 열 공지로 둔다", () => {
      useMobileMenuStore.setState({ open: true });

      useMobileMenuStore.getState().openNotice(NOTICE);

      expect(useMobileMenuStore.getState()).toMatchObject({ open: false, notice: NOTICE });
    });
  });
});
