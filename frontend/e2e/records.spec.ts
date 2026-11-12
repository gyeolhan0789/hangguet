// 기준: Figma 연습 기록 초안(232:843 · 223:843 와이어프레임 · 메모 223:988) · 웹 Swagger 5.15 월별 연습 면접 횟수(month)
//   · 5.13 연습 면접 목록(practiceDate · page(int32) · size)
//   · 사용자 결정(2026-10-23: 들어오면 한국 시간 오늘, 날짜를 고르면 첫 페이지, 달을 넘기면 같은 '일', 미래 날짜는 고르지 않음,
//   빈 날 · 범위 초과 문구)
// 줄 모양 · 문구 · 링크 경계는 컴포넌트 테스트(day-calendar-card · interview-list)가, 여기서는 page의 주소(date · page) 해석과
// 그에 따라 서버가 그린 달력 · 목록, 달 · 페이지를 넘기는 흐름을 본다.
import type { Page } from "@playwright/test";
import type { MswFixture } from "next/experimental/testmode/playwright/msw";

import type { SessionListResponse } from "../src/types/api";

import { SESSION_CALENDAR, SESSION_LIST } from "./mocks/data";
import { api, expect, fixServerToday, http, HttpResponse, hydrated, test } from "./test";

/** 서버의 '오늘'(목 서버 예시가 있는 10월 20 · 21일 뒤) */
const TODAY = "2026-10-23";
/** Swagger 5.13 page의 최댓값(int32) */
const MAX_PAGE = 2_147_483_647;

const main = (page: Page) => page.getByRole("main");
const calendar = (page: Page) => main(page).getByRole("grid", { name: /연습 달력/ });
const list = (page: Page) => main(page).getByRole("region", { name: "면접 목록" });
const dayTitle = (page: Page, name: string) => main(page).getByRole("heading", { level: 2, name });
const pages = (page: Page) => main(page).getByRole("navigation", { name: "페이지" });

/** 10월 21일 첫 페이지가 2쪽 중 1쪽인 목록(Swagger 예시 '완료·분석 중'의 page만 바꾼 것) */
const DAILY_OF_TWO: SessionListResponse = {
  ...SESSION_LIST.DAILY,
  page: { size: 5, number: 0, totalElements: 7, totalPages: 2 },
};

/**
 * 받은 쿼리에 맞게 답하는 서버 흉내. 5.15는 2026-10이면 웹 목 서버 실제 응답, 2026-09면 9월 21일만 1회, 그 밖의 달은 모두 0.
 * 5.13은 `날짜`(첫 페이지) · `날짜#페이지` 키의 목록, 없으면 '기록 없는 날짜' 예시.
 */
function serveRecords(msw: MswFixture, lists: Record<string, SessionListResponse>) {
  msw.use(
    http.get(api("/interview-sessions/calendar"), ({ request }) => {
      const month = new URL(request.url).searchParams.get("month") ?? "";
      if (month === SESSION_CALENDAR.month) return HttpResponse.json(SESSION_CALENDAR);
      return HttpResponse.json({
        month,
        content: Array.from({ length: 30 }, (_, i) => {
          const practiceDate = `${month}-${String(i + 1).padStart(2, "0")}`;
          return { practiceDate, interviewCount: practiceDate === "2026-09-21" ? 1 : 0 };
        }),
      });
    }),
    http.get(api("/interview-sessions"), ({ request }) => {
      const query = new URL(request.url).searchParams;
      const page = query.get("page") ?? "0";
      const key = page === "0" ? query.get("practiceDate") : `${query.get("practiceDate")}#${page}`;
      return HttpResponse.json(lists[key ?? ""] ?? SESSION_LIST.EMPTY);
    }),
  );
}

/** 첫 페이지(10월 21일 Swagger 예시 줄)가 '1 / 2'로 보인다 */
async function expectFirstOfTwo(page: Page) {
  await expect(pages(page)).toHaveText("1 / 2");
  await expect(list(page).getByRole("article", { name: "○○전자 백엔드 개발자" })).toBeVisible();
}

test.beforeEach(async ({ signIn, page }) => {
  await signIn();
  await fixServerToday(page, TODAY);
});

