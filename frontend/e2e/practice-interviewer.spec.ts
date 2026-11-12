// 기준: Figma S04 면접관 선택(18:2122) · 기획 메모 S04 · Swagger 4.2 지원서 조회
//   · 사용자 결정(2026-11-05: 새로 들어올 때마다 새로 그리고, 고른 면접관은 주소 persona로만 미리 고른다)
// 진행 표시 · 면접관 줄 · '곧 만나요!' · [다음] 상태는 컴포넌트 테스트가, 여기서는 page의 주소 분기를 본다.
import type { Page } from "@playwright/test";

import { APPLICATION, PROBLEM } from "./mocks/data";
import { api, expect, http, problemResponse, test } from "./test";

const S04 = `/practice/interviewer?applicationId=${APPLICATION.id}`;

const personaGroup = (page: Page) => page.getByRole("main").getByRole("group", { name: "면접관" });
const persona = (page: Page, name: string) => personaGroup(page).getByRole("radio", { name });

test.beforeEach(async ({ signIn }) => {
  await signIn();
});

test.describe("S04 · 면접관 선택", () => {
  test.describe("화면 표시", () => {
    test("주소에 면접관(persona)이 있으면 그 면접관을 골라 둔다", async ({ page }) => {
      await page.goto(`${S04}&persona=COFFEE_CHAT`);

      await expect(persona(page, "개발자 커피챗")).toBeChecked();
    });
  });

  test.describe("입력 검증", () => {
    test("주소의 지원서 id 형식이 틀리면 S03로 돌려보낸다", async ({ page }) => {
      await page.goto("/practice/interviewer?applicationId=abc");

      await expect(page).toHaveURL("/practice");
    });
  });

  test.describe("오류 처리", () => {
    test("지원서를 찾을 수 없으면(4.2 404) S03로 돌려보낸다", async ({ page, msw }) => {
      msw.use(
        http.get(api("/applications/:applicationId"), () =>
          problemResponse(PROBLEM.APPLICATION_NOT_FOUND),
        ),
      );
      await page.goto(S04);

      await expect(page).toHaveURL("/practice");
    });
  });
});
