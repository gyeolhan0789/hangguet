// 기준: Figma 지원서 쓰기 · Swagger 4.1 지원서 작성 · 4.7 회사 목록
//   · 사용자 결정(2026-10-29: 저장 뒤 지원 관리에서 열었으면 새 지원서 상세로) · 사용자 결정(2026-11-03: 회사 목록을 못 불러오면 일반 입력칸)
// 문항 추가 · 글자 수 · 회사 고르기 · 서버 문구는 컴포넌트 · 단위 테스트가, 여기서는 회사 목록 조회 실패 분기와 저장 왕복을 본다.
import type { Page } from "@playwright/test";

import { APPLICATION, APPLICATION_LIST, PROBLEM } from "./mocks/data";
import { api, expect, http, HttpResponse, hydrated, problemResponse, test } from "./test";

const main = (page: Page) => page.getByRole("main");
const listRows = (page: Page) => main(page).getByRole("list", { name: "지원서" }).getByRole("link");

test.beforeEach(async ({ signIn }) => {
  await signIn();
});

test.describe("/applications/new · 지원서 쓰기", () => {
  test.describe("사용자 조작", () => {
    test("지원 관리에서 열어 저장하면 새 지원서 상세로 가고, 뒤로 가면 새 지원서가 든 목록이 다시 그려진다", async ({
      page,
      msw,
    }) => {
      // 서버 상태 흉내: 4.1로 저장한 뒤에는 새 지원서(id 10)가 맨 위에 있는 목록을 돌려준다(4.3 최근 작성순).
      let created = false;
      msw.use(
        http.post(api("/applications"), () => {
          created = true;
          return HttpResponse.json(APPLICATION, { status: 201 });
        }),
        http.get(api("/applications"), () =>
          HttpResponse.json(
            created
              ? {
                  content: [
                    {
                      id: APPLICATION.id,
                      companyName: APPLICATION.companyName,
                      jobTitle: APPLICATION.jobTitle,
                      createdAt: APPLICATION.createdAt,
                    },
                    ...APPLICATION_LIST.content,
                  ],
                  page: {
                    ...APPLICATION_LIST.page,
                    totalElements: APPLICATION_LIST.page.totalElements + 1,
                  },
                }
              : APPLICATION_LIST,
          ),
        ),
      );
      await page.goto("/applications");
      await expect(listRows(page)).toHaveCount(2);
      const write = main(page).getByRole("link", { name: "+ 지원서 쓰기" });
      await hydrated(write);
      await write.click();
      await expect(page).toHaveURL("/applications/new");
      // 폼(react-hook-form)이 붙기 전에 쓰면 값이 기본값으로 돌아가 [저장하기]가 켜지지 않는다.
      await hydrated(page.getByRole("button", { name: "저장하기" }));

      await page.getByLabel("회사명").fill("○○전자");
      await page.getByLabel("직무").fill("백엔드 개발자");
      await page.getByLabel("문항 1", { exact: true }).fill("지원 동기");
      await page.getByLabel("문항 1 답변").fill("저는…");
      await page.getByRole("button", { name: "저장하기" }).click();

      await expect(page).toHaveURL(`/applications/${APPLICATION.id}`);
      // 저장 뒤 기록을 바꿔치기해, 뒤로 가면 지원서 쓰기가 아니라 목록으로 간다.
      await page.goBack();
      await expect(page).toHaveURL("/applications");
      // 저장 액션이 refresh로 BFCache를 비웠으므로, 저장 전에 본 목록이 아니라 새 지원서가 맨 위에 든 4.3을 다시 받는다.
      await expect(listRows(page)).toHaveCount(3);
      await expect(listRows(page).first()).toHaveAttribute(
        "href",
        `/applications/${APPLICATION.id}`,
      );
    });
  });

  test.describe("오류 처리", () => {
    test("회사 목록을 받지 못하면(4.7 500) 회사명은 목록 없는 일반 입력칸이다", async ({
      page,
      msw,
    }) => {
      msw.use(http.get(api("/companies"), () => problemResponse(PROBLEM.INTERNAL_ERROR)));
      await page.goto("/applications/new");

      await expect(page.getByLabel("회사명")).toBeVisible();
      // 목록 칸은 숨기는 것이 아니라 그리지 않는다(company-combobox.tsx 빈 목록 갈래). 숨긴 요소까지 세어 0개인지 본다.
      await expect(page.getByRole("combobox", { name: "회사명", includeHidden: true })).toHaveCount(
        0,
      );
      await expect(page.getByRole("listbox", { includeHidden: true })).toHaveCount(0);
    });
  });

  test.describe("권한 · 로그인", () => {
    test("회사 목록이 로그인 풀림(401 UNAUTHORIZED)이면 빈 목록으로 넘기지 않고 로그인 화면으로 보낸다", async ({
      page,
      msw,
    }) => {
      msw.use(http.get(api("/companies"), () => problemResponse(PROBLEM.UNAUTHORIZED)));
      await page.goto("/applications/new");

      await expect(page).toHaveURL("/login");
    });
  });
});
