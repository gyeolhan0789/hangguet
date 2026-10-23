import type { Page } from "@playwright/test";
import type { MswFixture } from "next/experimental/testmode/playwright/msw";

import { E2E_TODAY_HEADER } from "../src/lib/today";
import type { SessionListResponse } from "../src/types/api";

import { GROWTH_REVIEW, RESULT, SESSION_CALENDAR, SESSION_LIST } from "./mocks/data";
import { api, expect, http, HttpResponse, test } from "./test";

// 연습 기록
// 근거: Figma 연습 기록 초안(232:843 · 223:843 와이어프레임 · 메모 223:988) · 웹 Swagger 5.15 월별 연습 면접 횟수(month)
//   · 5.13 연습 면접 목록(practiceDate · page · size 기본 5) · 6.3 · 7.1(경로 값은 면접 시작 날짜)
//   · 사용자 결정(2026-10-23: 들어오면 한국 시간 오늘, 날짜를 고르면 첫 페이지, 달을 넘기면 같은 '일', 미래 달은 못 넘김,
//   빈 날 · 범위 초과 문구, 마이페이지 달력 날짜 → 연습 기록)
// 상태별 줄 모양 · 문구 · 페이지 이동 링크의 경계는 컴포넌트 테스트(day-calendar-card · interview-list)가 맡는다.
// 여기서는 주소 → 서버 조회(5.15 · 5.13 요청 값) → 화면, 그리고 다른 화면으로 이어지는 흐름을 본다.

/** 서버의 '오늘'(목 서버 예시가 있는 10월 20 · 21일 뒤) */
const TODAY = "2026-10-23";
test.use({ extraHTTPHeaders: { [E2E_TODAY_HEADER]: TODAY } });

const main = (page: Page) => page.getByRole("main");
const calendar = (page: Page) => main(page).getByRole("grid", { name: /연습 달력/ });
const list = (page: Page) => main(page).getByRole("region", { name: "면접 목록" });

/** 5.15 · 5.13 요청의 쿼리를 모아 두고, 5.15는 그 달의 날짜별 면접 수(10월은 웹 목 서버 실제 응답, 다른 달은 모두 0),
 * 5.13은 날짜 · 페이지에 맞는 목록으로 답한다(없으면 빈 목록). */
function recordRequests(
  msw: MswFixture,
  lists: Record<string, SessionListResponse> = {
    "2026-10-21": SESSION_LIST.DAILY,
    "2026-10-20": SESSION_LIST.DAY_20,
  },
) {
  const months: Record<string, string>[] = [];
  const sessions: Record<string, string>[] = [];
  msw.use(
    http.get(api("/interview-sessions/calendar"), ({ request }) => {
      const query = Object.fromEntries(new URL(request.url).searchParams);
      months.push(query);
      if (query.month === SESSION_CALENDAR.month) return HttpResponse.json(SESSION_CALENDAR);
      return HttpResponse.json({
        month: query.month,
        content: SESSION_CALENDAR.content.slice(0, 30).map((_, i) => ({
          practiceDate: `${query.month}-${String(i + 1).padStart(2, "0")}`,
          interviewCount: 0,
        })),
      });
    }),
    http.get(api("/interview-sessions"), ({ request }) => {
      const query = Object.fromEntries(new URL(request.url).searchParams);
      sessions.push(query);
      const key =
        query.page && query.page !== "0"
          ? `${query.practiceDate}#${query.page}`
          : query.practiceDate;
      return HttpResponse.json(lists[key] ?? SESSION_LIST.EMPTY);
    }),
  );
  return { months, sessions };
}

test.beforeEach(async ({ signIn }) => {
  await signIn();
});

