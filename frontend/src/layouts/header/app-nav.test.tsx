// 기준: Figma C/App Header 오른쪽(홈 · 연습 기록 · 스트릭 · 프로필 · 공지) · 기획 메모 C01(공지 버튼은 다크 모드 토글 바로 왼쪽)
// · 랜딩(S00)처럼 공지를 넘기지 않으면 공지 버튼 · 줄이 없다 · Swagger 2.1 MeResponse · 8.8 NoticeItem
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { MeResponse, NoticeItem } from "@/types/api";

import { AppMobileMenu, AppNav } from "./app-nav";

// 경계 mock: 서버 액션(8.9 · 로그아웃)과 연출(motion)
vi.mock("@/lib/notice/actions", () => ({ readNotice: vi.fn() }));
vi.mock("@/lib/auth/actions", () => ({ logout: vi.fn() }));
vi.mock("motion/react", async (importOriginal) =>
  (await import("@/test/motion")).reducedMotion(importOriginal),
);

// 예시 데이터: Swagger 2.1 200 예시 · 8.8 200 예시의 첫 공지
const USER: MeResponse = {
  id: 1,
  email: "example@ssafy.com",
  nickname: "면접왕",
  socialProvider: null,
  linkedProvider: null,
  profileImageUrl: null,
  createdAt: "2026-09-01T10:00:00+09:00",
  currentStreak: 7,
};
const NOTICE: NoticeItem = {
  id: 3,
  title: "10월 점검 안내",
  content: "10월 30일 02:00~04:00 서비스 점검이 있어요.",
  startsAt: "2026-10-23T09:00:00+09:00",
  read: false,
};

describe("AppNav · 헤더 주요 메뉴", () => {
  describe("화면 표시", () => {
    it("공지를 넘기면 공지 버튼을 보여 준다", () => {
      render(<AppNav user={USER} notices={[NOTICE]} />);

      expect(screen.getByRole("button", { name: /^공지/ })).toBeDefined();
    });

    it("공지를 넘기지 않으면(랜딩) 공지 버튼이 없다", () => {
      render(<AppNav user={USER} />);

      expect(screen.queryByRole("button", { name: /^공지/ })).toBeNull();
    });
  });
});

describe("AppMobileMenu · 모바일 전체 메뉴 항목", () => {
  describe("화면 표시", () => {
    it("공지를 넘기면 공지 줄을 보여 준다", () => {
      render(<AppMobileMenu user={USER} notices={[NOTICE]} />);

      expect(screen.getByRole("button", { name: /^공지/ })).toBeDefined();
    });

    it("공지를 넘기지 않으면 공지 줄이 없다", () => {
      render(<AppMobileMenu user={USER} />);

      expect(screen.queryByRole("button", { name: /^공지/ })).toBeNull();
      expect(screen.getByRole("link", { name: "홈" })).toBeDefined();
    });
  });
});
