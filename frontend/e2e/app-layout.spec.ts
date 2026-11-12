// 기준: Figma C/App Header · 기획 메모 C01 · C03 · 웹 Swagger 2.1 내 정보 · 8.8 공지 목록 · 공통 401(UNAUTHORIZED)
// 대상은 로그인 후 앱 화면의 레이아웃((main)/layout.tsx)이다. export되지 않은 async 서버 컴포넌트라 단위로 볼 수 없다.
// 화면은 /applications(기본 4.x 응답)를 쓴다: /mypage · 설정 · 리뷰는 page가 내 정보를 직접 불러 레이아웃 경로를 가리고,
// /home은 홈 상태(인트로)가 끼어든다.
import type { Page } from "@playwright/test";

import { ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE } from "../src/lib/api/auth-cookies";

import { PROBLEM } from "./mocks/data";
import { api, cookie, expect, http, hydrated, problemResponse, test } from "./test";

const header = (page: Page) => page.getByRole("banner");

/** 지원 관리 본문이 열리고, 헤더 메뉴(내 정보를 기다리는 자리)가 다 그려질 때까지 기다린다 */
async function openApplications(page: Page) {
  await page.goto("/applications");
  await expect(page.getByRole("heading", { name: "지원 관리" })).toBeVisible();
  await expect(header(page).getByTestId("app-nav-skeleton")).toHaveCount(0);
}

test.describe("C01 · 앱 헤더", () => {
  test.describe("내 정보", () => {
    test.describe("오류 처리", () => {
      test.beforeEach(async ({ signIn, msw }) => {
        await signIn();
        msw.use(http.get(api("/users/me"), () => problemResponse(PROBLEM.INTERNAL_ERROR)));
      });

      test("내 정보를 불러오지 못하면(500) 화면 본문은 열고 헤더 메뉴를 비운다", async ({
        page,
      }) => {
        await openApplications(page);

        await expect(page).toHaveURL("/applications");
        await expect(header(page).getByRole("link", { name: "홈" })).toHaveCount(0);
        await expect(header(page).getByRole("button", { name: "프로필 메뉴" })).toHaveCount(0);
      });
    });

    test.describe("권한 · 로그인", () => {
      test("내 정보가 UNAUTHORIZED면 본문 조회가 성공해도 토큰 쿠키를 지우고 S01 로그인으로 보낸다", async ({
        page,
        context,
        signIn,
        msw,
      }) => {
        msw.use(http.get(api("/users/me"), () => problemResponse(PROBLEM.UNAUTHORIZED)));
        await signIn();

        await page.goto("/applications");

        await expect(page).toHaveURL("/login");
        expect(await cookie(context, ACCESS_TOKEN_COOKIE)).toBeUndefined();
        expect(await cookie(context, REFRESH_TOKEN_COOKIE)).toBeUndefined();
      });
    });
  });

  test.describe("공지", () => {
    test.describe("오류 처리", () => {
      test("공지 목록을 불러오지 못하면(500) 헤더를 열고 공지를 펼치면 '공지가 없어요'를 보인다", async ({
        page,
        signIn,
        msw,
      }) => {
        msw.use(http.get(api("/notices"), () => problemResponse(PROBLEM.INTERNAL_ERROR)));
        await signIn();

        await page.goto("/applications");
        await expect(header(page).getByRole("button", { name: "프로필 메뉴" })).toBeVisible();
        const bell = header(page).getByRole("button", { name: /^공지/ });
        await hydrated(bell);
        await bell.click();

        await expect(header(page).getByRole("menu", { name: "공지" })).toContainText(
          "공지가 없어요",
        );
      });
    });

    test.describe("권한 · 로그인", () => {
      test("공지 목록이 UNAUTHORIZED면 토큰 쿠키를 지우고 S01 로그인으로 보낸다", async ({
        page,
        context,
        signIn,
        msw,
      }) => {
        msw.use(http.get(api("/notices"), () => problemResponse(PROBLEM.UNAUTHORIZED)));
        await signIn();

        await page.goto("/applications");

        await expect(page).toHaveURL("/login");
        expect(await cookie(context, ACCESS_TOKEN_COOKIE)).toBeUndefined();
        expect(await cookie(context, REFRESH_TOKEN_COOKIE)).toBeUndefined();
      });
    });
  });
});
