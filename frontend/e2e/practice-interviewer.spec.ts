import type { Page } from "@playwright/test";

import { APPLICATION, PROBLEM } from "./mocks/data";
import { api, expect, http, HttpResponse, problemResponse, test } from "./test";

// S04 면접관 선택
// 근거: Figma S04 면접관 선택(18:2122) · 기획 메모 S04(마지막 줄 '또 다른 면접관'은 선택 불가)
//   · 모션 메모 S04('준비 중' 줄 클릭 → 토스트 '곧 만나요!') · Swagger 4.2 지원서 조회 · 4.3 지원서 목록 · 5.1 persona
// 주소 값(applicationId · persona) 경계값은 단위 테스트(queries · personas)가, 토스트가 사라지는 시간은
// 컴포넌트 테스트(persona-list.test.tsx)가 맡는다. 여기서는 사용자 흐름(고르기 · 이동 · 지원서 선택으로 돌아가기)을 본다.

const S04 = `/practice/interviewer?applicationId=${APPLICATION.id}`;
const S03_SELECTED = `/practice?applicationId=${APPLICATION.id}`;

const nextButton = (page: Page) => page.getByRole("button", { name: "다음: 면접 방식" });
const personaGroup = (page: Page) => page.getByRole("main").getByRole("group", { name: "면접관" });
const persona = (page: Page, name: string) => personaGroup(page).getByRole("radio", { name });
/** 사용자는 숨긴 라디오가 아니라 면접관 줄(라벨)을 누른다. */
const choose = (page: Page, name: string) =>
  personaGroup(page).getByText(name, { exact: true }).click();
const comingSoon = (page: Page) =>
  page.getByRole("main").getByRole("button", { name: "또 다른 면접관을 만들고 있어요!" });

test.beforeEach(async ({ signIn }) => {
  await signIn();
});

test.describe("S04 면접관 선택 · 화면", () => {
  test("2단계 진행 표시 · 제목 · 지원서 · 면접관 두 명 · 준비 중 줄 · 버튼이 보이고, 처음에는 [다음]이 비활성이다", async ({
    page,
  }) => {
    await page.goto(S04);
    const main = page.getByRole("main");

    const steps = main.getByRole("list", { name: "면접 준비 단계" }).getByRole("listitem");
    await expect(steps.filter({ hasText: "면접관 선택" })).toHaveAttribute("aria-current", "step");
    await expect(steps.filter({ hasText: "지원서" })).toContainText("완료");
    await expect(main.getByRole("heading", { level: 1 })).toHaveText("오늘은 누구와 면접할까요?");
    await expect(
      main.getByText(`${APPLICATION.companyName} · ${APPLICATION.jobTitle} 면접`),
    ).toBeVisible();

    await expect(personaGroup(page).getByRole("radio")).toHaveCount(3);
    await expect(personaGroup(page).getByRole("radio", { checked: true })).toHaveCount(0);
    await expect(comingSoon(page)).toBeVisible();
    await expect(main.getByRole("link", { name: "지원서 선택" })).toBeVisible();
    await expect(nextButton(page)).toBeDisabled();
  });
});

test.describe("S04 면접관 선택 · 썸네일", () => {
  test("악마 면접관 썸네일(avatar-devil.webp)을 불러온다", async ({ page }) => {
    await page.goto(S04);
    // 썸네일은 장식(alt 없음)이라 이름이 아니라 면접관 목록 안에서 주소로 찾는다.
    const devil = personaGroup(page).locator('img[src*="avatar-devil.webp"]');

    await expect(devil).toHaveJSProperty("complete", true);
    expect(
      await devil.evaluate((element: HTMLImageElement) => element.naturalWidth),
    ).toBeGreaterThan(0);
  });
});

