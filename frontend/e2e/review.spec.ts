// 기준: Figma S08(18:2710) · S08-B(18:4578) · 기획 메모 S08 · S08-B · 모션 메모 S08-B(진입 1.2초 뒤 설문)
//   · Swagger 7.1 날짜별 성장 리뷰(200 S08 예시 · 404) · 설문 3 · 7 · 21일째
//   · 사용자 결정(2026-10-22: 지난 날짜는 '오늘' 문구를 그날 문구로, 설문 주소는 환경 변수(E2E 빌드는 forms.test),
//     그날 리뷰가 없거나 날짜가 잘못되면 홈으로)
// 카드 내용 · 설문 · 축하 차례는 컴포넌트 테스트(review-view · survey-modal 등)가, 여기서는 page의 주소 · 응답 분기를 본다.

import { PROBLEM } from "./mocks/data";
import { api, expect, homeDoneToday, http, problemResponse, test } from "./test";

test.beforeEach(async ({ signIn, msw }) => {
  await signIn();
  // 홈으로 보내는 test는 홈 상태와 상관없으므로 인트로 없는 홈으로 받는다.
  msw.use(homeDoneToday);
});

test.describe("S08 · 성장 리뷰", () => {
  test.describe("입력 검증", () => {
    test("주소의 날짜가 없는 날이면(2026-02-30) 홈으로 보낸다", async ({ page }) => {
      await page.goto("/reviews/2026-02-30");

      await expect(page).toHaveURL("/home");
    });
  });

  test.describe("오류 처리", () => {
    test("그날 리뷰가 없으면(7.1 404) 홈으로 보낸다", async ({ page, msw }) => {
      msw.use(
        http.get(api("/growth-reviews/:practiceDate"), () =>
          problemResponse(PROBLEM.GROWTH_REVIEW_NOT_FOUND),
        ),
      );
      await page.goto("/reviews/2026-10-01");

      await expect(page).toHaveURL("/home");
    });
  });
});
