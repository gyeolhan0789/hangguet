import type { Locator, Page } from "@playwright/test";
import type { MswFixture } from "next/experimental/testmode/playwright/msw";

import { E2E_TODAY_HEADER } from "../src/lib/today";
import type { GrowthReviewResponse } from "../src/types/api";

import { GROWTH_REVIEW, PROBLEM, RESULT } from "./mocks/data";
import { recordScreens, screens } from "./screen-log";
import { api, expect, http, HttpResponse, problemResponse, test } from "./test";

// S08 오늘의 성장 리뷰 · S08-B 설문 유도 · S08-C 첫 면접
// 근거: Figma S08(18:2710) · S08-B(18:4578) · S08-C(18:4720) · 기획 메모 S08 · S08-B · S08-C · 모션 메모 S08-B(진입 1.2초 뒤 설문)
//   · Swagger 7.1 날짜별 성장 리뷰(200 S08 · S08-C 예시, 404) · API 명세 7.1(설문 3 · 7 · 21일째, S09 달력 · S02 최근 리뷰에서 지난 날)
//   · 사용자 결정(2026-10-22: 지난 날짜는 '오늘' 문구를 그날 문구로, S07에서 들어왔고 그날 첫 면접이면 'N일째 달성!',
//     설문 주소는 환경 변수(E2E 빌드는 forms.test), 그날 리뷰가 없거나 날짜가 잘못되면 홈으로)
// 사용자 경우: 처음(1일째) · 3일 스트릭(설문) · N일차(8일째) · 7 · 21일째 설문 · 지난 날짜 · 면접을 막 마친 날(첫 면접 · 3일째 · 두 번째 면접)
// 화면 부품의 경계, '설문을 띄우지 않는' 분기(회차가 아닌 날 · 지난 날짜 · 이미 본 회차)는 컴포넌트 테스트(review-view.test.tsx)가 맡는다.
// 설문 타이머는 멈춘 시계를 조금씩 진행해 띄운다(시계를 진행해야만 뜨므로, 보였다는 것이 곧 시계로 띄웠다는 뜻이다).

const SURVEY_HOST = "https://forms.test/**";

/** 7.1이 늘 이 리뷰를 돌려준다. 서버의 '오늘'은 today로 고정한다 */
async function reviewIs(page: Page, msw: MswFixture, review: GrowthReviewResponse, today: string) {
  await page.setExtraHTTPHeaders({ [E2E_TODAY_HEADER]: today });
  msw.use(http.get(api("/growth-reviews/:practiceDate"), () => HttpResponse.json(review)));
}

/** N일째 오늘 리뷰(S08 예시를 스트릭만 바꾼 것) */
const streakDay = (days: number): GrowthReviewResponse => ({
  ...GROWTH_REVIEW.S08,
  streakOnDate: days,
  practiceDates: GROWTH_REVIEW.S08.practiceDates.slice(-Math.min(days, 7)),
});

const survey = (page: Page) => page.getByRole("dialog", { name: "1분만 의견을 들려주세요" });
/** 설문을 이미 본 회차를 적어 두는 곳(survey-modal surveySeenKey) */
const surveySeen = (page: Page, userId: number, round: number) =>
  page.evaluate((key) => localStorage.getItem(key), `hankkeut:survey:${userId}:${round}`);

/** 시계를 멈춘다. 그 뒤 시간은 stepUntilVisible로만 흐른다 */
async function pauseClock(page: Page) {
  await page.clock.install();
  await page.clock.pauseAt(new Date(Date.now() + 1000));
}

/**
 * 멈춘 시계를 50ms씩 직접 진행해 target이 보일 때까지 기다린다.
 * (React가 스트리밍한 Suspense 내용을 보여 주는 것도 타이머라, 멈춘 시계에서는 진행시켜야 화면이 나온다)
 */
async function stepUntilVisible(page: Page, target: Locator) {
  await expect(async () => {
    await page.clock.runFor(50);
    await expect(target).toBeVisible({ timeout: 50 });
    // 재시도 사이에 실제 시간을 기다리지 않고 바로 다음 50ms를 진행한다.
  }).toPass({ intervals: [0] });
}

