import type { Page } from "@playwright/test";
import type { MswFixture } from "next/experimental/testmode/playwright/msw";

import { E2E_TODAY_HEADER } from "../src/lib/today";
import { tierOf } from "../src/lib/streak";
import type { GrowthReviewResponse, SessionResponse } from "../src/types/api";

import {
  GROWTH_REVIEW,
  QUESTION_CURRENT,
  RESULT,
  SESSION_ENDED,
  SESSION_INTERVIEW,
} from "./mocks/data";
import { recordScreens, screens } from "./screen-log";
import { api, expect, http, HttpResponse, test } from "./test";

// 면접 끝내기 → 성장 리뷰의 스트릭 레벨업(S02-L)
// 근거: API 명세 5.8(leveledUp은 5.8 응답에만 있어 화면이 S08까지 기억한다) · Figma 흐름 S06-E → S06-1 → S07 → S08(18:134)
//   · 기획 메모 S02-1(완료 'N일째 달성!') · S02-L 레벨업 · 스트릭 뱃지 단계(불씨 1-2 · 활활 3-5 · 황금 6-7 · 푸른 8-13 · 전설 14+)
//   · 사용자 결정(2026-10-22: 레벨업은 5.8에서 넘어온 값으로 띄우고, 새로고침해도 남기며, 레벨업을 넘기면 지운다)
// 경우: 단계가 바뀌는 날(3 · 6 · 8 · 14일째, leveledUp true) · 바로 전날(2 · 5 · 7 · 13일째, false) · 새로고침
// 연출 길이는 컴포넌트 테스트(streak-celebration · level-up)가 맡는다. 여기서는 동작 줄이기로 연출을 짧게 하고,
// 나온 화면('N일째 달성!' → 레벨업 → 리뷰)을 차례대로 적어 끝난 뒤 확인한다(screen-log).

const SESSION_ID = SESSION_INTERVIEW.IN_PROGRESS.id;
const GLB = "**/interview/devil/interviewer.glb";
/** 화면이 결과 분석을 다시 조회하는 간격(interview-room SESSION_POLL_MS) */
const POLL_MS = 2000;
/** 6.3 예시 면접이 끝난 날. S07 [오늘의 성장 리뷰 보기]는 이날 리뷰로 간다 */
const ENDED_ON = "2026-10-15";
const STORE_KEY = "hankkeut:interview";

/** 채팅 면접(Swagger 5.2 '면접 중' 예시의 방식만 CHAT으로 바꾼 것). 카메라 없이 끝낼 수 있다 */
const CHAT: SessionResponse = { ...SESSION_INTERVIEW.IN_PROGRESS, mode: "CHAT" };

/** ENDED_ON이 그날 첫 면접이고 N일째인 리뷰(Swagger 7.1 S08 예시에서 날짜 · 스트릭만 바꾼 것) */
function reviewOn(days: number): GrowthReviewResponse {
  const end = new Date(`${ENDED_ON}T00:00:00Z`);
  const practiceDates = Array.from({ length: Math.min(days, 7) }, (_, i) => {
    const date = new Date(end);
    date.setUTCDate(end.getUTCDate() - i);
    return date.toISOString().slice(0, 10);
  }).reverse();
  return {
    ...GROWTH_REVIEW.S08,
    practiceDate: ENDED_ON,
    comparedDate: practiceDates.at(-2) ?? null,
    streakOnDate: days,
    practiceDates,
    interviewCount: 1,
  };
}

/**
 * 면접 중(5.2) → [끝내기](5.8, leveledUp) → 결과 분석 중 → 결과 완료(COMPLETED면 S07로 보낸다) → 6.3 · 7.1.
 * phase는 테스트가 바꾼다.
 */
function interviewEndsWith(msw: MswFixture, leveledUp: boolean, days: number) {
  const state: { phase: "interview" | "analyzing" | "completed" } = { phase: "interview" };
  msw.use(
    http.get(api("/interview-sessions/:sessionId"), () =>
      HttpResponse.json(
        state.phase === "interview"
          ? CHAT
          : {
              ...SESSION_INTERVIEW.ANALYZING,
              mode: "CHAT",
              status: state.phase === "completed" ? "COMPLETED" : "ANALYZING",
            },
      ),
    ),
    http.get(api("/interview-sessions/:sessionId/questions/current"), () =>
      HttpResponse.json(QUESTION_CURRENT),
    ),
    http.post(api("/interview-sessions/:sessionId/end"), () => {
      state.phase = "analyzing";
      return HttpResponse.json(
        { ...SESSION_ENDED.ANALYZING, mode: "CHAT", leveledUp },
        { status: 202 },
      );
    }),
    http.get(api("/interview-sessions/:sessionId/result"), () => HttpResponse.json(RESULT)),
    http.get(api("/growth-reviews/:practiceDate"), () => HttpResponse.json(reviewOn(days))),
  );
  return state;
}

/** S06에서 [면접 종료] → [끝내기] → S06-1 → 분석이 끝나 S07로 간다 */
async function finishInterview(page: Page, state: ReturnType<typeof interviewEndsWith>) {
  await page.goto(`/interview/${SESSION_ID}`);
  await page.getByRole("button", { name: "면접 종료" }).click();
  await page
    .getByRole("dialog", { name: "면접을 끝낼까요?" })
    .getByRole("button", { name: "끝내기" })
    .click();
  await expect(
    page.getByRole("heading", { name: "면접관이 답변을 검토하고 있어요" }),
  ).toBeVisible();

  state.phase = "completed";
  await page.clock.fastForward(POLL_MS);
  await expect(page).toHaveURL(`/interview/${SESSION_ID}/result`);
}

