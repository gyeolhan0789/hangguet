import { PROBLEM, REPLAY, RESULT, SESSION_INTERVIEW } from "./mocks/data";
import { api, expect, http, HttpResponse, hydrated, problemResponse, test } from "./test";

// S07 피드백 결과
// 근거: Figma S07(18:2620) · 기획 메모 S07(18:762) · 모션 메모 S07(18:2705) · Swagger 6.3 면접 결과(200 · 404 · 409 예시)
//   · 웹 Swagger 6.3 · RESULT_NOT_READY면 S06-1로, 첫 번째 WEAK · NORMAL 질문만 펼친다
//   · 사용자 결정(2026-10-22: 404 · NO_RESULT면 S03으로, 펼친 질문의 [자세히 보기] → S07-1)
//   · 사용자 결정(2026-11-05: [자세히 보기]는 다시보기에서 그 질문을 펼친 채로 연다)
// 화면 부품의 경계는 컴포넌트 테스트(result-view.test.tsx)가 맡고, 여기서는 6.3 응답에 따른 화면과 이동을 본다.

const S07 = `/interview/${RESULT.id}/result`;
/** S06-1이 결과 분석을 다시 조회하는 간격(interview-room SESSION_POLL_MS) */
const POLL_MS = 2000;

test.describe("S07 피드백 결과", () => {
  test.beforeEach(async ({ signIn }) => {
    await signIn();
  });

  test("6.3 결과로 총평 · 기준 4칸 · 질문별 피드백(첫 '보통' 질문만 펼침)을 보여 준다", async ({
    page,
    msw,
  }) => {
    msw.use(
      http.get(api("/interview-sessions/:sessionId/result"), () => HttpResponse.json(RESULT)),
    );
    await page.goto(S07);

    await expect(page).toHaveTitle("피드백 결과 · 한끗");
    await expect(page.getByText("악마 면접관 · ○○전자 백엔드 개발자 · 18분")).toBeVisible();
    await expect(
      page.getByRole("heading", { level: 1, name: "논리는 탄탄했지만, 근거가 조금 아쉬웠어요" }),
    ).toBeVisible();
    await expect(page.getByRole("list", { name: "평가 기준" }).getByRole("listitem")).toHaveCount(
      4,
    );
    await expect(page.getByRole("button", { name: /가장 큰 기술적 문제는/ })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    await expect(page.getByText("해결 방법을 고른 이유가 빠졌어요")).toBeVisible();
    await expect(page.getByRole("button", { name: /1분 자기소개/ })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  test("펼친 질문의 [자세히 보기]를 누르면 S07-1 다시보기에서 그 질문을 펼친다", async ({
    page,
    msw,
  }) => {
    msw.use(
      http.get(api("/interview-sessions/:sessionId/result"), () => HttpResponse.json(RESULT)),
      http.get(api("/interview-sessions/:sessionId/replay"), () =>
        HttpResponse.json({ ...REPLAY, videoUrl: null }),
      ),
    );
    await page.goto(S07);

    await page.getByRole("link", { name: "자세히 보기" }).click();

    await expect(page).toHaveURL(`/interview/${RESULT.id}/replay?q=3`);
    await expect(page.getByRole("heading", { level: 1, name: "면접 다시보기" })).toBeVisible();
    await expect(page.getByRole("button", { name: /가장 큰 기술적 문제는/ })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  // Next.js는 한 번 본 화면을 숨겨 두었다가 다시 보여 준다(Activity). 다시보기에서 다른 질문을 펼쳐 둔 채 나가도
  // 다음 [자세히 보기]는 누른 질문을 펼친다(사용자 결정 2026-11-05).
  test("다시보기에서 다른 질문을 펼쳐 두고 결과로 돌아가도, 다른 질문의 [자세히 보기]는 그 질문을 펼친다", async ({
    page,
    msw,
  }) => {
    msw.use(
      http.get(api("/interview-sessions/:sessionId/result"), () => HttpResponse.json(RESULT)),
      http.get(api("/interview-sessions/:sessionId/replay"), () =>
        HttpResponse.json({ ...REPLAY, videoUrl: null }),
      ),
    );
    await page.goto(S07);
    await page.getByRole("link", { name: "자세히 보기" }).click();
    await expect(page.getByRole("button", { name: /가장 큰 기술적 문제는/ })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    // 펼친 Q3을 접고 Q1을 펼쳐 둔다(서버가 그린 펼친 카드는 하이드레이션 전에 누르면 클릭이 사라진다)
    await hydrated(page.getByRole("button", { name: /가장 큰 기술적 문제는/ }));
    await page.getByRole("button", { name: /가장 큰 기술적 문제는/ }).click();
    await page.getByRole("button", { name: /1분 자기소개/ }).click();
    await expect(page.getByRole("button", { name: /1분 자기소개/ })).toHaveAttribute(
      "aria-expanded",
      "true",
    );

    await page.getByRole("link", { name: "결과로" }).click();
    await expect(page).toHaveURL(S07);
    await page.getByRole("button", { name: /지원한 이유는/ }).click();
    await page
      .getByRole("listitem")
      .filter({ hasText: "백엔드 직무에 지원한 이유는?" })
      .getByRole("link", { name: "자세히 보기" })
      .click();

    await expect(page).toHaveURL(`/interview/${RESULT.id}/replay?q=4`);
    await expect(page.getByRole("button", { name: /지원한 이유는/ })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    await expect(page.getByRole("button", { name: /1분 자기소개/ })).toHaveCount(0);
  });
  test("아직 분석 중이면(409 RESULT_NOT_READY) S06-1 결과 분석 중으로 보낸다", async ({
    page,
    msw,
  }) => {
    // 면접 화면의 3D 모델(32MB)은 받지 않는다(404면 바로 정지 이미지).
    await page.route("**/interview/devil/interviewer.glb", (route) =>
      route.fulfill({ status: 404 }),
    );
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
    await expect(
      page.getByRole("heading", { name: "면접관이 답변을 검토하고 있어요" }),
    ).toBeVisible();
  });

  test("주소의 면접 번호가 잘못됐으면 S03 지원서 선택으로 보낸다", async ({ page }) => {
    await page.goto("/interview/abc/result");

    await expect(page).toHaveURL("/practice");
  });

  for (const [label, problem] of [
    ["면접이 없으면(404 SESSION_NOT_FOUND)", PROBLEM.SESSION_NOT_FOUND],
    ["결과가 없는 면접이면(409 NO_RESULT)", PROBLEM.NO_RESULT],
  ] as const) {
    test(`${label} S03 지원서 선택으로 보낸다`, async ({ page, msw }) => {
      msw.use(
        http.get(api("/interview-sessions/:sessionId/result"), () => problemResponse(problem)),
      );
      await page.goto(S07);

      await expect(page).toHaveURL("/practice");
    });
  }

  test("S06-1이 다시 조회하다 결과가 나오면(5.2 ANALYZING → COMPLETED) S07로 넘어간다", async ({
    page,
    msw,
  }) => {
    await page.route("**/interview/devil/interviewer.glb", (route) =>
      route.fulfill({ status: 404 }),
    );
    // 5.2는 테스트가 바꾸는 상태를 돌려준다(몇 번째 요청인지로 정하지 않는다).
    const state = { status: "ANALYZING" as "ANALYZING" | "COMPLETED" };
    msw.use(
      http.get(api("/interview-sessions/:sessionId"), () =>
        HttpResponse.json(
          state.status === "ANALYZING"
            ? SESSION_INTERVIEW.ANALYZING
            : { ...SESSION_INTERVIEW.ANALYZING, status: "COMPLETED", analysisStep: null },
        ),
      ),
      http.get(api("/interview-sessions/:sessionId/result"), () => HttpResponse.json(RESULT)),
    );
    // 2초 다시 조회는 기다리지 않고 시계를 넘겨 일으킨다.
    await page.clock.install();
    await page.goto(`/interview/${RESULT.id}`);
    await expect(
      page.getByRole("heading", { name: "면접관이 답변을 검토하고 있어요" }),
    ).toBeVisible();

    state.status = "COMPLETED";
    await page.clock.fastForward(POLL_MS);

    await expect(page).toHaveURL(S07);
    await expect(page.getByRole("list", { name: "평가 기준" })).toBeVisible();
  });
});
