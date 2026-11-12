// 기준: Figma C/App Header · S00 Landing Nav(첫 화면 위 투명 헤더) · 모바일(sm 미만)은 Figma 설계 없음 → 사용자 결정(2026-10-26:
// 햄버거 패널, 바깥(dim) · Esc · 항목 선택 · 햄버거 다시 누르기로 닫힘) · 기획 메모 C02 · C03(메뉴에서 고른 공지는 C02로)
import { act, fireEvent, render, screen } from "@testing-library/react";
import { motionValue, type MotionValue } from "motion/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useMobileMenuStore } from "@/stores/mobile-menu-store";
import type { NoticeItem } from "@/types/api";

import { Header } from "./header";
import { MobileMenuLink, MobileNotices } from "./mobile-menu";

// 경계 mock: 스크롤 위치(useScroll)는 테스트가 움직이는 값으로, 퇴장 연출(AnimatePresence)은 건너뛴다. 서버 액션(8.9 · 로그아웃)
const scroll = vi.hoisted(() => ({ y: null as MotionValue<number> | null }));
vi.mock("motion/react", async (importOriginal) => ({
  ...(await (await import("@/test/motion")).reducedMotion(importOriginal)),
  useScroll: () => ({ scrollY: scroll.y }),
}));
vi.mock("@/lib/notice/actions", () => ({ readNotice: vi.fn() }));
vi.mock("@/lib/auth/actions", () => ({ logout: vi.fn() }));

// 예시 데이터: Swagger 8.8 200 예시의 첫 공지
const NOTICE: NoticeItem = {
  id: 3,
  title: "10월 점검 안내",
  content: "10월 30일 02:00~04:00 서비스 점검이 있어요.",
  startsAt: "2026-10-23T09:00:00+09:00",
  read: false,
};

/** 화면이 넓은지(sm 이상) 테스트가 정하고, 바뀌면 change를 알리는 matchMedia 대역 */
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
      act(() => {
        matches = next;
        listeners.forEach((listener) => listener());
      });
    },
  };
}

let media: ReturnType<typeof fakeMatchMedia>;

beforeEach(() => {
  media = fakeMatchMedia(false);
  scroll.y = motionValue(0);
  useMobileMenuStore.setState({ open: false, notice: null });
});

const header = () => screen.getByRole("banner");
const hamburger = () => screen.getByRole("button", { name: "메뉴" });
const menu = () => screen.queryByRole("navigation", { name: "전체 메뉴" });
const overflow = () => document.documentElement.style.overflow;
const scrollTo = (y: number) => act(() => scroll.y?.set(y));

function renderHeader({ overlay = false } = {}) {
  return render(
    <Header
      overlay={overlay}
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

describe("Header · 앱 헤더", () => {
  describe("첫 화면 위 헤더", () => {
    describe("화면 표시", () => {
      it("첫 화면 위에 떠 있으면 투명 표시를 붙인다", () => {
        renderHeader({ overlay: true });

        expect(header().getAttribute("data-overlay")).toBe("true");
      });

      it("첫 화면을 벗어나게 스크롤하면 투명 표시를 뗀다", () => {
        renderHeader({ overlay: true });

        scrollTo(window.innerHeight);

        expect(header().getAttribute("data-overlay")).toBe("false");
      });

      it("첫 화면 위여도 메뉴를 열면 투명 표시를 뗀다", () => {
        renderHeader({ overlay: true });

        fireEvent.click(hamburger());

        expect(header().getAttribute("data-overlay")).toBe("false");
      });
    });
  });

  describe("모바일 메뉴", () => {
    describe("사용자 조작", () => {
      it("햄버거를 누르면 메뉴를 펼치고 뒤 화면 스크롤을 막는다", () => {
        renderHeader();

        fireEvent.click(hamburger());

        expect(menu()).not.toBeNull();
        expect(hamburger().getAttribute("aria-expanded")).toBe("true");
        expect(overflow()).toBe("hidden");
      });

      it("Esc를 누르면 닫고 햄버거로 포커스를 돌린다", () => {
        renderHeader();
        fireEvent.click(hamburger());

        fireEvent.keyDown(document, { key: "Escape" });

        expect(menu()).toBeNull();
        expect(document.activeElement).toBe(hamburger());
      });

      it("바깥(dim)을 누르면 닫는다", () => {
        renderHeader();
        fireEvent.click(hamburger());

        fireEvent.click(screen.getByTestId("mobile-menu-dim"));

        expect(menu()).toBeNull();
      });

      it("펼친 상태에서 Esc가 아닌 키를 누르면 메뉴를 그대로 둔다", () => {
        renderHeader();
        fireEvent.click(hamburger());

        fireEvent.keyDown(document, { key: "Enter" });

        expect(menu()).not.toBeNull();
      });

      it("메뉴에서 연 공지 모달이 떠 있으면 Esc로 메뉴를 닫지 않는다", () => {
        renderHeader();
        act(() => useMobileMenuStore.setState({ open: true, notice: NOTICE }));

        fireEvent.keyDown(document, { key: "Escape" });

        expect(menu()).not.toBeNull();
      });
    });

    describe("상태 변화", () => {
      it("열린 채 화면이 넓어지면 닫고 스크롤을 풀며 다시 좁아져도 저절로 열리지 않는다", () => {
        renderHeader();
        fireEvent.click(hamburger());

        media.set(true);
        expect(menu()).toBeNull();
        expect(overflow()).toBe("");

        media.set(false);
        expect(menu()).toBeNull();
      });
    });
  });

  describe("공지 모달", () => {
    describe("사용자 조작", () => {
      it("메뉴에서 공지를 고르면 메뉴가 닫혀도 공지 모달이 남는다", () => {
        renderHeader();
        fireEvent.click(hamburger());
        fireEvent.click(screen.getByRole("button", { name: /^공지/ }));

        fireEvent.click(screen.getByRole("button", { name: /10월 점검 안내/ }));

        expect(menu()).toBeNull();
        expect(screen.getByRole("dialog", { name: "10월 점검 안내" })).toBeDefined();
      });
    });
  });
});
