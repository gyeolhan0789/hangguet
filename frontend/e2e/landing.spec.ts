// 기준: Figma S00 랜딩 · S00 기획 메모 · 웹 Swagger 2.1 내 정보(C01 헤더) · 공통 401(UNAUTHORIZED)
// 여기서는 서버 컴포넌트 헤더가 내 정보로 고르는 메뉴 분기를 본다.
import type { Page } from "@playwright/test";

import { ACCESS_TOKEN_COOKIE } from "../src/lib/api/auth-cookies";

import { PROBLEM } from "./mocks/data";
import { api, cookie, expect, http, problemResponse, test } from "./test";

test.use({ colorScheme: "light" });

const header = (page: Page) => page.getByRole("banner");
const startLink = (page: Page) => header(page).getByRole("link", { name: "시작하기", exact: true });
const profileMenu = (page: Page) => header(page).getByRole("button", { name: "프로필 메뉴" });

test.describe("S00 · 랜딩", () => {
  test.describe("헤더 메뉴", () => {
    test.describe("화면 표시", () => {
      test("로그인하지 않았으면 헤더에 [로그인] · [시작하기]를 보이고 프로필 메뉴는 없다", async ({
        page,
      }) => {
        await page.goto("/");

        await expect(header(page).getByRole("link", { name: "로그인" })).toBeVisible();
        await expect(startLink(page)).toBeVisible();
        await expect(profileMenu(page)).toHaveCount(0);
      });

      test("로그인했으면 헤더가 앱 메뉴(홈 · 연습 기록 · 스트릭 · 프로필)로 바뀌고 공지 버튼은 없다", async ({
        page,
        signIn,
      }) => {
        await signIn();

        await page.goto("/");

        await expect(header(page).getByRole("link", { name: "홈" })).toBeVisible();
        await expect(header(page).getByRole("link", { name: "연습 기록" })).toBeVisible();
        await expect(header(page).getByText("7일")).toBeVisible();
        await expect(profileMenu(page)).toBeVisible();
        await expect(header(page).getByRole("link", { name: "로그인" })).toHaveCount(0);
        await expect(startLink(page)).toHaveCount(0);
        await expect(header(page).getByRole("button", { name: /^공지/ })).toHaveCount(0);
      });
    });

    test.describe("오류 처리", () => {
      test("내 정보를 불러오지 못하면(500) 로그인 전 메뉴로 랜딩을 연다", async ({
        page,
        signIn,
        msw,
      }) => {
        msw.use(http.get(api("/users/me"), () => problemResponse(PROBLEM.INTERNAL_ERROR)));
        await signIn();

        await page.goto("/");

        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        await expect(startLink(page)).toBeVisible();
      });
    });

    test.describe("권한 · 로그인", () => {
      test("내 정보가 UNAUTHORIZED면 토큰 쿠키를 지우고 랜딩에 머물러 로그인 전 메뉴를 보인다", async ({
        page,
        context,
        signIn,
        msw,
      }) => {
        msw.use(http.get(api("/users/me"), () => problemResponse(PROBLEM.UNAUTHORIZED)));
        await signIn();

        await page.goto("/");

        // 주소는 처음부터 '/'라 주소로는 기다리지 못한다. 쿠키를 지우는 Route Handler를 거쳐 돌아올 때까지 기다린다.
        await expect.poll(() => cookie(context, ACCESS_TOKEN_COOKIE)).toBeUndefined();
        await expect(page).toHaveURL("/");
        await expect(startLink(page)).toBeVisible();
        await expect(profileMenu(page)).toHaveCount(0);
      });
    });
  });
});
