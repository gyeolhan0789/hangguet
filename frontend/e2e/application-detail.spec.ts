// 기준: Figma 지원 관리 · 상세 · 상세 · 면접에 씀 · 삭제 확인 · Swagger 4.2 지원서 조회 · 4.5 지원서 삭제
//   · 4.6 지원서의 연습 면접 목록 · 사용자 결정(2026-10-29: 없는 지원서는 목록으로, 지우면 목록으로)
// 제목 · 문항 · 면접 기록 줄 표시와 삭제 실패 문구는 컴포넌트 · 단위 테스트가, 여기서는 서버 컴포넌트의 주소 분기 · 쪽 넘김 · 삭제 왕복을 본다.
import type { Page } from "@playwright/test";

import { APPLICATION, APPLICATION_LIST, APPLICATION_SESSIONS, PROBLEM } from "./mocks/data";
import { api, expect, http, HttpResponse, hydrated, problemResponse, test } from "./test";

const main = (page: Page) => page.getByRole("main");
const records = (page: Page) => main(page).getByRole("region", { name: "면접 기록" });
const listRows = (page: Page) => main(page).getByRole("list", { name: "지원서" }).getByRole("link");

/** 4.6이 첫 쪽(page 0)에만 면접 기록을 주고, 그 밖의 쪽은 빈 쪽으로 답한다(서버 상태 흉내) */
const sessionsOnFirstPage = http.get(
  api("/applications/:applicationId/interview-sessions"),
  ({ request }) =>
    HttpResponse.json(
      new URL(request.url).searchParams.get("page") === "0"
        ? APPLICATION_SESSIONS
        : { content: [], page: { size: 10, number: 1, totalElements: 2, totalPages: 1 } },
    ),
);

test.beforeEach(async ({ signIn }) => {
  await signIn();
});

