import type { Page } from "@playwright/test";

import { NOTICES } from "./mocks/data";
import { api, expect, http, HttpResponse, test } from "./test";

// 모바일(sm 미만) 헤더: 로고 + 햄버거만 두고, 기존 메뉴 · C01 프로필 메뉴 · 다크 모드 토글은 햄버거를 열면 보인다. sm 이상은 그대로다.
// 근거: Figma 모바일 설계 없음 → 사용자 결정(2026-10-26) · Figma C/App Header · S00 Landing Nav · C01 · C03 · 기획 메모 C01 · C02 · C03
// · Swagger 2.1 내 정보 · 8.8 공지 목록 · 8.9 공지 확인
// 열고 닫기 · 공지 줄 펼침 · 스크롤 잠금은 컴포넌트 테스트(header.test.tsx · mobile-menu.test.tsx)가, 여기서는 실제 화면 폭에서 보이는
// 메뉴 항목 · 이동 · 서버 액션(8.9 · 1.5)을 본다.

const MOBILE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 800 };

const header = (page: Page) => page.getByRole("banner");
const hamburger = (page: Page) => header(page).getByRole("button", { name: "메뉴", exact: true });
const menu = (page: Page) => page.getByRole("navigation", { name: "전체 메뉴" });

async function openMenu(page: Page) {
  await hamburger(page).click();
  await expect(menu(page)).toBeVisible();
}

test.describe("모바일 · 로그인 전", () => {
  test.use({ viewport: MOBILE });

  test("S00 랜딩: 헤더에는 로고와 햄버거만 있고, 열면 로그인 전 메뉴 · 다크 모드가 보인다", async ({
    page,
  }) => {
    await page.goto("/");

    await expect(hamburger(page)).toBeVisible();
    await expect(header(page).getByRole("link", { name: "시작하기" })).toBeHidden();
    await expect(header(page).getByRole("button", { name: "라이트·다크 모드 전환" })).toBeHidden();

    await openMenu(page);
    await expect(hamburger(page)).toHaveAttribute("aria-expanded", "true");
    for (const name of ["문의하기", "서비스 소개", "로그인", "시작하기"]) {
      await expect(menu(page).getByRole("link", { name })).toBeVisible();
    }
    await expect(menu(page).getByRole("button", { name: "라이트·다크 모드 전환" })).toBeVisible();
  });

  test("S00 랜딩 히어로 위에서 열면 헤더에 배경이 깔린다", async ({ page }) => {
    await page.goto("/");
    await expect(header(page)).toHaveAttribute("data-overlay", "true");

    await openMenu(page);
    await expect(header(page)).toHaveAttribute("data-overlay", "false");
  });

  test("Esc · 바깥(dim) · 햄버거 다시 누르기로 닫히고, 닫히면 뒤 화면 스크롤이 풀린다", async ({
    page,
  }) => {
    await page.goto("/");
    const html = page.locator("html");

    await openMenu(page);
    await expect(html).toHaveCSS("overflow", "hidden");
    await page.keyboard.press("Escape");
    await expect(menu(page)).toHaveCount(0);
    await expect(hamburger(page)).toBeFocused();
    await expect(html).not.toHaveCSS("overflow", "hidden");

    await openMenu(page);
    // 메뉴 패널에 가리지 않는 dim 맨 아래쪽을 누른다
    const dim = page.getByTestId("mobile-menu-dim");
    const box = await dim.boundingBox();
    await dim.click({ position: { x: 20, y: (box?.height ?? 0) - 10 } });
    await expect(menu(page)).toHaveCount(0);

    await openMenu(page);
    await hamburger(page).click();
    await expect(menu(page)).toHaveCount(0);
    await expect(html).not.toHaveCSS("overflow", "hidden");
  });

  test("메뉴의 다크 모드 토글로 테마가 바뀐다", async ({ page }) => {
    await page.goto("/");
    const theme = await page.locator("html").getAttribute("data-theme");

    await openMenu(page);
    await menu(page).getByRole("button", { name: "라이트·다크 모드 전환" }).click();
    await expect(page.locator("html")).not.toHaveAttribute("data-theme", theme ?? "");
  });

  test("I04 비회원 문의 확인: 열면 로그인 · 다크 모드가 보이고, [로그인]은 S01로 간다", async ({
    page,
  }) => {
    await page.goto("/inquiries/guest");

    await openMenu(page);
    await expect(menu(page).getByRole("button", { name: "라이트·다크 모드 전환" })).toBeVisible();
    await menu(page).getByRole("link", { name: "로그인" }).click();
    await expect(page).toHaveURL(/\/login$/);
  });
});