test.describe("S04 면접관 선택 · 고르기", () => {
  test("면접관을 고르면 [다음]이 활성화되고, 누르면 지원서와 고른 면접관을 들고 S05-1 면접 방식으로 간다", async ({
    page,
  }) => {
    await page.goto(S04);

    await choose(page, "개발자 커피챗");
    await expect(persona(page, "개발자 커피챗")).toBeChecked();
    await expect(nextButton(page)).toBeEnabled();
    await choose(page, "악마 면접관");
    await expect(persona(page, "악마 면접관")).toBeChecked();
    await expect(persona(page, "개발자 커피챗")).not.toBeChecked();
    await nextButton(page).click();

    await expect(page).toHaveURL(
      (url) =>
        url.pathname === "/practice/mode" &&
        url.searchParams.get("applicationId") === String(APPLICATION.id) &&
        url.searchParams.get("persona") === "DEVIL",
    );
  });

  test("키보드로 면접관 목록에 들어와 고르고, 방향키로 바꿀 수 있다", async ({ page }) => {
    await page.goto(S04);

    // 목록 바로 앞에서 Tab으로 들어온다: 아무도 고르지 않았으면 첫 면접관에 포커스가 간다.
    await page
      .getByRole("main")
      .getByText(`${APPLICATION.companyName} · `, { exact: false })
      .click();
    await page.keyboard.press("Tab");
    await expect(persona(page, "악마 면접관")).toBeFocused();
    await page.keyboard.press("Space");
    await expect(persona(page, "악마 면접관")).toBeChecked();
    await page.keyboard.press("ArrowDown");
    await expect(persona(page, "개발자 커피챗")).toBeChecked();
    await expect(nextButton(page)).toBeEnabled();
  });

  test("다음 단계에서 돌아오면(주소에 persona) 고른 면접관이 그대로 골라져 있다", async ({
    page,
  }) => {
    await page.goto(`${S04}&persona=COFFEE_CHAT`);

    await expect(persona(page, "개발자 커피챗")).toBeChecked();
    await expect(nextButton(page)).toBeEnabled();
  });
});

test.describe("S04 면접관 선택 · 준비 중 줄", () => {
  test("'또 다른 면접관'은 고를 수 없고, 누르면 '곧 만나요!'를 알린다", async ({ page }) => {
    await page.goto(S04);

    await comingSoon(page).click();

    await expect(page.getByRole("main").getByRole("status")).toHaveText("곧 만나요!");
    await expect(personaGroup(page).getByRole("radio", { checked: true })).toHaveCount(0);
    await expect(nextButton(page)).toBeDisabled();
  });
});

test.describe("S04 면접관 선택 · 지원서", () => {
  test("지원서를 찾을 수 없으면(404) 처음 단계인 S03 지원서 선택으로 돌려보낸다", async ({
    page,
    msw,
  }) => {
    msw.use(
      http.get(api("/applications/:applicationId"), () =>
        problemResponse(PROBLEM.APPLICATION_NOT_FOUND),
      ),
    );
    await page.goto(S04);

    await expect(page).toHaveURL("/practice");
  });

  for (const [name, path] of [
    ["없으면", "/practice/interviewer"],
    ["형식이 틀리면", "/practice/interviewer?applicationId=abc"],
  ]) {
    test(`주소에 지원서가 ${name} S03 지원서 선택으로 돌려보낸다`, async ({ page }) => {
      await page.goto(path);

      await expect(page).toHaveURL("/practice");
    });
  }
});

// 사용자 결정(2026-10-29): 지원서 수정 기능이 없어져 [← 지원서 수정]을 [← 지원서 선택]으로 바꾸고, 그 지원서를 골라 둔 S03로 간다.
test.describe("S04 면접관 선택 · [← 지원서 선택]", () => {
  test("누르면 그 지원서를 골라 둔 S03 지원서 선택으로 돌아간다", async ({ page, msw }) => {
    msw.use(
      http.get(api("/applications"), () =>
        HttpResponse.json({
          content: [
            {
              id: APPLICATION.id,
              companyName: APPLICATION.companyName,
              jobTitle: APPLICATION.jobTitle,
              createdAt: APPLICATION.createdAt,
            },
          ],
          page: { size: 20, number: 0, totalElements: 1, totalPages: 1 },
        }),
      ),
    );
    await page.goto(S04);

    await page.getByRole("link", { name: "지원서 선택" }).click();

    await expect(page).toHaveURL(S03_SELECTED);
    await expect(
      page.getByRole("radio", { name: new RegExp(APPLICATION.companyName) }),
    ).toBeChecked();
  });
});