const levelUp = (page: Page) => page.getByRole("dialog", { name: /달성!$/ });
/** 적어 둔 화면에서 prefix로 시작하는 것의 차례(없으면 -1) */
const order = (shown: string[], prefix: string) =>
  shown.findIndex((entry) => entry.startsWith(prefix));
const reviewTitle = (page: Page, days: number) =>
  page.getByRole("heading", { level: 1, name: `${days}일째 연습 완료!` });

test.describe("면접 끝내기 → 성장 리뷰 레벨업", () => {
  test.use({ reducedMotion: "reduce" });

  test.beforeEach(async ({ page, signIn }) => {
    await signIn();
    await page.setExtraHTTPHeaders({ [E2E_TODAY_HEADER]: ENDED_ON });
    // 3D 모델(32MB)을 받지 않는다. 404면 바로 정지 이미지가 나온다.
    await page.route(GLB, (route) => route.fulfill({ status: 404 }));
    await recordScreens(page);
    await page.clock.install();
  });

  for (const days of [3, 6, 8, 14]) {
    const tier = tierOf(days);
    test(`${days}일째(${tier.name}로 오른 날): 5.8 leveledUp true → S07 → S08 레벨업 → [계속하기] → 리뷰`, async ({
      page,
      msw,
    }) => {
      const state = interviewEndsWith(msw, true, days);
      await finishInterview(page, state);

      await page.getByRole("link", { name: "오늘의 성장 리뷰 보기" }).click();
      const dialog = levelUp(page);
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole("heading", { name: `${tier.name} 달성!` })).toBeVisible();
      await expect(dialog).toContainText(
        `${days}일 연속 연습 · 불꽃이 ${tier.colorWord}으로 바뀌었어요`,
      );
      await expect(dialog.getByRole("button", { name: "계속하기" })).toBeFocused();

      await dialog.getByRole("button", { name: "계속하기" }).click();
      await expect(dialog).toHaveCount(0);
      await expect(reviewTitle(page, days)).toBeVisible();
      await expect(page).toHaveURL(`/reviews/${ENDED_ON}`);
      // 'N일째 달성!' → 레벨업 → 리뷰 차례로 나왔다.
      const shown = await screens(page);
      const celebrated = order(shown, `status:${days}일째 달성!`);
      const leveled = order(shown, `dialog:${tier.name} 달성!`);
      expect(celebrated).toBeGreaterThanOrEqual(0);
      expect(leveled).toBeGreaterThan(celebrated);
      expect(order(shown, `h1:${days}일째 연습 완료!`)).toBeGreaterThan(leveled);
      // 레벨업을 넘겼으면 기억해 둔 값을 지운다.
      expect(await page.evaluate((key) => sessionStorage.getItem(key), STORE_KEY)).toContain(
        '"leveledUp":null',
      );
    });
  }

  for (const days of [2, 5, 7, 13]) {
    test(`${days}일째(단계가 그대로인 날): 5.8 leveledUp false → S08 레벨업 없이 리뷰`, async ({
      page,
      msw,
    }) => {
      const state = interviewEndsWith(msw, false, days);
      await finishInterview(page, state);

      await page.getByRole("link", { name: "오늘의 성장 리뷰 보기" }).click();
      // 리뷰는 축하가 모두 끝나야 나온다. 레벨업이 있었다면 리뷰 대신 레벨업이 떠 있다.
      await expect(reviewTitle(page, days)).toBeVisible();
      await expect(page).toHaveURL(`/reviews/${ENDED_ON}`);
      // 'N일째 달성!'은 나왔고, 리뷰가 나오기까지 레벨업은 한 번도 나오지 않았다.
      const shown = await screens(page);
      expect(order(shown, `status:${days}일째 달성!`)).toBeGreaterThanOrEqual(0);
      expect(
        shown.filter((entry) => entry.startsWith("dialog:") && entry.endsWith("달성!")),
      ).toEqual([]);
    });
  }

  test("S07에서 새로고침해도 5.8의 레벨업을 기억해 S08에서 띄운다", async ({ page, msw }) => {
    const state = interviewEndsWith(msw, true, 6);
    await finishInterview(page, state);

    await page.reload();
    await expect(page.getByRole("link", { name: "오늘의 성장 리뷰 보기" })).toBeVisible();
    await page.getByRole("link", { name: "오늘의 성장 리뷰 보기" }).click();

    await expect(levelUp(page).getByRole("heading", { name: "황금 불꽃 달성!" })).toBeVisible();
  });

  test("S06-1 결과 분석 중에 새로고침해도 레벨업을 지우지 않는다", async ({ page, msw }) => {
    const state = interviewEndsWith(msw, true, 8);
    await page.goto(`/interview/${SESSION_ID}`);
    await page.getByRole("button", { name: "면접 종료" }).click();
    await page
      .getByRole("dialog", { name: "면접을 끝낼까요?" })
      .getByRole("button", { name: "끝내기" })
      .click();
    const analyzing = page.getByRole("heading", { name: "면접관이 답변을 검토하고 있어요" });
    await expect(analyzing).toBeVisible();

    await page.reload();
    await expect(analyzing).toBeVisible();
    state.phase = "completed";
    await page.clock.fastForward(POLL_MS);
    await expect(page).toHaveURL(`/interview/${SESSION_ID}/result`);
    await page.getByRole("link", { name: "오늘의 성장 리뷰 보기" }).click();

    await expect(levelUp(page).getByRole("heading", { name: "푸른 불꽃 달성!" })).toBeVisible();
  });
});
