import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MotionGlobalConfig } from "motion/react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { useMobileMenuStore } from "@/stores/mobile-menu-store";
import type { NoticeItem } from "@/types/api";

import { Header } from "./header";
import { MobileMenuLink, MobileNotices } from "./mobile-menu";

// 기준: Figma C/App Header · S00 Landing Nav(sm 이상) · 모바일(sm 미만)은 Figma 설계 없음 → 사용자 결정(2026-10-26)
// 햄버거 열고 닫기 · 스크롤 잠금 · 넓어지면 닫기 · 공지(C02)와 겹칠 때를 본다. 실제 화면 폭 · 이동은 E2E(mobile-header.spec.ts)가 본다.

beforeAll(() => {
  MotionGlobalConfig.skipAnimations = true;
});
afterAll(() => {
  MotionGlobalConfig.skipAnimations = false;
});

// 서버 액션 경계만 바꾼다
const readNotice = vi.fn();
vi.mock("@/lib/notice/actions", () => ({
  readNotice: (...args: unknown[]) => readNotice(...args),
}));
vi.mock("@/lib/auth/actions", () => ({ logout: vi.fn() }));

/** 화면이 넓은지(sm 이상) 테스트가 정하고, 바뀌면 change를 알리는 matchMedia */
function fakeMatchMedia(initial: boolean) {
  let matches = initial;
  const listeners = new Set<() => void>();
  vi.stubGlobal("matchMedia", (media: string) => ({
    get matches() {
      return matches;
    },
    media,
    addEventListener: (_: "change", listener: () => void) => listeners.add(listener),
    removeEventListener: (_: "change", listener: () => void) => listeners.delete(listener),
  }));
  return {
    set(next: boolean) {
      matches = next;
      listeners.forEach((listener) => listener());
    },
  };
}

const NOTICE = {
  id: 3,
  title: "10월 점검 안내",
  content: "10월 30일 02:00~04:00 서비스 점검이 있어요.",
  startsAt: "2026-10-23T09:00:00+09:00",
  read: false,
} satisfies NoticeItem;

let media: ReturnType<typeof fakeMatchMedia>;
beforeEach(() => {
  media = fakeMatchMedia(false);
  useMobileMenuStore.setState({ open: false, notice: null });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.resetAllMocks();
  document.documentElement.style.overflow = "";
});

const hamburger = () => screen.getByRole("button", { name: "메뉴" });
const menu = () => screen.queryByRole("navigation", { name: "전체 메뉴" });
const overflow = () => document.documentElement.style.overflow;

function renderHeader() {
  return render(
    <Header
      menu={
        <>
          <MobileMenuLink href="/records">연습 기록</MobileMenuLink>
          <MobileNotices notices={[NOTICE]} />
        </>
      }
    >
      <a href="/home">홈</a>
    </Header>,
  );
}

describe("Header 모바일 메뉴", () => {
  it("햄버거를 누르면 펼치고(aria-expanded) 뒤 화면 스크롤을 막고, 다시 누르면 닫고 푼다", async () => {
    renderHeader();
    expect(hamburger().getAttribute("aria-expanded")).toBe("false");
    expect(menu()).toBeNull();

    fireEvent.click(hamburger());
    expect(hamburger().getAttribute("aria-expanded")).toBe("true");
    expect(hamburger().getAttribute("aria-controls")).toBe("mobile-menu");
    expect(menu()).not.toBeNull();
    expect(overflow()).toBe("hidden");

    fireEvent.click(hamburger());
    await waitFor(() => expect(menu()).toBeNull());
    expect(overflow()).toBe("");
  });

  it("Esc로 닫고 햄버거로 포커스를 돌린다", async () => {
    renderHeader();
    fireEvent.click(hamburger());

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(menu()).toBeNull());
    expect(document.activeElement).toBe(hamburger());
  });

  it("바깥(dim)을 누르거나 항목을 고르면 닫는다", async () => {
    renderHeader();
    fireEvent.click(hamburger());
    fireEvent.click(screen.getByTestId("mobile-menu-dim"));
    await waitFor(() => expect(menu()).toBeNull());

    fireEvent.click(hamburger());
    fireEvent.click(screen.getByRole("link", { name: "연습 기록" }));
    await waitFor(() => expect(menu()).toBeNull());
    expect(overflow()).toBe("");
  });

  it("열린 채 화면이 sm 이상으로 넓어지면 닫고 스크롤을 풀며, 다시 좁아져도 저절로 열리지 않는다", async () => {
    renderHeader();
    fireEvent.click(hamburger());

    act(() => media.set(true));
    await waitFor(() => expect(menu()).toBeNull());
    expect(overflow()).toBe("");

    act(() => media.set(false));
    await waitFor(() => expect(menu()).toBeNull());
  });

  it("공지를 고르면 메뉴를 닫고 C02만 남기며, [확인]하면 8.9 뒤 스크롤을 푼다", async () => {
    readNotice.mockResolvedValue(undefined);
    renderHeader();
    fireEvent.click(hamburger());
    fireEvent.click(screen.getByRole("button", { name: /^공지/ }));
    fireEvent.click(screen.getByRole("button", { name: /10월 점검 안내/ }));

    await waitFor(() => expect(menu()).toBeNull());
    expect(screen.getByRole("dialog", { name: "10월 점검 안내" })).not.toBeNull();
    expect(overflow()).toBe("hidden");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "확인" }));
    });
    expect(readNotice).toHaveBeenCalledWith(3);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(overflow()).toBe("");
  });
});
