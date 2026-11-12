// 기준: Figma S09 마이페이지(18:2848) · 기획 메모 S09(18:1173: 프로필 → 통계 타일 4개 → 스트릭 달력 · 스트릭 유지권, 날짜 클릭 → 그날의
//   S08(사용자 결정 2026-10-23으로 그날을 고른 연습 기록)) · Swagger 2.1 내 정보 · 3.2 통계 · 3.3 연습 달력(month=YYYY-MM)
// 달력 칸 계산(띠 · 주 경계 · 오늘 · 앞날)과 month 형식 규칙은 단위 테스트(calendar.test.ts)가, 여기서는 page의 month 해석 · 내 정보 없음
// 분기와 달을 넘기는 이동을 본다.
import type { Page } from "@playwright/test";
import type { MswFixture } from "next/experimental/testmode/playwright/msw";

import { PRACTICE_LOGS_FIGMA, PROBLEM } from "./mocks/data";
import {
  api,
  expect,
  fixServerToday,
  http,
  HttpResponse,
  hydrated,
  problemResponse,
  test,
} from "./test";

/** Figma S09 달력의 '오늘'(2026년 10월 13일) */
const TODAY = "2026-10-13";

const main = (page: Page) => page.getByRole("main");
const calendar = (page: Page) => main(page).getByRole("grid", { name: /연습 달력/ });
const monthTitle = (page: Page, name: string) => main(page).getByText(name, { exact: true });

/** 3.3: 요청한 달(month)의 연습 기록으로 답하는 서버 흉내(Figma와 같은 10월 기록 중 그 달 것, 다른 달은 0일) */
function monthLogs(msw: MswFixture) {
  msw.use(
    http.get(api("/practice-logs"), ({ request }) => {
      const month = new URL(request.url).searchParams.get("month");
      return HttpResponse.json({
        content: PRACTICE_LOGS_FIGMA.content.filter((log) =>
          log.practiceDate.startsWith(`${month}-`),
        ),
      });
    }),
  );
}

/** 로그인한 채 시작한다(권한 test는 다른 쿠키로 시작하므로 그 describe에는 걸지 않는다) */
async function signedIn({ signIn, msw }: { signIn: () => Promise<void>; msw: MswFixture }) {
  await signIn();
  monthLogs(msw);
}

test.beforeEach(async ({ page }) => {
  await fixServerToday(page, TODAY);
});

test.describe("S09 · 마이페이지", () => {
  test.describe("사용자 조작", () => {
    test.beforeEach(signedIn);

    test("[이전 달]을 누르면 그 달 주소로 가 그 달 연습 기록으로 달력을 다시 그린다", async ({
      page,
    }) => {
      await page.goto("/mypage");
      const previous = main(page).getByRole("link", { name: "이전 달" });
      await hydrated(previous);

      await previous.click();

      await expect(page).toHaveURL("/mypage?month=2026-09");
      await expect(monthTitle(page, "2026년 9월")).toBeVisible();
      await expect(main(page).getByText("이번 달 0일 연습")).toBeVisible();
    });
  });

  test.describe("입력 검증", () => {
    test.beforeEach(signedIn);

    // month가 없을 때도 같은 대체 갈래(parseMonth(...) ?? 오늘이 든 달)를 지난다.

    test("주소의 month 형식이 틀리면(2026-13) 오늘이 든 달 달력을 그린다", async ({ page }) => {
      await page.goto("/mypage?month=2026-13");

      await expect(monthTitle(page, "2026년 10월")).toBeVisible();
      await expect(calendar(page).getByRole("link", { name: "10월 13일 오늘" })).toBeVisible();
      await expect(calendar(page).getByRole("link", { name: "10월 1일 연습함" })).toBeVisible();
    });
  });

  test.describe("권한 · 로그인", () => {
    test("재발급이 실패해 로그인 정보가 없으면 로그인 화면으로 보낸다", async ({
      page,
      signIn,
      msw,
    }) => {
      // 재발급이 500이면 proxy는 쿠키를 지우지 않고 화면에 맡긴다. 액세스 토큰이 없어 page의 내 정보가 비어 있다.
      await signIn({ access: false });
      msw.use(http.post(api("/auth/token/refresh"), () => problemResponse(PROBLEM.INTERNAL_ERROR)));

      await page.goto("/mypage");

      await expect(page).toHaveURL("/login");
    });
  });
});