test.describe("/applications/[applicationId] · 지원서 상세", () => {
  test.describe("주소", () => {
    test.describe("입력 검증", () => {
      test("주소의 지원서 id 형식이 틀리면 지원 관리 목록으로 보낸다", async ({ page }) => {
        await page.goto("/applications/abc");

        await expect(page).toHaveURL("/applications");
      });

      // page는 0 이상의 int32 문자열 하나만 받는다(문자 · 음수 · 여러 개 · int32 최대+1).
      // 잘못 읽어 0이 아닌 쪽을 부르면 빈 쪽이 와 첫 쪽 주소로 바뀐다.
      for (const [label, query] of [
        ["abc", "page=abc"],
        ["-1", "page=-1"],
        ["두 개(1 · 2)", "page=1&page=2"],
        ["2147483648", "page=2147483648"],
      ]) {
        test(`주소의 page가 '${label}'이면 면접 기록 첫 쪽을 연다`, async ({ page, msw }) => {
          msw.use(sessionsOnFirstPage);
          await page.goto(`/applications/12?${query}`);

          await expect(records(page).getByRole("article")).toHaveCount(2);
          await expect(page).toHaveURL(`/applications/12?${query}`);
        });
      }
    });

    test.describe("경계값", () => {
      test("면접 기록 쪽수를 넘은 주소면 첫 쪽 주소로 바꿔 연다", async ({ page, msw }) => {
        msw.use(sessionsOnFirstPage);
        await page.goto("/applications/12?page=5");

        await expect(page).toHaveURL("/applications/12");
        await expect(records(page).getByRole("article")).toHaveCount(2);
      });

      test("면접 기록이 없는 첫 쪽이면 다른 곳으로 보내지 않고 상세를 연다", async ({ page }) => {
        await page.goto("/applications/10");

        await expect(main(page).getByRole("heading", { level: 1 })).toHaveText(
          "○○전자 · 백엔드 개발자",
        );
        await expect(records(page).getByText("0회")).toBeVisible();
        await expect(page).toHaveURL("/applications/10");
      });
    });

    test.describe("오류 처리", () => {
      for (const [name, path] of [
        ["4.2", "/applications/:applicationId"],
        ["4.6", "/applications/:applicationId/interview-sessions"],
      ]) {
        test(`'${name}'가 없는 지원서(404 APPLICATION_NOT_FOUND)라고 하면 목록으로 보낸다`, async ({
          page,
          msw,
        }) => {
          msw.use(http.get(api(path), () => problemResponse(PROBLEM.APPLICATION_NOT_FOUND)));
          await page.goto("/applications/10");

          await expect(page).toHaveURL("/applications");
        });
      }
    });
  });

  test.describe("면접 기록", () => {
    test.describe("사용자 조작", () => {
      test("면접 기록 [다음 페이지]를 누르면 다음 쪽 기록을 보여 준다", async ({ page, msw }) => {
        // 서버처럼 요청한 쪽(page)의 면접 기록으로 답한다.
        msw.use(
          http.get(api("/applications/:applicationId/interview-sessions"), ({ request }) =>
            HttpResponse.json(
              new URL(request.url).searchParams.get("page") === "1"
                ? {
                    content: [APPLICATION_SESSIONS.content[1]],
                    page: { size: 10, number: 1, totalElements: 11, totalPages: 2 },
                  }
                : {
                    ...APPLICATION_SESSIONS,
                    page: { size: 10, number: 0, totalElements: 11, totalPages: 2 },
                  },
            ),
          ),
        );
        // 쪽 넘김 주소는 4.2가 돌려준 지원서 id로 만든다(기본 핸들러는 APPLICATION).
        await page.goto(`/applications/${APPLICATION.id}`);
        const next = records(page).getByRole("link", { name: "다음 페이지" });
        await hydrated(next);

        await next.click();

        await expect(page).toHaveURL(`/applications/${APPLICATION.id}?page=1`);
        await expect(records(page).getByRole("article")).toHaveCount(1);
        await expect(records(page).getByRole("article")).toHaveAccessibleName(
          "10.20 · 악마 면접관 · 채팅",
        );
        await expect(records(page).getByRole("navigation", { name: "페이지" })).toContainText(
          "2 / 2",
        );
      });
    });
  });

  test.describe("삭제", () => {
    test.describe("사용자 조작", () => {
      test("목록에서 연 지원서를 지우면 그 줄이 빠진 목록으로 가고, 뒤로 가도 지운 지원서 상세로 돌아가지 않는다", async ({
        page,
        msw,
      }) => {
        // 서버 상태 흉내: 4.5로 지운 지원서는 4.3 목록에서 빠지고, 4.2는 주소의 지원서를 돌려준다.
        let deletedId: number | undefined;
        msw.use(
          http.get(api("/applications"), () =>
            HttpResponse.json({
              ...APPLICATION_LIST,
              content: APPLICATION_LIST.content.filter((item) => item.id !== deletedId),
            }),
          ),
          http.get(api("/applications/:applicationId"), ({ params }) =>
            HttpResponse.json({ ...APPLICATION, id: Number(params.applicationId) }),
          ),
          http.delete(api("/applications/:applicationId"), ({ params }) => {
            deletedId = Number(params.applicationId);
            return new HttpResponse(null, { status: 204 });
          }),
        );
        await page.goto("/applications");
        await listRows(page)
          .getByText(/○○전자/)
          .click();
        await expect(page).toHaveURL("/applications/12");
        const remove = main(page).getByRole("button", { name: "삭제" });
        await hydrated(remove);

        await remove.click();
        await page
          .getByRole("dialog", { name: "지원서를 삭제할까요?" })
          .getByRole("button", { name: "삭제" })
          .click();

        await expect(page).toHaveURL("/applications");
        await expect(listRows(page)).toHaveCount(1);
        await expect(listRows(page)).toContainText("△△소프트");
        // 기록을 바꿔치기했으므로 뒤로 가면 지운 지원서 상세가 아니라 그 앞의 목록으로 간다.
        await page.goBack();
        await expect(page).toHaveURL("/applications");
        await expect(listRows(page)).toHaveCount(1);
      });
    });
  });
});