test.describe("S08 성장 리뷰", () => {
  test.beforeEach(async ({ signIn }) => {
    await signIn();
  });

  test("N일차(8일째 오늘): 축하 · 최근 7일 · 오늘 나아진 점 · 다음에 해볼 것을 보여 주고, [오늘은 여기까지]는 홈으로 간다", async ({
    page,
    msw,
  }) => {
    await reviewIs(page, msw, GROWTH_REVIEW.S08, "2026-10-13");
    await page.goto("/reviews/2026-10-13");

    await expect(page).toHaveTitle("성장 리뷰 · 한끗");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("8일째 연습 완료!");
    await expect(page.getByText("10월 13일 · 오늘 면접 1회 · 18분")).toBeVisible();
    await expect(page.getByText("푸른 불꽃 · 8일째")).toBeVisible();
    await expect(
      page.getByRole("list", { name: "최근 7일 연습" }).getByRole("listitem"),
    ).toHaveText([
      "수 연습함",
      "목 연습함",
      "금 연습함",
      "토 연습함",
      "일 연습함",
      "월 연습함",
      "오늘 연습함",
    ]);
    const improved = page.getByRole("region", { name: "오늘 나아진 점" });
    await expect(improved.getByRole("listitem")).toHaveCount(3);
    await expect(improved.getByRole("listitem").nth(0)).toContainText("전달력");
    await expect(improved.getByRole("listitem").nth(0)).toContainText("+8");
    await expect(improved.getByRole("listitem").nth(2)).toContainText("자소서 검증통과");
    const next = page.getByRole("region", { name: "다음에 해볼 것" });
    await expect(next).toContainText("직무 적합성 질문 1개 더 연습하기");
    await expect(next).toContainText("내일 홈에서 다시 알려드려요");

    await page.getByRole("link", { name: "오늘은 여기까지" }).click();
    await expect(page).toHaveURL("/home");
  });

  test("처음(첫 면접 1일째): '1일째 시작!' · 앞으로의 7일 · 오늘의 기준점을 보여 주고, [한 번 더 면접]은 S03으로 간다", async ({
    page,
    msw,
  }) => {
    await reviewIs(page, msw, GROWTH_REVIEW.FIRST, "2026-10-15");
    await page.goto("/reviews/2026-10-15");

    await expect(page.getByRole("heading", { level: 1 })).toHaveText("1일째 시작!");
    await expect(page.getByText("첫 면접을 마쳤어요 · 오늘이 나의 기준점이에요")).toBeVisible();
    await expect(page.getByText("불씨 · 1일째")).toBeVisible();
    await expect(page.getByRole("list", { name: "앞으로의 7일" }).getByRole("listitem")).toHaveText(
      [
        "오늘 연습함",
        "+1 연습 안 함",
        "+2 연습 안 함",
        "+3 연습 안 함",
        "+4 연습 안 함",
        "+5 연습 안 함",
        "+6 연습 안 함",
      ],
    );
    await expect(page.getByText("오늘 나아진 점")).toHaveCount(0);
    await expect(
      page.getByRole("region", { name: "오늘의 기준점" }).getByRole("listitem"),
    ).toHaveText(["직무 적합성좋아요", "자소서 검증아쉬워요", "논리성좋아요", "전달력보통"]);
    await expect(page.getByText("내일부터 나아진 점을 비교해 드려요")).toBeVisible();
    await expect(page.getByRole("region", { name: "다음에 해볼 것" })).toContainText(
      "꼬리 질문엔 근거부터 짧게",
    );

    await page.getByRole("link", { name: "한 번 더 면접" }).click();
    await expect(page).toHaveURL("/practice");
  });

  test("3일 스트릭: 들어오고 잠시 뒤 설문을 띄우고, [설문 참여하기]는 회원 id · 스트릭을 넣은 설문을 새 탭으로 연다", async ({
    page,
    msw,
    context,
  }) => {
    // 새 탭의 구글폼은 실제로 열지 않고 받기만 한다.
    await context.route(SURVEY_HOST, (route) => route.fulfill({ body: "survey" }));
    await reviewIs(page, msw, streakDay(3), "2026-10-13");
    await pauseClock(page);
    await page.goto("/reviews/2026-10-13");
    await stepUntilVisible(page, page.getByText("활활 불꽃 · 3일째"));

    await stepUntilVisible(page, survey(page));
    await expect(survey(page)).toContainText("3일 동안 연습해보니 어땠나요?");
    await expect(survey(page)).toContainText("질문 5개 · 약 1분");

    const [tab] = await Promise.all([
      context.waitForEvent("page"),
      survey(page).getByRole("button", { name: "설문 참여하기" }).click(),
    ]);
    // 로그인한 회원(ME id 1)과 스트릭 3이 주소에 들어간다(E2E 빌드의 설문 주소 형식).
    expect(new URL(tab.url()).searchParams.get("userId")).toBe("1");
    expect(new URL(tab.url()).searchParams.get("streak")).toBe("3");
    await expect(survey(page)).toHaveCount(0);
    expect(await surveySeen(page, 1, 3)).toBe("joined");
  });

  test("3일 스트릭: 설문을 [다음에 할게요]로 닫으면 이 회원의 3일째 회차를 본 것으로 적는다", async ({
    page,
    msw,
  }) => {
    await reviewIs(page, msw, streakDay(3), "2026-10-13");
    await pauseClock(page);
    await page.goto("/reviews/2026-10-13");
    await stepUntilVisible(page, survey(page));

    await survey(page).getByRole("button", { name: "다음에 할게요" }).click();

    await expect(survey(page)).toHaveCount(0);
    // 다시 들어와도 띄우지 않는 것은 이 기록으로 정한다(다시 그려 확인하는 것은 컴포넌트 테스트가 맡는다).
    expect(await surveySeen(page, 1, 3)).toBe("later");
  });

  test("3일 스트릭: 설문은 열리면 첫 버튼(닫기)에 초점이 가고, Tab은 설문 안에서만 돌며, Esc로 닫힌다", async ({
    page,
    msw,
  }) => {
    await reviewIs(page, msw, streakDay(3), "2026-10-13");
    await pauseClock(page);
    await page.goto("/reviews/2026-10-13");
    await stepUntilVisible(page, survey(page));

    const close = survey(page).getByRole("button", { name: "닫기" });
    const join = survey(page).getByRole("button", { name: "설문 참여하기" });
    await expect(close).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(join).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(close).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(survey(page)).toHaveCount(0);
    expect(await surveySeen(page, 1, 3)).toBe("later");
  });

  for (const days of [7, 21]) {
    test(`${days}일째에도 설문을 띄운다`, async ({ page, msw }) => {
      await reviewIs(page, msw, streakDay(days), "2026-10-13");
      await pauseClock(page);
      await page.goto("/reviews/2026-10-13");

      await stepUntilVisible(page, survey(page));
      await expect(survey(page)).toContainText(`${days}일 동안 연습해보니 어땠나요?`);
    });
  }

  test("지난 날짜(3일째를 나중에 연 경우): '오늘' 문구를 그날 문구로 바꾸고, [홈으로] · [면접 연습하기]를 준다", async ({
    page,
    msw,
  }) => {
    await reviewIs(page, msw, streakDay(3), "2026-10-20");
    await page.goto("/reviews/2026-10-13");

    await expect(page.getByText("10월 13일 · 면접 1회 · 18분")).toBeVisible();
    await expect(page.getByText("이날 나아진 점")).toBeVisible();
    await expect(page.getByText("내일 홈에서 다시 알려드려요")).toHaveCount(0);
    await expect(page.getByText("오늘도 연습해 볼까요?")).toBeVisible();
    await expect(
      page.getByRole("list", { name: "최근 7일 연습" }).getByRole("listitem").last(),
    ).toHaveText("화 연습함");

    await page.getByRole("link", { name: "홈으로" }).click();
    await expect(page).toHaveURL("/home");
  });

  test.describe("면접을 막 마친 날(S07 [오늘의 성장 리뷰 보기])", () => {
    // 연출 길이는 컴포넌트 테스트가 본다. 동작 줄이기로 연출을 짧게 하고, 나온 화면은 차례대로 적어 끝난 뒤 확인한다.
    test.use({ reducedMotion: "reduce" });

    /** 6.3 예시 면접(2026-10-15에 끝남)의 S07에서 들어간다. 그날 리뷰는 review로 답한다 */
    async function fromResult(page: Page, msw: MswFixture, review: GrowthReviewResponse) {
      msw.use(
        http.get(api("/interview-sessions/:sessionId/result"), () => HttpResponse.json(RESULT)),
      );
      await reviewIs(page, msw, { ...review, practiceDate: "2026-10-15" }, "2026-10-15");
      await recordScreens(page);
    }

    /** 적어 둔 화면에서 prefix로 시작하는 것의 차례(없으면 -1) */
    const order = (shown: string[], prefix: string) =>
      shown.findIndex((entry) => entry.startsWith(prefix));

    test("그날 첫 면접(1일째)이면 'N일째 달성!'을 먼저 띄우고, 끝나면 리뷰를 보여 주며 들어온 표시를 지운다", async ({
      page,
      msw,
    }) => {
      await fromResult(page, msw, GROWTH_REVIEW.FIRST);
      await page.goto(`/interview/${RESULT.id}/result`);

      await page.getByRole("link", { name: "오늘의 성장 리뷰 보기" }).click();

      await expect(page.getByRole("heading", { level: 1 })).toHaveText("1일째 시작!");
      // 새로고침해도 축하를 다시 띄우지 않게 들어온 표시를 지운다.
      await expect(page).toHaveURL("/reviews/2026-10-15");
      const shown = await screens(page);
      expect(order(shown, "status:1일째 달성!")).toBeGreaterThanOrEqual(0);
      expect(order(shown, "h1:1일째 시작!")).toBeGreaterThan(order(shown, "status:1일째 달성!"));
    });

    test("3일째(설문 회차)면 'N일째 달성!' → 리뷰 → 잠시 뒤 설문 차례로 보여 준다", async ({
      page,
      msw,
    }) => {
      await fromResult(page, msw, streakDay(3));
      await page.goto(`/interview/${RESULT.id}/result`);
      await pauseClock(page);

      await page.getByRole("link", { name: "오늘의 성장 리뷰 보기" }).click();
      await stepUntilVisible(page, survey(page));

      await expect(survey(page)).toContainText("3일 동안 연습해보니 어땠나요?");
      const shown = await screens(page);
      const celebrated = order(shown, "status:3일째 달성!");
      const reviewed = order(shown, "h1:3일째 연습 완료!");
      expect(celebrated).toBeGreaterThanOrEqual(0);
      expect(reviewed).toBeGreaterThan(celebrated);
      expect(order(shown, "dialog:1분만 의견을 들려주세요")).toBeGreaterThan(reviewed);
    });

    test("그날 두 번째 면접이면 스트릭이 이미 올라 축하 없이 리뷰('면접 2회')를 보여 준다", async ({
      page,
      msw,
    }) => {
      await fromResult(page, msw, { ...streakDay(8), interviewCount: 2 });
      await page.goto(`/interview/${RESULT.id}/result`);

      await page.getByRole("link", { name: "오늘의 성장 리뷰 보기" }).click();

      await expect(page.getByText("10월 15일 · 오늘 면접 2회 · 18분")).toBeVisible();
      await expect(page.getByRole("heading", { level: 1 })).toContainText("8일째 연습 완료!");
      // 리뷰가 그려지기 전까지 나온 화면 중에 축하가 없다(축하가 있었다면 리뷰보다 먼저 적힌다).
      expect((await screens(page)).filter((entry) => entry.includes("달성!"))).toEqual([]);
    });
  });

  test("그날 리뷰가 없으면(7.1 404) 홈으로 보낸다", async ({ page, msw }) => {
    msw.use(
      http.get(api("/growth-reviews/:practiceDate"), () =>
        problemResponse(PROBLEM.GROWTH_REVIEW_NOT_FOUND),
      ),
    );
    await page.goto("/reviews/2026-10-01");

    await expect(page).toHaveURL("/home");
  });

  for (const date of ["2026-13-01", "2026-02-30", "abc"]) {
    test(`주소의 날짜가 잘못됐으면(${date}) 홈으로 보낸다`, async ({ page }) => {
      await page.goto(`/reviews/${date}`);

      await expect(page).toHaveURL("/home");
    });
  }
});
