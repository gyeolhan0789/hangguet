// 기준: Figma S09-1 설정(18:3157) · 기획 메모 S09-1(18:1251) · Swagger 2.1 내 정보
// 줄마다의 입력 검증 · 서버 응답별 문구 · 모달 동작 · 카카오 콜백은 단위 테스트(settings 컴포넌트 · user/actions.test.ts · callback route.test.ts)가,
// 여기서는 page의 내 정보 없음 분기를 본다.
import { PROBLEM } from "./mocks/data";
import { api, expect, http, problemResponse, test } from "./test";

const S09_1 = "/mypage/settings";

test.describe("S09-1 · 설정", () => {
  test.describe("화면 열기", () => {
    test.describe("권한 · 로그인", () => {
      test("재발급이 실패해 로그인 정보가 없으면 로그인 화면으로 보낸다", async ({
        page,
        signIn,
        msw,
      }) => {
        // 재발급이 500이면 proxy는 쿠키를 지우지 않고 화면에 맡긴다. 액세스 토큰이 없어 page의 내 정보가 비어 있다.
        await signIn({ access: false });
        msw.use(
          http.post(api("/auth/token/refresh"), () => problemResponse(PROBLEM.INTERNAL_ERROR)),
        );

        await page.goto(S09_1);

        await expect(page).toHaveURL("/login");
      });
    });
  });
});
