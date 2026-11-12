// 기준: Figma 지원 관리 · 목록 · Swagger 4.3 지원서 목록 · 사용자 결정(2026-10-29: 빈 목록이면 목록 상자 없이 페이지 표시만)
// 줄 표시 · 링크는 컴포넌트 테스트(application-list.test)가, 여기서는 서버 컴포넌트의 주소 page 해석 · 쪽 넘김을 본다.
import type { Page } from "@playwright/test";

import { APPLICATION_LIST } from "./mocks/data";
import { api, expect, http, HttpResponse, hydrated, test } from "./test";

const main = (page: Page) => page.getByRole("main");
const rows = (page: Page) => main(page).getByRole("list", { name: "지원서" }).getByRole("link");
const pager = (page: Page) => main(page).getByRole("navigation", { name: "페이지" });

test.beforeEach(async ({ signIn }) => {
  await signIn();
});

test.describe("/applications · 지원 관리", () => {
  test.describe("화면 표시", () => {
    test("지원서가 하나도 없으면 쪽 표시를 '1 / 1'로 보여 준다", async ({ page, msw }) => {
      msw.use(
        http.get(api("/applications"), () =>
          HttpResponse.json({
            content: [],
            page: { size: 10, number: 0, totalElements: 0, totalPages: 0 },
          }),
        ),
      );
      await page.goto("/applications");

      await expect(pager(page)).toContainText("1 / 1");
    });
  });

  test.describe("사용자 조작", () => {
    test("[다음 페이지]를 누르면 다음 쪽 지원서를 보여 준다", async ({ page, msw }) => {
      // 서버처럼 요청한 쪽(page)의 지원서로 답한다.
      msw.use(
        http.get(api("/applications"), ({ request }) =>
          HttpResponse.json(
            new URL(request.url).searchParams.get("page") === "1"
              ? {
                  content: [APPLICATION_LIST.content[1]],
                  page: { size: 10, number: 1, totalElements: 11, totalPages: 2 },
                }
              : {
                  ...APPLICATION_LIST,
                  page: { size: 10, number: 0, totalElements: 11, totalPages: 2 },
                },
          ),
        ),
      );
      await page.goto("/applications");
      const next = main(page).getByRole("link", { name: "다음 페이지" });
      await hydrated(next);

      await next.click();

      await expect(page).toHaveURL("/applications?page=1");
      await expect(rows(page)).toHaveCount(1);
      await expect(rows(page)).toContainText("△△소프트 · 서버 개발자");
      await expect(pager(page)).toContainText("2 / 2");
    });
  });

  test.describe("입력 검증", () => {
    // page는 0 이상의 int32 문자열 하나만 받는다(문자 · 음수 · 여러 개 · int32 최대+1).
    for (const [label, query] of [
      ["abc", "page=abc"],
      ["-1", "page=-1"],
      ["두 개(1 · 2)", "page=1&page=2"],
      ["2147483648", "page=2147483648"],
    ]) {
      test(`주소의 page가 '${label}'이면 첫 쪽을 연다`, async ({ page, msw }) => {
        // 첫 쪽(page 0)에만 지원서가 있다.
        msw.use(
          http.get(api("/applications"), ({ request }) =>
            HttpResponse.json(
              new URL(request.url).searchParams.get("page") === "0"
                ? APPLICATION_LIST
                : { content: [], page: { size: 10, number: 1, totalElements: 2, totalPages: 1 } },
            ),
          ),
        );
        await page.goto(`/applications?${query}`);

        await expect(rows(page)).toHaveCount(2);
        await expect(rows(page).nth(0)).toContainText("○○전자");
        await expect(rows(page).nth(1)).toContainText("△△소프트");
      });
    }
  });
});
