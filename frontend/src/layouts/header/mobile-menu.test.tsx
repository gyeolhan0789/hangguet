// 기준: 모바일(sm 미만) 햄버거 메뉴 항목(Figma 모바일 설계 없음 → 사용자 결정 2026-10-26: 항목을 고르면 메뉴를 닫는다)
// · Figma C02 공지 모달 · C03 공지 목록 · 기획 메모 C02([확인] → 8.9 → 닫힘) · C03 · Swagger 8.8 NoticeItem · 8.9 공지 확인
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { readNotice } from "@/lib/notice/actions";
import { useMobileMenuStore } from "@/stores/mobile-menu-store";
import { deferred } from "@/test/deferred";
import { flushPromises } from "@/test/flush";
import type { NoticeItem } from "@/types/api";

import { MobileMenuLink, MobileNoticeModal, MobileNotices } from "./mobile-menu";

// 경계 mock: 서버 액션(8.9 · 로그아웃)과 연출(motion)
vi.mock("@/lib/notice/actions", () => ({ readNotice: vi.fn() }));
vi.mock("@/lib/auth/actions", () => ({ logout: vi.fn() }));
vi.mock("motion/react", async (importOriginal) =>
  (await import("@/test/motion")).reducedMotion(importOriginal),
);

// 예시 데이터: Swagger 8.8 200 예시 '확인 안 함 1개 · 확인함 1개'
const UNREAD: NoticeItem = {
  id: 3,
  title: "10월 점검 안내",
  content: "10월 30일 02:00~04:00 서비스 점검이 있어요.",
  startsAt: "2026-10-23T09:00:00+09:00",
  read: false,
};
const READ: NoticeItem = {
  id: 2,
  title: "채팅 면접이 열렸어요",
  content: "이제 글로도 면접을 볼 수 있어요.",
  startsAt: "2026-10-20T09:00:00+09:00",
  read: true,
};

const noticesRow = () => screen.getByRole("button", { name: /^공지/ });
const confirmButton = () => screen.getByRole("button", { name: "확인" });

beforeEach(() => {
  useMobileMenuStore.setState({ open: false, notice: null });
});

describe("MobileMenuLink · 모바일 메뉴 링크", () => {
  describe("사용자 조작", () => {
    it("누르면 메뉴를 닫는다", () => {
      useMobileMenuStore.setState({ open: true });
      render(<MobileMenuLink href="/records">연습 기록</MobileMenuLink>);

      fireEvent.click(screen.getByRole("link", { name: "연습 기록" }));

      expect(useMobileMenuStore.getState().open).toBe(false);
    });
  });
});

describe("MobileNotices · 모바일 공지 줄", () => {
  describe("화면 표시", () => {
    it("확인 안 한 공지가 있으면 그렇다고 읽어 준다", () => {
      render(<MobileNotices notices={[UNREAD, READ]} />);

      expect(screen.getByRole("button", { name: /^공지\s*확인 안 한 공지 있음$/ })).toBeDefined();
    });

    it("모두 확인했으면 '공지'만 읽어 준다", () => {
      render(<MobileNotices notices={[READ]} />);

      expect(screen.getByRole("button", { name: "공지" })).toBeDefined();
    });
  });

  describe("사용자 조작", () => {
    it("누르면 공지 줄을 펼치고 다시 누르면 접는다", () => {
      render(<MobileNotices notices={[UNREAD, READ]} />);

      fireEvent.click(noticesRow());
      expect(noticesRow().getAttribute("aria-expanded")).toBe("true");
      expect(screen.getByRole("button", { name: /10월 점검 안내/ })).toBeDefined();

      fireEvent.click(noticesRow());
      expect(noticesRow().getAttribute("aria-expanded")).toBe("false");
      expect(screen.queryByRole("button", { name: /10월 점검 안내/ })).toBeNull();
    });

    it("펼친 공지를 고르면 그 공지를 연다", () => {
      render(<MobileNotices notices={[UNREAD, READ]} />);
      fireEvent.click(noticesRow());

      fireEvent.click(screen.getByRole("button", { name: /채팅 면접이 열렸어요/ }));

      expect(useMobileMenuStore.getState().notice).toEqual(READ);
    });
  });
});

describe("MobileNoticeModal · 모바일 공지 모달", () => {
  describe("사용자 조작", () => {
    it("[확인]하면 그 공지의 확인을 요청하고 끝나면 모달을 닫는다", async () => {
      vi.mocked(readNotice).mockResolvedValue({ ok: true });
      useMobileMenuStore.setState({ notice: UNREAD });
      render(<MobileNoticeModal />);

      fireEvent.click(confirmButton());
      await flushPromises();

      expect(readNotice).toHaveBeenCalledWith(3);
      expect(screen.queryByRole("dialog")).toBeNull();
    });
  });

  describe("오류 처리", () => {
    it("확인 요청이 실패해도 모달을 닫는다", async () => {
      vi.mocked(readNotice).mockResolvedValue({ error: "공지를 찾을 수 없어요." });
      useMobileMenuStore.setState({ notice: UNREAD });
      render(<MobileNoticeModal />);

      fireEvent.click(confirmButton());
      await flushPromises();

      expect(screen.queryByRole("dialog")).toBeNull();
    });
  });

  describe("중복 · 경쟁 처리", () => {
    it("확인 응답을 기다리는 동안에는 [확인]을 누를 수 없고 모달은 열려 있다", async () => {
      const response = deferred<{ ok: true }>();
      vi.mocked(readNotice).mockReturnValue(response.promise);
      useMobileMenuStore.setState({ notice: UNREAD });
      render(<MobileNoticeModal />);

      fireEvent.click(confirmButton());

      expect(confirmButton().hasAttribute("disabled")).toBe(true);
      expect(screen.getByRole("dialog", { name: "10월 점검 안내" })).toBeDefined();
      await act(async () => response.resolve({ ok: true }));
    });
  });
});