test.describe("연습 기록", () => {
  test("들어오면 오늘을 고르고, 5.15는 그 달 · 5.13은 오늘 · 첫 페이지 · 5개로 묻는다", async ({
    page,
    msw,
  }) => {
    const { months, sessions } = recordRequests(msw);
    await page.goto("/records");

    await expect(page).toHaveTitle("연습 기록 · 한끗");
    await expect(main(page).getByRole("heading", { level: 1, name: "연습 기록" })).toBeVisible();
    await expect(main(page).getByText("전체 4회")).toBeVisible();
    await expect(main(page).getByRole("heading", { level: 2, name: "10월 23일" })).toBeVisible();
    await expect(main(page).getByText("면접 0회")).toBeVisible();
    await expect(list(page).getByText("이날은 면접 기록이 없어요")).toBeVisible();
    await expect(calendar(page).getByRole("link", { name: "10월 23일 오늘" })).toHaveAttribute(
      "aria-current",
      "date",
    );
    // 요청 순번 · 개수가 아니라 "그 값으로 물었는가"를 본다(프리페치 · 다시 그리기로 요청이 늘 수 있다).
    await expect.poll(() => months).toContainEqual({ month: "2026-10" });
    await expect.poll(() => sessions).toContainEqual({ practiceDate: TODAY, page: "0", size: "5" });
  });

  test("면접한 날(10월 21일): 완료 줄은 [상세 피드백]으로 S07, 분석 중 줄은 상태만 보인다", async ({
    page,
    msw,
  }) => {
    recordRequests(msw);
    msw.use(
      http.get(api("/interview-sessions/:sessionId/result"), () => HttpResponse.json(RESULT)),
    );
    await page.goto("/records?date=2026-10-21");

    await expect(main(page).getByText("면접 2회")).toBeVisible();
    const done = list(page).getByRole("article", { name: "○○전자 백엔드 개발자" });
    await expect(done).toContainText("악마 면접관 · 화상 · 20분");
    await expect(done).toContainText("논리는 탄탄했지만, 근거가 조금 아쉬웠어요");
    await expect(done.getByRole("link", { name: "다시보기" })).toHaveAttribute(
      "href",
      "/interview/55/replay",
    );
    const pending = list(page).getByRole("article", { name: "△△소프트 서버 개발자" });
    await expect(pending).toContainText("분석 중");
    await expect(pending.getByRole("link")).toHaveCount(0);

    await done.getByRole("link", { name: "상세 피드백" }).click();
    await expect(page).toHaveURL("/interview/55/result");
  });

  test("달력에서 다른 날을 누르면 그날(첫 페이지)로 묻고 목록이 바뀐다", async ({ page, msw }) => {
    const { sessions } = recordRequests(msw);
    await page.goto("/records?date=2026-10-21");
    await expect(list(page).getByRole("article")).toHaveCount(2);

    await calendar(page).getByRole("link", { name: "10월 20일 연습함" }).click();

    await expect(page).toHaveURL("/records?date=2026-10-20");
    await expect(main(page).getByRole("heading", { level: 2, name: "10월 20일" })).toBeVisible();
    await expect(list(page).getByRole("article", { name: "△△소프트 서버 개발자" })).toContainText(
      "분석 실패",
    );
    await expect
      .poll(() => sessions)
      .toContainEqual({ practiceDate: "2026-10-20", page: "0", size: "5" });
  });

  test("‹ 이전 달은 그 달의 같은 '일'을 고르고 그 달로 묻는다. 오늘이 든 달이면 › 다음 달은 없다", async ({
    page,
    msw,
  }) => {
    const { months, sessions } = recordRequests(msw);
    await page.goto("/records?date=2026-10-21");
    await expect(main(page).getByRole("link", { name: "다음 달" })).toHaveCount(0);

    await main(page).getByRole("link", { name: "이전 달" }).click();

    await expect(page).toHaveURL("/records?date=2026-09-21");
    await expect(main(page).getByText("2026년 9월")).toBeVisible();
    await expect(main(page).getByRole("heading", { level: 2, name: "9월 21일" })).toBeVisible();
    await expect.poll(() => months).toContainEqual({ month: "2026-09" });
    await expect
      .poll(() => sessions)
      .toContainEqual({ practiceDate: "2026-09-21", page: "0", size: "5" });
  });

  test("여러 페이지면 › 다음 페이지로 그 페이지를 묻고, 범위를 넘은 페이지는 [첫 페이지로] 돌아간다", async ({
    page,
    msw,
  }) => {
    const firstPage: SessionListResponse = {
      ...SESSION_LIST.DAILY,
      page: { size: 5, number: 0, totalElements: 7, totalPages: 2 },
    };
    const secondPage: SessionListResponse = {
      ...SESSION_LIST.DAY_20,
      page: { size: 5, number: 1, totalElements: 7, totalPages: 2 },
    };
    const { sessions } = recordRequests(msw, {
      "2026-10-21": firstPage,
      "2026-10-21#1": secondPage,
      "2026-10-21#9": {
        ...SESSION_LIST.EMPTY,
        page: { size: 5, number: 9, totalElements: 7, totalPages: 2 },
      },
    });
    await page.goto("/records?date=2026-10-21");
    await expect(main(page).getByRole("navigation", { name: "페이지" })).toHaveText("1 / 2");

    await main(page).getByRole("link", { name: "다음 페이지" }).click();

    await expect(page).toHaveURL("/records?date=2026-10-21&page=1");
    await expect(main(page).getByRole("navigation", { name: "페이지" })).toHaveText("2 / 2");
    await expect
      .poll(() => sessions)
      .toContainEqual({ practiceDate: "2026-10-21", page: "1", size: "5" });

    await page.goto("/records?date=2026-10-21&page=9");
    await expect(list(page).getByText("이 페이지에는 기록이 없어요")).toBeVisible();
    await list(page).getByRole("link", { name: "첫 페이지로" }).click();
    await expect(page).toHaveURL("/records?date=2026-10-21");
    await expect(list(page).getByRole("article")).toHaveCount(2);
  });

  test("[이날 성장 리뷰 보기]는 그날의 S08로 간다", async ({ page, msw }) => {
    recordRequests(msw);
    msw.use(
      http.get(api("/growth-reviews/:practiceDate"), () =>
        HttpResponse.json({ ...GROWTH_REVIEW.S08, practiceDate: "2026-10-21" }),
      ),
    );
    await page.goto("/records?date=2026-10-21");

    await main(page).getByRole("link", { name: "이날 성장 리뷰 보기" }).click();

    await expect(page).toHaveURL("/reviews/2026-10-21");
    await expect(page.getByText("10월 21일 · 면접 1회 · 18분")).toBeVisible();
  });

  for (const date of ["2026-10-24", "2026-02-30", "abc"]) {
    test(`주소의 날짜가 미래이거나 잘못됐으면(${date}) 오늘로 보낸다`, async ({ page, msw }) => {
      recordRequests(msw);
      await page.goto(`/records?date=${date}`);

      await expect(page).toHaveURL("/records");
      await expect(main(page).getByRole("heading", { level: 2, name: "10월 23일" })).toBeVisible();
    });
  }

  test("헤더 [연습 기록]으로 들어온다", async ({ page, msw }) => {
    recordRequests(msw);
    await page.goto("/mypage");

    await page
      .getByRole("navigation", { name: "주요 메뉴" })
      .getByRole("link", { name: "연습 기록" })
      .click();

    await expect(page).toHaveURL("/records");
    await expect(main(page).getByRole("heading", { level: 1, name: "연습 기록" })).toBeVisible();
  });
});
