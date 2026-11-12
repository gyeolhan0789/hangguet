// 기준: Figma S02 · S02-1 · C01 디자인과 기획 메모 · 모션 메모(S02-1) · 웹 Swagger 3.1 홈(예시 S02 · S02-B) · 1.5 로그아웃
//   · S02-1 인트로는 '하루 1회' 대신 오늘 아직이면 홈에 들어올 때마다 보여 준다(오늘 완료는 제외)
// 상태별 카드 · 이번 주 칸 · 인트로 문구 · 박자 · 프로필 메뉴는 단위 · 컴포넌트 테스트(home-view · buildWeek · streak-intro · app-nav)가,
// 여기서는 page가 3.1과 서버의 오늘로 그리는 홈과 오류 화면의 [다시 시도]를 본다.
import type { Page } from "@playwright/test";

import { HOME, PROBLEM } from "./mocks/data";
import {
  api,
  expect,
  fixServerToday,
  http,
  HttpResponse,
  hydrated,
  problemResponse,
  test,
} from "./test";

/** 서버가 홈을 그릴 '오늘'(Swagger 3.1 예시 날짜, 목요일) */
const TODAY = "2026-10-15";

/** 인트로 덮개(<output aria-label>, 암묵 역할 status) */
const intro = (page: Page) => page.getByRole("status");
const title = (page: Page) => page.getByRole("main").getByRole("heading", { level: 1 });
const weekCells = (page: Page) =>
  page.getByRole("list", { name: "이번 주 연습" }).getByRole("listitem");

test.use({ reducedMotion: "reduce" });

test.beforeEach(async ({ signIn, page }) => {
  await signIn();
  await fixServerToday(page, TODAY);
});

test.describe("S02 · 홈", () => {
  test.describe("홈 화면", () => {
    test.describe("화면 표시", () => {
      test("3.1 응답과 서버의 오늘로 홈을 그린다", async ({ page }) => {
        await page.goto("/home");

        await expect(title(page)).toHaveText("7일째");
        await expect(intro(page)).toHaveCount(0);
        // 첫 칸은 서버의 오늘(10-15)에서 6일 전(10-09 금)이다.
        await expect(weekCells(page).first()).toHaveText("금 연습함");
        await expect(weekCells(page).last()).toHaveText("오늘 아직 안 함");
      });
    });
  });

  test.describe("오류 처리", () => {
    test("홈(3.1)을 받지 못하면 오류 화면을 보이고 [다시 시도]로 다시 그린다", async ({
      page,
      msw,
    }) => {
      // 3.1은 test가 바꾸는 상태를 준다: 실패 → (test가 바꿈) 성공(홈 상태와 상관없어 인트로 없는 오늘 완료)
      const state = { failing: true };
      msw.use(
        http.get(api("/home"), () =>
          state.failing
            ? problemResponse(PROBLEM.INTERNAL_ERROR)
            : HttpResponse.json(HOME.DONE_TODAY),
        ),
      );
      await page.goto("/home");
      await expect(page.getByRole("heading", { name: "화면을 불러오지 못했어요" })).toBeVisible();
      // 헤더는 그대로 남는다.
      await expect(page.getByRole("button", { name: "프로필 메뉴" })).toBeVisible();
      const retry = page.getByRole("button", { name: "다시 시도" });
      await hydrated(retry);

      state.failing = false;
      await retry.click();

      await expect(title(page)).toHaveText("8일째");
    });
  });
});
