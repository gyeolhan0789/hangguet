// 기준: Figma S05-1 면접 방식 선택(18:2219) · 기획 메모 S05-1(화상 → S05 장치 점검, [다음]을 누를 때 면접 만들기)
//   · Swagger 4.2 지원서 조회 · 5.1 면접 만들기
// [다음] 문구 · 중복 제출 · 실패 문구 · 멱등 키는 컴포넌트 · 단위 테스트가, 여기서는 page의 주소 분기를 본다.

import { APPLICATION, PROBLEM } from "./mocks/data";
import { api, expect, http, problemResponse, test } from "./test";

const S05_1 = `/practice/mode?applicationId=${APPLICATION.id}&persona=DEVIL`;

test.beforeEach(async ({ signIn }) => {
  await signIn();
});

test.describe("S05-1 · 면접 방식 선택", () => {
  test.describe("입력 검증", () => {
    test("주소의 지원서 id 형식이 틀리면 S03로 돌려보낸다", async ({ page }) => {
      await page.goto("/practice/mode?applicationId=abc&persona=DEVIL");

      await expect(page).toHaveURL("/practice");
    });

    test("면접관을 고르지 않고 오면 S04로 돌려보낸다", async ({ page }) => {
      await page.goto(`/practice/mode?applicationId=${APPLICATION.id}`);

      await expect(page).toHaveURL(`/practice/interviewer?applicationId=${APPLICATION.id}`);
    });
  });

  test.describe("오류 처리", () => {
    test("지원서를 찾을 수 없으면(4.2 404) S03로 돌려보낸다", async ({ page, msw }) => {
      msw.use(
        http.get(api("/applications/:applicationId"), () =>
          problemResponse(PROBLEM.APPLICATION_NOT_FOUND),
        ),
      );
      await page.goto(S05_1);

      await expect(page).toHaveURL("/practice");
    });
  });
});
