import type { Page } from "@playwright/test";
import type { MswFixture } from "next/experimental/testmode/playwright/msw";

import { E2E_TODAY_HEADER } from "../src/lib/today";

import { GROWTH_REVIEW, ME, PRACTICE_LOGS_FIGMA, STATS } from "./mocks/data";
import { api, expect, http, HttpResponse, test } from "./test";

// S09 마이페이지
// 근거: Figma S09 마이페이지(18:2848) · 기획 메모 S09(18:1173: 프로필 → 통계 타일 4개 → 스트릭 달력 · 업적, 날짜 클릭 → 그날의 S08,
//   업적 · 지원 관리는 비활성 · 클릭 불가) · 모션 메모 S09(18:3109: 클릭 시 흔들림 + 토스트 '열심히 만들고 있어요!', ✎ → S09-1 프로필 사진)
//   · Swagger 2.1 내 정보 · 3.2 통계 · 3.3 연습 달력(month=YYYY-MM)
// 달력 칸 계산(띠 · 주 경계 · 오늘 · 앞날)과 시간 표기는 단위 테스트(calendar.test.ts)가, 카운트업 · 월 슬라이드 연출은 브라우저 화면 확인이 맡는다.

/** Figma S09 달력의 '오늘'(2026년 10월 13일) */
const TODAY = "2026-10-13";
test.use({ extraHTTPHeaders: { [E2E_TODAY_HEADER]: TODAY } });

const main = (page: Page) => page.getByRole("main");
const calendar = (page: Page) => main(page).getByRole("grid", { name: /연습 달력/ });

/** 3.3 요청의 month를 모아 두고, 그 달의 연습 기록(Figma와 같은 10월 기록 중 그 달 것)으로 답한다. */
function recordMonths(msw: MswFixture) {
  const months: (string | null)[] = [];
  msw.use(
    http.get(api("/practice-logs"), ({ request }) => {
      const month = new URL(request.url).searchParams.get("month");
      months.push(month);
      return HttpResponse.json({
        content: PRACTICE_LOGS_FIGMA.content.filter((log) =>
          log.practiceDate.startsWith(`${month}-`),
        ),
      });
    }),
  );
  return months;
}

test.beforeEach(async ({ signIn }) => {
  await signIn();
});

test.describe("S09 마이페이지 · 프로필 · 통계", () => {
  test("닉네임 · '이메일 · 가입 달 시작' · 최근 직무 칩 · [설정]이 보인다", async ({ page }) => {
    await page.goto("/mypage");

    await expect(main(page).getByRole("heading", { level: 1 })).toHaveText(ME.nickname);
    await expect(main(page).getByText(`${ME.email} · 2026년 9월 시작`)).toBeVisible();
    await expect(main(page).getByText(`${STATS.latestJobTitle} 준비 중`)).toBeVisible();
    await expect(main(page).getByRole("link", { name: "설정" })).toHaveAttribute(
      "href",
      "/mypage/settings",
    );
  });

  test("면접 기록이 없어 최근 직무가 없으면(latestJobTitle null) 직무 칩을 보여 주지 않는다", async ({
    page,
    msw,
  }) => {
    msw.use(
      http.get(api("/users/me/stats"), () => HttpResponse.json({ ...STATS, latestJobTitle: null })),
    );
    await page.goto("/mypage");

    await expect(main(page).getByRole("heading", { level: 1 })).toHaveText(ME.nickname);
    await expect(main(page).getByText(/준비 중/)).toHaveCount(0);
  });

  test("통계 타일 4개: 현재 스트릭 · 최장 스트릭 · 총 면접 · 총 연습 시간(분 → 시간 · 분)", async ({
    page,
  }) => {
    await page.goto("/mypage");
    const tiles = main(page).getByRole("list", { name: "통계" }).getByRole("listitem");

    await expect(tiles).toHaveCount(4);
    // 숫자는 0부터 세어 올라가므로, 화면 읽기 프로그램이 읽는 최종 값(sr-only)과 이름으로 확인한다.
    await expect(tiles.nth(0)).toContainText("7일현재 스트릭");
    await expect(tiles.nth(1)).toContainText("12일최장 스트릭");
    await expect(tiles.nth(2)).toContainText("23회총 면접");
    await expect(tiles.nth(3)).toContainText("6시간 40분총 연습 시간");
  });
});

