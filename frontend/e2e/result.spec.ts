// 기준: Figma S07(18:2620) · 기획 메모 S07(18:762) · Swagger 6.3 면접 결과(200 · 404 · 409 예시)
//   · 웹 Swagger 6.3 · RESULT_NOT_READY면 S06-1로, 첫 번째 WEAK · NORMAL 질문만 펼친다
//   · 사용자 결정(2026-10-22: 404 · NO_RESULT면 S03으로, 펼친 질문의 [자세히 보기] → S07-1)
//   · 사용자 결정(2026-11-05: [자세히 보기]는 다시보기에서 그 질문을 펼친 채로 연다)
// 결과 내용 · 펼침 경계는 컴포넌트 테스트(result-view.test.tsx)가, 여기서는 page의 주소 · 응답 분기를 본다.
import type { Page } from "@playwright/test";

import { routeInterviewerModel } from "./mocks/interviewer-model";
import { PROBLEM, RESULT, SESSION_INTERVIEW } from "./mocks/data";
import { api, expect, http, HttpResponse, problemResponse, test } from "./test";

const S07 = `/interview/${RESULT.id}/result`;

const analyzingTitle = (page: Page) =>
  page.getByRole("heading", { name: "면접관이 답변을 검토하고 있어요" });

test.beforeEach(async ({ signIn }) => {
  await signIn();
});

test.describe("S07 · 피드백 결과", () => {
  test.describe("입력 검증", () => {
    test("주소의 면접 번호가 양의 정수가 아니면 지원서 선택으로 보낸다", async ({ page }) => {
      await page.goto("/interview/abc/result");

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
        http.get(api("/interview-sessions/:sessionId/result"), () =>
          problemResponse(PROBLEM.RESULT_NOT_READY),
        ),
        http.get(api("/interview-sessions/:sessionId"), () =>
          HttpResponse.json(SESSION_INTERVIEW.ANALYZING),
        ),
      );
      await page.goto(S07);

      await expect(page).toHaveURL(`/interview/${RESULT.id}`);
      await expect(analyzingTitle(page)).toBeVisible();
    });

    test("면접이 없으면(404 SESSION_NOT_FOUND) 지원서 선택으로 보낸다", async ({ page, msw }) => {
      msw.use(
        http.get(api("/interview-sessions/:sessionId/result"), () =>
          problemResponse(PROBLEM.SESSION_NOT_FOUND),
        ),
      );
      await page.goto(S07);

      await expect(page).toHaveURL("/practice");
    });
  });
});
