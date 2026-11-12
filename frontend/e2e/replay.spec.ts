// 기준: Swagger 6.4 다시보기(404 · 409 예시)
// 화면 동작은 컴포넌트 테스트(replay-view · replay-questions · video-player)가, 여기서는 page의 주소 · 응답 분기만 본다.
import { routeInterviewerModel } from "./mocks/interviewer-model";
import { PROBLEM, REPLAY, SESSION_INTERVIEW } from "./mocks/data";
import { api, expect, http, HttpResponse, problemResponse, test } from "./test";

const S07_1 = `/interview/${REPLAY.id}/replay`;

test.beforeEach(async ({ signIn }) => {
  await signIn();
});

test.describe("S07-1 · 면접 다시보기", () => {
  test.describe("입력 검증", () => {
    test("주소의 면접 번호가 양의 정수가 아니면 지원서 선택으로 보낸다", async ({ page }) => {
      await page.goto("/interview/abc/replay");

      await expect(page).toHaveURL("/practice");
    });
  });

  test.describe("오류 처리", () => {
    test("아직 분석 중이면(409 RESULT_NOT_READY) 결과 분석 중 화면으로 보낸다", async ({
      page,
      msw,
    }) => {
      await routeInterviewerModel(page, "missing");
      msw.use(
        http.get(api("/interview-sessions/:sessionId/replay"), () =>
          problemResponse(PROBLEM.RESULT_NOT_READY),
        ),
        http.get(api("/interview-sessions/:sessionId"), () =>
          HttpResponse.json(SESSION_INTERVIEW.ANALYZING),
        ),
      );
      await page.goto(S07_1);

      await expect(page).toHaveURL(`/interview/${REPLAY.id}`);
    });

    test("면접이 없으면(404 SESSION_NOT_FOUND) 지원서 선택으로 보낸다", async ({ page, msw }) => {
      msw.use(
        http.get(api("/interview-sessions/:sessionId/replay"), () =>
          problemResponse(PROBLEM.SESSION_NOT_FOUND),
        ),
      );
      await page.goto(S07_1);

      await expect(page).toHaveURL("/practice");
    });
  });
});