test.describe("S09 마이페이지 · 스트릭 달력", () => {
  test("이번 달을 보여 주고, 연습한 날 · 오늘은 누를 수 있으며 앞날은 누를 수 없다", async ({
    page,
    msw,
  }) => {
    const months = recordMonths(msw);
    // '지금 N일 연속'은 3.2 통계의 currentStreak에서 온다(API 명세 3.3). 헤더(2.1)의 값과 구분되게 바꿔 둔다.
    msw.use(
      http.get(api("/users/me/stats"), () => HttpResponse.json({ ...STATS, currentStreak: 5 })),
    );
    await page.goto("/mypage");

    await expect(main(page).getByText("2026년 10월", { exact: true })).toBeVisible();
    // 처음 화면을 그릴 때 이번 달을 부른다(링크 미리 불러오기로 다른 달을 더 부를 수 있어 첫 요청만 본다).
    expect(months[0]).toBe("2026-10");
    await expect(calendar(page).getByRole("link", { name: "10월 1일 연습함" })).toBeVisible();
    await expect(calendar(page).getByRole("link", { name: "10월 13일 오늘" })).toBeVisible();
    await expect(calendar(page).getByRole("link", { name: "10월 4일" })).toBeVisible();
    await expect(calendar(page).getByRole("link", { name: /10월 14일/ })).toHaveCount(0);
    await expect(calendar(page).getByText("14", { exact: true })).toBeVisible();
    await expect(main(page).getByText("이번 달 10일 연습 · 지금 5일 연속!")).toBeVisible();
  });

  test("연습한 날을 누르면 그날의 S08 성장 리뷰를 지난 날짜 문구('이날' · [홈으로])로 보여 준다", async ({
    page,
    msw,
  }) => {
    recordMonths(msw);
    // 7.1: Swagger 'S08 오늘의 성장 리뷰' 예시를 10월 1일 리뷰로 쓴다.
    msw.use(
      http.get(api("/growth-reviews/:practiceDate"), () =>
        HttpResponse.json({ ...GROWTH_REVIEW.S08, practiceDate: "2026-10-01" }),
      ),
    );
    await page.goto("/mypage");

    await calendar(page).getByRole("link", { name: "10월 1일 연습함" }).click();

    await expect(page).toHaveURL("/reviews/2026-10-01");
    await expect(page.getByText("10월 1일 · 면접 1회 · 18분")).toBeVisible();
    await expect(page.getByRole("region", { name: "이날 나아진 점" })).toBeVisible();
    await expect(page.getByText("오늘도 연습해 볼까요?")).toBeVisible();
    await expect(page.getByRole("link", { name: "홈으로" })).toBeVisible();
  });

  test("‹ · ›로 달을 옮기면 그 달(month)로 3.3을 다시 불러 보여 준다", async ({ page, msw }) => {
    const months = recordMonths(msw);
    await page.goto("/mypage");

    await main(page).getByRole("link", { name: "이전 달" }).click();
    await expect(page).toHaveURL("/mypage?month=2026-09");
    await expect(main(page).getByText("2026년 9월", { exact: true })).toBeVisible();

    await main(page).getByRole("link", { name: "다음 달" }).click();
    await expect(page).toHaveURL("/mypage?month=2026-10");
    await expect(main(page).getByText("2026년 10월", { exact: true })).toBeVisible();
    // 링크 미리 불러오기(prefetch)로 앞뒤 달을 더 부를 수 있어, 순서 대신 옮긴 달을 불렀는지만 본다.
    expect(months).toContain("2026-09");
  });

  test("주소의 month 형식이 틀리면 이번 달을 보여 준다", async ({ page, msw }) => {
    const months = recordMonths(msw);
    await page.goto("/mypage?month=2026-13");

    await expect(main(page).getByText("2026년 10월", { exact: true })).toBeVisible();
    // 처음 화면을 그릴 때 이번 달을 부른다(링크 미리 불러오기로 다른 달을 더 부를 수 있어 첫 요청만 본다).
    expect(months[0]).toBe("2026-10");
  });
});

test.describe("S09 마이페이지 · 준비 중(업적 · 지원 관리)", () => {
  for (const name of [/업적/, /지원 관리/]) {
    test(`${name.source} 카드를 누르면 기능 없이 토스트 '열심히 만들고 있어요!'가 뜬다`, async ({
      page,
    }) => {
      await page.goto("/mypage");
      const card = main(page).getByRole("button", { name });

      await card.click();

      await expect(
        page.getByRole("status").filter({ hasText: "열심히 만들고 있어요!" }),
      ).toBeVisible();
      await expect(page).toHaveURL("/mypage");
    });
  }
});