test.describe("모바일 · 로그인 후(C/App Header)", () => {
  test.use({ viewport: MOBILE });

  test.beforeEach(async ({ signIn }) => {
    await signIn();
  });

  test("열면 프로필 · 스트릭 · 홈 · 연습 기록 · 공지 · 마이페이지 · 지원 관리 · 문의하기 · 다크 모드 · 로그아웃이 보인다", async ({
    page,
  }) => {
    await page.goto("/mypage");

    await expect(header(page).getByRole("button", { name: "프로필 메뉴" })).toBeHidden();
    await openMenu(page);

    await expect(menu(page).getByText("면접왕")).toBeVisible();
    await expect(menu(page).getByText("example@ssafy.com")).toBeVisible();
    await expect(menu(page).getByText("7일")).toBeVisible();
    for (const [name, href] of [
      ["홈", "/home"],
      ["연습 기록", "/records"],
      ["마이페이지", "/mypage"],
      ["지원 관리", "/applications"],
      ["문의하기", "/inquiries"],
    ] as const) {
      await expect(menu(page).getByRole("link", { name, exact: true })).toHaveAttribute(
        "href",
        href,
      );
    }
    await expect(menu(page).getByRole("button", { name: /^공지/ })).toBeVisible();
    await expect(menu(page).getByRole("button", { name: "라이트·다크 모드 전환" })).toBeVisible();
    await expect(menu(page).getByRole("button", { name: "로그아웃" })).toBeVisible();
  });

  test("[로그아웃]은 확인 없이 1.5를 부르고 랜딩(S00)으로 간다", async ({ page, msw }) => {
    let loggedOut = false;
    msw.use(
      http.post(api("/auth/logout"), () => {
        loggedOut = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await page.goto("/mypage");

    await openMenu(page);
    await menu(page).getByRole("button", { name: "로그아웃" }).click();

    await expect(page).toHaveURL(/\/$/);
    expect(loggedOut).toBe(true);
  });

  test("[연습 기록]을 고르면 메뉴가 닫히고 그 화면으로 가며, 뒤 화면 스크롤이 풀린다", async ({
    page,
  }) => {
    await page.goto("/mypage");

    await openMenu(page);
    await menu(page).getByRole("link", { name: "연습 기록" }).click();

    await expect(page).toHaveURL(/\/records/);
    await expect(menu(page)).toHaveCount(0);
    await expect(hamburger(page)).toHaveAttribute("aria-expanded", "false");
    await expect(page.locator("html")).not.toHaveCSS("overflow", "hidden");
  });

  test("[공지]를 펼쳐 공지를 고르면 메뉴를 닫고 C02로 열고, [확인]하면 8.9로 확인한다", async ({
    page,
    msw,
  }) => {
    const reads: string[] = [];
    msw.use(
      http.get(api("/notices"), () =>
        HttpResponse.json({
          content: NOTICES.content.map((n) => ({
            ...n,
            read: n.read || reads.includes(String(n.id)),
          })),
        }),
      ),
      http.post(api("/notices/:noticeId/read"), ({ params }) => {
        reads.push(String(params.noticeId));
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await page.goto("/mypage");

    await openMenu(page);
    await menu(page).getByRole("button", { name: /^공지/ }).click();
    await menu(page)
      .getByRole("button", { name: /10월 점검 안내/ })
      .click();

    await expect(menu(page)).toHaveCount(0);
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "10월 점검 안내" })).toBeVisible();
    await expect(page.locator("html")).toHaveCSS("overflow", "hidden");
    await dialog.getByRole("button", { name: "확인" }).click();

    await expect(dialog).toHaveCount(0);
    expect(reads).toEqual(["3"]);
    await expect(page.locator("html")).not.toHaveCSS("overflow", "hidden");
  });
});

test.describe("데스크톱(sm 이상)은 그대로", () => {
  test.use({ viewport: DESKTOP });

  test("로그인 전: 햄버거가 없고 기존 메뉴가 헤더에 있다", async ({ page }) => {
    await page.goto("/");

    await expect(hamburger(page)).toBeHidden();
    for (const name of ["문의하기", "서비스 소개", "로그인", "시작하기"]) {
      await expect(header(page).getByRole("link", { name })).toBeVisible();
    }
  });

  test("로그인 후: 햄버거가 없고 홈 · 연습 기록 · 프로필 · 공지가 헤더에 있다", async ({
    page,
    signIn,
  }) => {
    await signIn();
    await page.goto("/mypage");

    await expect(hamburger(page)).toBeHidden();
    await expect(header(page).getByRole("link", { name: "홈" })).toBeVisible();
    await expect(header(page).getByRole("link", { name: "연습 기록" })).toBeVisible();
    await expect(header(page).getByRole("button", { name: "프로필 메뉴" })).toBeVisible();
    await expect(header(page).getByRole("button", { name: /^공지/ })).toBeVisible();
  });

  test("모바일에서 메뉴를 연 채 넓히면 닫히고 스크롤이 풀린다", async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await page.goto("/");
    await openMenu(page);

    await page.setViewportSize(DESKTOP);
    await expect(menu(page)).toHaveCount(0);
    await expect(page.locator("html")).not.toHaveCSS("overflow", "hidden");
  });
});
