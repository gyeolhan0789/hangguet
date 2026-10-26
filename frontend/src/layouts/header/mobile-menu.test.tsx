import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useMobileMenuStore } from "@/stores/mobile-menu-store";
import type { NoticeItem } from "@/types/api";

import { MobileMenuLink, MobileNotices } from "./mobile-menu";

// 기준: 데스크톱 C03 공지 목록 펼침 · C01 프로필 메뉴(마이페이지 chevron) · 모바일은 사용자 결정(2026-10-26)
// 메뉴 열고 닫기 · C02는 header.test.tsx가 본다.

vi.mock("@/lib/notice/actions", () => ({ readNotice: vi.fn() }));
vi.mock("@/lib/auth/actions", () => ({ logout: vi.fn() }));

const UNREAD = {
  id: 3,
  title: "10월 점검 안내",
  content: "10월 30일 02:00~04:00 서비스 점검이 있어요.",
  startsAt: "2026-10-23T09:00:00+09:00",
  read: false,
} satisfies NoticeItem;
const READ = {
  id: 2,
  title: "채팅 면접이 열렸어요",
  content: "이제 글로도 면접을 볼 수 있어요.",
  startsAt: "2026-10-20T09:00:00+09:00",
  read: true,
} satisfies NoticeItem;

beforeEach(() => {
  useMobileMenuStore.setState({ open: true, notice: null });
});
afterEach(() => {
  cleanup();
});

const noticesButton = () => screen.getByRole("button", { name: /^공지/ });

describe("MobileNotices (공지 줄)", () => {
  it("확인 안 한 공지가 있으면 그렇다고 읽어 주고, 모두 확인했으면 '공지'만", () => {
    const { rerender } = render(<MobileNotices notices={[UNREAD, READ]} />);
    expect(screen.getByRole("button", { name: "공지확인 안 한 공지 있음" })).toBeDefined();

    rerender(<MobileNotices notices={[READ]} />);
    expect(screen.getByRole("button", { name: "공지" })).toBeDefined();
  });

  it("누르면 공지 줄을 받은 순서대로 펼치고 다시 누르면 접는다", () => {
    render(<MobileNotices notices={[UNREAD, READ]} />);
    expect(noticesButton().getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(noticesButton());
    expect(noticesButton().getAttribute("aria-expanded")).toBe("true");
    const list = document.getElementById("mobile-notices");
    expect(list).not.toBeNull();
    expect(
      within(list!)
        .getAllByRole("button")
        .map((row) => row.textContent),
    ).toEqual(["10월 점검 안내2026.10.23 · 확인 안 함", "채팅 면접이 열렸어요2026.10.20 · 확인함"]);

    fireEvent.click(noticesButton());
    expect(document.getElementById("mobile-notices")).toBeNull();
  });

  it("공지가 없으면 '공지가 없어요'", () => {
    render(<MobileNotices notices={[]} />);
    fireEvent.click(noticesButton());
    expect(screen.getByText("공지가 없어요")).not.toBeNull();
  });

  it("공지를 고르면 메뉴를 닫고 그 공지를 열 공지로 둔다(C02는 header.test.tsx)", () => {
    render(<MobileNotices notices={[UNREAD]} />);
    fireEvent.click(noticesButton());
    fireEvent.click(screen.getByRole("button", { name: /10월 점검 안내/ }));

    expect(useMobileMenuStore.getState()).toMatchObject({ open: false, notice: UNREAD });
  });
});

describe("MobileMenuLink", () => {
  it("그 주소로 가는 링크이고, 누르면 메뉴를 닫는다", () => {
    render(
      <MobileMenuLink href="/mypage" icon="/icons/user-round.svg" chevron>
        마이페이지
      </MobileMenuLink>,
    );
    const link = screen.getByRole("link", { name: "마이페이지" });
    expect(link.getAttribute("href")).toBe("/mypage");

    fireEvent.click(link);
    expect(useMobileMenuStore.getState().open).toBe(false);
  });
});
