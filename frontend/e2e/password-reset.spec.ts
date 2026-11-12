// 기준: 웹 Swagger 1.9 비밀번호 재설정 · 사용자 결정(2026-11-08: Figma 시안 없음, 회원가입과 같은 틀)
// 재설정 메일의 링크(/password-reset?token=…)로 들어온다. 주소의 token을 읽는 분기는 page.tsx(서버 컴포넌트)에 있다.
import { expect, test } from "./test";

/** 주소의 token 모양별: page.tsx는 문자열 하나일 때만 token으로 쓴다 */
const INVALID_TOKENS = [
  { label: "없음", url: "/password-reset" },
  { label: "여러 개", url: "/password-reset?token=a&token=b" },
];

test.describe("/password-reset · 비밀번호 재설정", () => {
  test.describe("입력 검증", () => {
    for (const { label, url } of INVALID_TOKENS) {
      test(`주소의 token이 '${label}'이면 처음부터 [재설정 링크 다시 받기] 화면을 보인다`, async ({
        page,
      }) => {
        await page.goto(url);

        await expect(page.getByRole("link", { name: "재설정 링크 다시 받기" })).toBeVisible();
        await expect(page.getByLabel("새 비밀번호")).toHaveCount(0);
      });
    }
  });
});
