// 기준: Figma S01-1 회원가입 · S01-1 기획 메모(가입 완료 → 자동 로그인 → S02-D) · 웹 Swagger 1.1 이메일 사용 가능 여부 · 1.2 회원가입
// 가입이 끝나면 왼쪽 '오늘' 링이 채워진 뒤(motion 완료 콜백) 홈으로 간다. 시계를 멈추지 않고, 이메일 확인(0.4초)은
// '사용할 수 있는 이메일이에요'를, 링 완료는 주소를 웹 우선 단언으로 기다린다.
import type { Page } from "@playwright/test";

import { expect, hydrated, test } from "./test";

const NICKNAME = "면접왕";
const EMAIL = "a@ssafy.com";
const PASSWORD = "abcd1234";

/** 모든 칸을 올바르게 채우고 전체 동의한 뒤 가입한다 */
async function signUp(page: Page) {
  await page.goto("/signup");
  // 하이드레이션 전에 넣은 값은 폼이 붙으며 지워진다
  await hydrated(page.getByLabel("닉네임"));
  await page.getByLabel("닉네임").fill(NICKNAME);
  await page.getByLabel("이메일").fill(EMAIL);
  await page.getByLabel("비밀번호", { exact: true }).fill(PASSWORD);
  await page.getByLabel("비밀번호 확인").fill(PASSWORD);
  await page.getByText("전체 동의").click();
  await expect(page.getByText("사용할 수 있는 이메일이에요")).toBeVisible();
  await page.getByRole("button", { name: "가입하고 시작하기" }).click();
}

test.describe("S01-1 · 회원가입", () => {
  test.describe("사용자 조작", () => {
    test("가입하면 '오늘' 링이 채워진 뒤 S02 홈으로 간다", async ({ page }) => {
      await signUp(page);

      await expect(page).toHaveURL("/home");
    });
  });
});
