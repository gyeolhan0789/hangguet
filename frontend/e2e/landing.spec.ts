import type { Page } from "@playwright/test";

import { ACCESS_TOKEN_COOKIE } from "../src/lib/api/auth-cookies";

import { AUTH_TOKENS, ME, PROBLEM } from "./mocks/data";
import { api, expect, http, HttpResponse, problemResponse, test } from "./test";

// S00 랜딩
// 근거: Figma S00 디자인 프로토타입 연결, S00 기획 메모, API 명세 2.1(C01 헤더)
test.use({ colorScheme: "light" });

/** 히어로(첫 화면)의 [무료로 시작하기] */
const heroCta = (page: Page) =>
  page.getByRole("region", { name: /면접 준비/ }).getByRole("link", { name: "무료로 시작하기" });

test.describe("S00 랜딩 · 로그인 전", () => {
  test("첫 화면(fold)에 헤드라인 · 서브 카피 · CTA가 보인다", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByRole("heading", { level: 1 })).toHaveText(/면접 준비,\s*이제 습관처럼/);
    await expect(page.getByText("말하는 동안 반응하는 면접관과 매일 10분씩")).toBeInViewport();
    await expect(heroCta(page)).toBeInViewport();
  });

  test("[로그인] → S01 로그인", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("banner").getByRole("link", { name: "로그인" }).click();

    await expect(page).toHaveURL("/login");
    await expect(page.getByRole("heading", { name: "로그인" })).toBeVisible();
  });

  test("헤더 [시작하기] → S01-1 회원가입", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("banner").getByRole("link", { name: "시작하기", exact: true }).click();

    await expect(page).toHaveURL("/signup");
    await expect(page.getByRole("heading", { name: "회원가입" })).toBeVisible();
  });

  test("히어로 [무료로 시작하기] → S01-1 회원가입", async ({ page }) => {
    await page.goto("/");
    await heroCta(page).click();

    await expect(page).toHaveURL("/signup");
  });

  test("마지막 CTA [무료로 시작하기] → S01-1 회원가입", async ({ page }) => {
    await page.goto("/");
    const finalCta = page
      .getByRole("region", { name: /오늘부터 1일째/ })
      .getByRole("link", { name: "무료로 시작하기" });
    await finalCta.scrollIntoViewIfNeeded();
    await finalCta.click();

    await expect(page).toHaveURL("/signup");
  });

  test("[어떻게 동작하나요?] → '이렇게 진행돼요' 섹션으로 스크롤", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "어떻게 동작하나요?" }).click();

    await expect(page.getByRole("heading", { name: "하루 10분, 네 단계면 끝" })).toBeInViewport();
    await expect(page.getByText("피드백 · 성장 리뷰")).toBeVisible();
  });

  test("스크롤하면 상단 nav가 고정되고 [시작하기]가 계속 보인다", async ({ page }) => {
    await page.goto("/");
    const header = page.getByRole("banner");
    await expect(header).toHaveAttribute("data-overlay", "true");

    await page.getByRole("heading", { name: "하루 10분, 네 단계면 끝" }).scrollIntoViewIfNeeded();

    await expect(header).toHaveAttribute("data-overlay", "false");
    await expect(header).toBeInViewport();
    await expect(header.getByRole("link", { name: "시작하기", exact: true })).toBeInViewport();
  });

  test("테마 토글: 라이트 ↔ 다크, 새로고침해도 유지된다", async ({ page }) => {
    await page.goto("/");
    const html = page.locator("html");
    const toggle = page.getByRole("button", { name: "라이트·다크 모드 전환" });
    await expect(html).toHaveAttribute("data-theme", "light");

    await toggle.click();
    await expect(html).toHaveAttribute("data-theme", "dark");

    await page.reload();
    await expect(html).toHaveAttribute("data-theme", "dark");

    await toggle.click();
    await expect(html).toHaveAttribute("data-theme", "light");
  });
});

test.describe("S00 랜딩 · OS 다크 모드", () => {
  test.use({ colorScheme: "dark" });

  test("고른 테마가 없으면 OS 설정(다크)을 따른다", async ({ page }) => {
    await page.goto("/");

    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  });
});

test.describe("S00 랜딩 · 로그인 후 (C01 헤더)", () => {
  test("헤더가 앱 메뉴(홈 · 연습 기록 · 스트릭 · 프로필)로 바뀐다", async ({
    page,
    signIn,
    msw,
  }) => {
    let authorization: string | null = null;
    msw.use(
      http.get(api("/users/me"), ({ request }) => {
        authorization = request.headers.get("authorization");
        return HttpResponse.json(ME);
      }),
    );
    await signIn();

    await page.goto("/");
    const header = page.getByRole("banner");

    await expect(header.getByRole("link", { name: "홈" })).toBeVisible();
    await expect(header.getByRole("link", { name: "연습 기록" })).toBeVisible();
    await expect(header.getByText("7일")).toBeVisible();
    await expect(header.getByRole("button", { name: "프로필 메뉴" })).toBeVisible();
    await expect(header.getByRole("link", { name: "로그인" })).toHaveCount(0);
    await expect(header.getByRole("link", { name: "시작하기", exact: true })).toHaveCount(0);
    // 서버가 쿠키의 액세스 토큰을 Bearer로 붙여 내 정보(2.1)를 부른다.
    expect(authorization).toBe(`Bearer ${AUTH_TOKENS.accessToken}`);
  });

  // 401 UNAUTHORIZED(토큰 없음 · 위조 · 탈퇴, API 명세 1장): 남은 토큰 쿠키를 지우고 랜딩에 머문다.
  test("내 정보가 401(UNAUTHORIZED)이면 쿠키를 지우고 랜딩에서 로그인 전 메뉴를 보여 준다", async ({
    page,
    context,
    signIn,
    msw,
  }) => {
    msw.use(http.get(api("/users/me"), () => problemResponse(PROBLEM.UNAUTHORIZED)));
    await signIn();

    await page.goto("/");

    // 주소는 처음부터 "/"라 toHaveURL로는 기다리지 못한다. 쿠키를 지우는 Route Handler를 거쳐 돌아올 때까지 기다린다.
    await expect
      .poll(async () => (await context.cookies()).map((cookie) => cookie.name))
      .not.toContain(ACCESS_TOKEN_COOKIE);
    await expect(page).toHaveURL("/");
    const header = page.getByRole("banner");
    await expect(header.getByRole("link", { name: "시작하기", exact: true })).toBeVisible();
    await expect(header.getByRole("button", { name: "프로필 메뉴" })).toHaveCount(0);
  });

  test("내 정보를 못 불러와도(500) 랜딩은 로그인 전 메뉴로 열린다", async ({
    page,
    signIn,
    msw,
  }) => {
    msw.use(http.get(api("/users/me"), () => problemResponse(PROBLEM.INTERNAL_ERROR)));
    await signIn();

    await page.goto("/");

    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(
      page.getByRole("banner").getByRole("link", { name: "시작하기", exact: true }),
    ).toBeVisible();
  });
});
