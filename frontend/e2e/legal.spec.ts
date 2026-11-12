// 기준: 「개인정보 보호법」 제30조(처리방침 공개) · lib/legal/documents.ts · lib/routes.ts PUBLIC_PATHS
// 푸터 링크는 고정 링크라 누르지 않고 주소로 연다. 공개 화면 목록을 지키는 테스트가 따로 없어 약관 두 화면을 둔다.
import { expect, test } from "./test";

test.describe("/terms · 서비스 이용약관", () => {
  test.describe("권한 · 로그인", () => {
    test("로그인하지 않아도 이용약관 문서를 연다", async ({ page }) => {
      await page.goto("/terms");

      await expect(page.getByRole("heading", { level: 1, name: "서비스 이용약관" })).toBeVisible();
      await expect(page).toHaveURL("/terms");
    });
  });
});

test.describe("/privacy · 개인정보 처리방침", () => {
  test.describe("권한 · 로그인", () => {
    test("로그인하지 않아도 개인정보 처리방침 문서를 연다", async ({ page }) => {
      await page.goto("/privacy");

      await expect(
        page.getByRole("heading", { level: 1, name: "개인정보 처리방침" }),
      ).toBeVisible();
      await expect(page).toHaveURL("/privacy");
    });
  });
});