test.describe("/records · 연습 기록", () => {
  test.describe("화면 표시", () => {
    test("주소에 날짜가 없으면 서버의 오늘을 고르고 그날 기록을 보여 준다", async ({
      page,
      msw,
    }) => {
      serveRecords(msw, { [TODAY]: SESSION_LIST.DAILY });
      await page.goto("/records");

      await expect(dayTitle(page, "10월 23일")).toBeVisible();
      await expect(list(page).getByRole("article")).toHaveCount(2);
    });
  });

  test.describe("사용자 조작", () => {
    test("[이전 달]을 누르면 그달 달력과 같은 '일'의 기록을 보여 준다", async ({ page, msw }) => {
      serveRecords(msw, { "2026-10-21": SESSION_LIST.DAILY });
      await page.goto("/records?date=2026-10-21");
      const previous = main(page).getByRole("link", { name: "이전 달" });
      await hydrated(previous);

      await previous.click();

      await expect(page).toHaveURL("/records?date=2026-09-21");
      await expect(dayTitle(page, "9월 21일")).toBeVisible();
      await expect(main(page).getByText("2026년 9월")).toBeVisible();
      await expect(calendar(page).getByRole("link", { name: "9월 21일 연습함" })).toBeVisible();
    });

    test("[다음 페이지]를 누르면 그 페이지의 기록을 보여 준다", async ({ page, msw }) => {
      serveRecords(msw, {
        "2026-10-21": DAILY_OF_TWO,
        "2026-10-21#1": {
          ...SESSION_LIST.DAY_20,
          page: { size: 5, number: 1, totalElements: 7, totalPages: 2 },
        },
      });
      await page.goto("/records?date=2026-10-21");
      const next = main(page).getByRole("link", { name: "다음 페이지" });
      await hydrated(next);

      await next.click();

      await expect(page).toHaveURL("/records?date=2026-10-21&page=1");
      await expect(pages(page)).toHaveText("2 / 2");
      await expect(list(page).getByRole("article", { name: "△△소프트 서버 개발자" })).toContainText(
        "분석 실패",
      );
    });
  });

  test.describe("입력 검증", () => {
    test("주소의 날짜가 미래이면(2026-10-24) 오늘로 보낸다", async ({ page, msw }) => {
      serveRecords(msw, {});
      await page.goto("/records?date=2026-10-24");

      await expect(page).toHaveURL("/records");
      await expect(dayTitle(page, "10월 23일")).toBeVisible();
    });

    test("주소의 날짜가 없는 날이면(2026-02-30) 오늘로 보낸다", async ({ page, msw }) => {
      serveRecords(msw, {});
      await page.goto("/records?date=2026-02-30");

      await expect(page).toHaveURL("/records");
      await expect(dayTitle(page, "10월 23일")).toBeVisible();
    });

    // page가 문자열 하나가 아니면(같은 이름이 둘 이상이면 배열) 숫자로 보지 않는다.
    for (const [label, query] of [
      ["abc", "page=abc"],
      ["page=1&page=2", "page=1&page=2"],
    ]) {
      test(`주소의 page가 숫자가 아니면(${label}) 첫 페이지를 보여 준다`, async ({ page, msw }) => {
        serveRecords(msw, { "2026-10-21": DAILY_OF_TWO });
        await page.goto(`/records?date=2026-10-21&${query}`);

        await expectFirstOfTwo(page);
      });
    }
  });

  test.describe("경계값", () => {
    test("주소의 날짜가 오늘이면 오늘로 보내지 않고 그대로 연다", async ({ page, msw }) => {
      serveRecords(msw, {});
      await page.goto(`/records?date=${TODAY}`);

      await expect(dayTitle(page, "10월 23일")).toBeVisible();
      await expect(page).toHaveURL(`/records?date=${TODAY}`);
    });

    test("주소의 page가 int32 최댓값이면 그 페이지를 불러 기록이 없다고 보여 준다", async ({
      page,
      msw,
    }) => {
      serveRecords(msw, {
        [`2026-10-21#${MAX_PAGE}`]: {
          ...SESSION_LIST.EMPTY,
          page: { size: 5, number: MAX_PAGE, totalElements: 7, totalPages: 2 },
        },
      });
      await page.goto(`/records?date=2026-10-21&page=${MAX_PAGE}`);

      await expect(list(page).getByText("이 페이지에는 기록이 없어요")).toBeVisible();
    });

    test("주소의 page가 int32 최댓값보다 크면 첫 페이지를 보여 준다", async ({ page, msw }) => {
      serveRecords(msw, { "2026-10-21": DAILY_OF_TWO });
      await page.goto(`/records?date=2026-10-21&page=${MAX_PAGE + 1}`);

      await expectFirstOfTwo(page);
    });
  });
});
