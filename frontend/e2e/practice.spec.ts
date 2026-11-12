// 기준: Figma S03 지원서 선택 · 기획 메모 S03 지원서 선택 · Swagger 4.3 지원서 목록 · 4.1 지원서 작성
//   · 사용자 결정(2026-10-29: 지원서 쓰기 저장 뒤 S03로 돌아와 새 지원서를 골라 둔다)
// 라디오 · 빈 목록 안내 · [다음] 상태는 컴포넌트 테스트가, 여기서는 주소의 applicationId로 골라 두기를 본다.
import type { Page } from "@playwright/test";

import { expect, test } from "./test";

const group = (page: Page) => page.getByRole("main").getByRole("group", { name: "지원서" });

test.beforeEach(async ({ signIn }) => {
  await signIn();
});

test.describe("S03 · 지원서 선택", () => {
  test.describe("화면 표시", () => {
    test("주소의 applicationId가 목록에 있으면 그 지원서를 골라 둔다", async ({ page }) => {
      await page.goto("/practice?applicationId=9");

      await expect(group(page).getByRole("radio", { name: /△△소프트/ })).toBeChecked();
    });
  });
});
