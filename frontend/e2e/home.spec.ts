import type { Page } from "@playwright/test";

import { ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE } from "../src/lib/api/auth-cookies";
import { addDays } from "../src/lib/date";
import { E2E_TODAY_HEADER } from "../src/lib/today";

import { AUTH_TOKENS, GROWTH_REVIEW, HOME, ME, PROBLEM } from "./mocks/data";
import { api, expect, http, HttpResponse, problemResponse, test } from "./test";

// S02 홈(S02 · S02-B · S02-C · S02-D) · S02-1 홈 진입 인트로 · C01 공통 헤더 · 로그아웃
// 근거: Figma S02 · S02-B · S02-C · S02-D · C01 디자인과 기획 메모, 모션 메모(S02-1 · S02-D · C01),
//   웹 Swagger 3.1 홈(예시 4개) · 2.1 내 정보 · 1.5 로그아웃
// - S02-1 인트로는 기획 메모의 '하루 1회' 대신 홈에 들어올 때마다 보여 주기로 했다.
//   오늘 완료는 제외한다('N일째 달성!'은 면접을 마친 순간에 띄울 연출이고, 그 화면은 아직 없다).
//   첫 방문도 끊김처럼 0일 전환을 보여 준다.
// - [연습 시작] → S03, [마이페이지] → S09는 이동할 주소만 확인한다. 최근 성장 리뷰 → S08은 눌러 들어가 지난 날짜 리뷰까지 확인한다.

/** 서버가 홈을 그릴 '오늘'. 실제 날짜에 따라 결과가 바뀌지 않도록 모든 테스트에서 고정한다(월요일). */
const TODAY = "2026-10-19";
test.use({ extraHTTPHeaders: { [E2E_TODAY_HEADER]: TODAY } });

const intro = (page: Page) => page.getByRole("status");

/** 인트로에서 화면을 덮는 원 */
const wipe = (page: Page) => page.getByTestId("streak-wipe");

/** S02-1 인트로가 끝나 홈이 드러날 때까지 기다린다(약 3.3초). */
async function waitForIntro(page: Page) {
  await expect(intro(page)).toHaveCount(0, { timeout: 10_000 });
}

/**
 * 인트로가 시작된 때 · 큰 글씨가 바뀐 때 · 끝난 때를 페이지 안에서 실제 시간으로 기록한다.
 * Motion은 자기 프레임 루프의 시각으로 박자를 재므로, page.clock으로 시간을 넘겨서는 박자가 그대로 재현되지 않는다.
 * 그래서 시계는 건드리지 않고, 페이지가 그리는 순간들을 기록해 박자를 확인한다.
 */
async function recordIntroTimeline(page: Page) {
  await page.addInitScript(() => {
    const timeline: { start?: number; end?: number; texts: Record<string, number> } = { texts: {} };
    Object.assign(window, { __introTimeline: timeline });
    new MutationObserver(() => {
      const now = performance.now();
      const overlay = document.querySelector('[role="status"]');
      // 인트로가 뜨면 뒤 화면 스크롤을 막는다. 그 순간을 시작으로 본다.
      if (timeline.start === undefined && document.documentElement.style.overflow === "hidden") {
        timeline.start = now;
      }
      const text = overlay?.querySelector("p")?.textContent;
      if (text) timeline.texts[text] ??= now;
      if (timeline.start !== undefined && !overlay) timeline.end ??= now;
    }).observe(document, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["style"],
    });
  });
  return async () => {
    const t = await page.evaluate(
      () =>
        (
          window as unknown as {
            __introTimeline: { start: number; end: number; texts: Record<string, number> };
          }
        ).__introTimeline,
    );
    const since = (at: number | undefined) => (at === undefined ? NaN : (at - t.start) / 1000);
    return { textAt: (text: string) => since(t.texts[text]), endAt: since(t.end) };
  };
}

/**
 * 인트로 숫자가 정해진 박자대로 from → to로 바뀌는지 본다(초, 인트로 시작 기준).
 * 박자(1.2배속): 원이 덮음 0.75 → 글씨 등장 0.4 → 멈춤 0.375 → 숫자 굴림 0.46 → 멈춤 0.42
 * → 글씨 사라짐 0.28 → 원이 걷힘 0.63. 숫자는 약 2.0초에 다 바뀌고, 약 3.3초에 끝난다.
 * 애니메이션은 정해진 시간보다 일찍 끝날 수 없으므로 하한은 박자대로 좁게, 느린 환경을 생각해 상한만 넉넉히 둔다.
 * (멈춤 시간이 빠졌던 버그에서는 숫자가 1.65초에 바뀌어 여기서 걸린다.)
 */
async function expectCountUp(
  page: Page,
  timeline: Awaited<ReturnType<typeof recordIntroTimeline>>,
  from: number,
  to: number,
) {
  await expect(intro(page)).toContainText(`${from}일째!`);
  await waitForIntro(page);
  const { textAt, endAt } = await timeline();
  expect(textAt(`${to}일째!`)).toBeGreaterThan(1.9);
  expect(textAt(`${to}일째!`)).toBeLessThan(2.8);
  expect(endAt).toBeGreaterThan(3.2);
  expect(endAt).toBeLessThan(4.5);
}

/** 이번 주 7칸 */
const weekCells = (page: Page) =>
  page.getByRole("list", { name: "이번 주 연습" }).getByRole("listitem");

test.describe("S02-1 홈 진입 인트로", () => {
  test.beforeEach(async ({ signIn }) => {
    await signIn();
  });

  test("홈에 들어오면 인트로가 화면을 덮고, 숫자가 6 → 7로 바뀐 뒤 사라지며 홈이 드러난다", async ({
    page,
  }) => {
    const timeline = await recordIntroTimeline(page);
    await page.goto("/home");

    await expect(intro(page)).toHaveAttribute("aria-label", "7일째! 황금 불꽃! 오늘도 태워볼까요?");
    await expectCountUp(page, timeline, 6, 7);
    await expect(page.getByRole("heading", { level: 1, name: "7일째" })).toBeInViewport();
  });

  test("다시 들어와도(새로고침) 매번 보여 준다", async ({ page }) => {
    await page.goto("/home");
    await waitForIntro(page);

    await page.reload();

    await expect(intro(page)).toBeVisible();
    await waitForIntro(page);
  });

  test("오늘 완료는 홈에 들어와도 인트로 없이 바로 보여 준다", async ({ page, msw }) => {
    msw.use(http.get(api("/home"), () => HttpResponse.json(HOME.DONE_TODAY)));
    await page.goto("/home");

    await expect(page.getByText("오늘 연습 완료! 내일 또 만나요")).toBeVisible();
    await expect(intro(page)).toHaveCount(0);
  });

  test("첫 방문도 끊김처럼 회색 0일 전환을 띄우고, 아래 문구만 '첫 연습을 시작해볼까요?'로 다르다", async ({
    page,
    msw,
  }) => {
    msw.use(http.get(api("/home"), () => HttpResponse.json(HOME.FIRST_VISIT)));
    await page.goto("/home");

    await expect(intro(page)).toHaveAttribute("aria-label", "0일째! 첫 연습을 시작해볼까요?");
    await expectWipe(page, "#8B95A1");

    await waitForIntro(page);
    await expect(page.getByRole("heading", { level: 1, name: "0일째" })).toBeVisible();
  });

  test("동작 줄이기 설정이면 화면 덮기 없이 금방 사라진다", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/home");

    await expect(intro(page)).toHaveCount(0, { timeout: 1_500 });
    await expect(page.getByRole("heading", { level: 1, name: "7일째" })).toBeVisible();
  });
});

// 근거: Figma '스트릭 뱃지 색상 — 확정'(0 / 1–2 불씨 / 3–5 활활 불꽃 / 6–7 황금 불꽃 / 8–13 푸른 불꽃 / 14+ 전설의 불꽃).
// 인트로는 그 단계 색으로 화면을 덮는다(단색 단계는 아래쪽 색, 14일+는 오로라 그라데이션).
// 오늘 완료의 'N일째 달성!' · 레벨업은 면접을 마친 순간(StreakCelebration)에 띄우므로 홈에서는 나오지 않는다.
// 스트릭 수만 바꾸려고 Swagger 예시(S02 · S02-B)의 currentStreak를 덮어쓴다.
const TIER_BOUNDARIES = [
  { days: 1, name: "불씨", wipe: "#F0441F" },
  { days: 2, name: "불씨", wipe: "#F0441F" },
  { days: 3, name: "활활 불꽃", wipe: "#FF7A26" },
  { days: 5, name: "활활 불꽃", wipe: "#FF7A26" },
  { days: 6, name: "황금 불꽃", wipe: "#F5A000" },
  { days: 7, name: "황금 불꽃", wipe: "#F5A000" },
  { days: 8, name: "푸른 불꽃", wipe: "#2F6BFF" },
  { days: 13, name: "푸른 불꽃", wipe: "#2F6BFF" },
  { days: 14, name: "전설의 불꽃", wipe: "aurora" },
] as const;

/** #RRGGBB → 브라우저가 계산한 값과 같은 rgb(r, g, b) */
const rgb = (hex: string) =>
  `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(", ")})`;

async function expectWipe(page: Page, color: string) {
  if (color === "aurora") {
    await expect(wipe(page)).toHaveCSS("background-image", /^linear-gradient/);
  } else {
    await expect(wipe(page)).toHaveCSS("background-color", rgb(color));
  }
}

test.describe("S02-1 홈 진입 인트로 · 불꽃 단계 경계값", () => {
  test.beforeEach(async ({ signIn }) => {
    await signIn();
  });

  for (const { days, name, wipe: color } of TIER_BOUNDARIES) {
    test(`오늘 미완료 ${days}일: '${name}' 문구 · 색으로 덮고 ${days - 1} → ${days}로 바뀐다`, async ({
      page,
      msw,
    }) => {
      msw.use(
        http.get(api("/home"), () =>
          HttpResponse.json({
            ...HOME.NOT_DONE_TODAY,
            currentStreak: days,
            bestStreak: Math.max(days, HOME.NOT_DONE_TODAY.bestStreak),
          }),
        ),
      );
      const timeline = await recordIntroTimeline(page);
      await page.goto("/home");

      await expect(intro(page)).toHaveAttribute(
        "aria-label",
        `${days}일째! ${name}! 오늘도 태워볼까요?`,
      );
      await expectWipe(page, color);
      await expectCountUp(page, timeline, days - 1, days);
      await expect(page.getByRole("heading", { level: 1, name: `${days}일째` })).toBeVisible();
    });

    test(`오늘 완료 ${days}일: 홈에서는 '달성' 인트로 · 레벨업 없이 바로 홈`, async ({
      page,
      msw,
    }) => {
      msw.use(
        http.get(api("/home"), () =>
          HttpResponse.json({
            ...HOME.DONE_TODAY,
            currentStreak: days,
            bestStreak: Math.max(days, HOME.DONE_TODAY.bestStreak),
          }),
        ),
      );
      await page.goto("/home");

      await expect(page.getByRole("heading", { level: 1, name: `${days}일째` })).toBeVisible();
      await expect(intro(page)).toHaveCount(0);
      await expect(page.getByRole("dialog")).toHaveCount(0);
    });
  }

  test("끊김 0일: 회색으로 덮고 숫자 없이 '다시 1일째부터!'", async ({ page, msw }) => {
    msw.use(http.get(api("/home"), () => HttpResponse.json(HOME.BROKEN)));
    await page.goto("/home");

    await expect(intro(page)).toHaveAttribute(
      "aria-label",
      "다시 1일째부터! 지난 최고 기록 7일 · 다시 넘어봐요",
    );
    await expectWipe(page, "#8B95A1");
    await expect(intro(page)).not.toContainText("0일째");
  });
});

// 상태별 화면은 웹 Swagger 3.1 예시 그대로 본다. 예시의 날짜(연습일 · 오늘 나아진 점 · 최근 리뷰)는 2026-10-15가 '오늘'이라
// 서버의 '오늘'도 그날로 맞춘다(이번 주 7칸은 practiceDates로만 정해지므로).
const EXAMPLE_TODAY = "2026-10-15";

test.describe("S02 홈 · 상태별 화면 (3.1 homeState)", () => {
  test.use({ extraHTTPHeaders: { [E2E_TODAY_HEADER]: EXAMPLE_TODAY } });
  test.beforeEach(async ({ signIn }) => {
    await signIn();
  });

  test("S02 오늘 미완료: 스트릭 · 남은 시간 · 연습 시작 · 어제의 나에게서 · 최근 성장 리뷰", async ({
    page,
    msw,
  }) => {
    let authorization: string | null = null;
    msw.use(
      http.get(api("/home"), ({ request }) => {
        authorization = request.headers.get("authorization");
        return HttpResponse.json(HOME.NOT_DONE_TODAY);
      }),
    );
    // 오늘 밤 11시: 자정까지 1시간 남았다.
    await page.clock.setFixedTime(new Date(`${EXAMPLE_TODAY}T23:00:00+09:00`));
    await page.goto("/home");
    await waitForIntro(page);
    const main = page.getByRole("main");

    expect(authorization).toBe(`Bearer ${AUTH_TOKENS.accessToken}`);
    await expect(main.getByRole("heading", { level: 1 })).toHaveText("7일째");
    await expect(main.getByText("오늘도 불태워볼까요?")).toBeVisible();
    await expect(main.getByText("오늘 남은 시간 01:00:00")).toBeVisible();
    // 이번 주: 앞의 6일 연습 + 오늘은 아직
    await expect(weekCells(page).filter({ hasText: "연습함" })).toHaveCount(6);
    await expect(weekCells(page).filter({ hasText: "오늘 아직 안 함" })).toHaveCount(1);
    await expect(main.getByRole("link", { name: "오늘의 연습 시작하기" })).toHaveAttribute(
      "href",
      "/practice",
    );
    await expect(main.getByText("어제의 나에게서")).toBeVisible();
    await expect(main.getByText("“꼬리 질문엔 근거부터 짧게”")).toBeVisible();
    await expect(main.getByText("10.14 성장 리뷰의 ‘다음에 해볼 것’")).toBeVisible();
    await expect(
      main.getByRole("link", { name: "10.14 ○○전자 전달력 +8 성장 리뷰 보기" }),
    ).toHaveAttribute("href", "/reviews/2026-10-14");
    await expect(
      main.getByRole("link", { name: "10.13 △△소프트 논리성 +4 성장 리뷰 보기" }),
    ).toHaveAttribute("href", "/reviews/2026-10-13");
  });

  test("최근 성장 리뷰를 누르면 그날의 S08을 지난 날짜 문구('이날' · [홈으로])로 보여 준다", async ({
    page,
    msw,
  }) => {
    msw.use(
      http.get(api("/home"), () => HttpResponse.json(HOME.NOT_DONE_TODAY)),
      // 7.1: Swagger 'S08 오늘의 성장 리뷰' 예시를 10월 14일 리뷰로 쓴다.
      http.get(api("/growth-reviews/:practiceDate"), () =>
        HttpResponse.json({ ...GROWTH_REVIEW.S08, practiceDate: "2026-10-14" }),
      ),
    );
    // 인트로 연출은 이 테스트가 보는 것이 아니라 동작 줄이기로 짧게 넘긴다.
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/home");
    await waitForIntro(page);

    await page
      .getByRole("main")
      .getByRole("link", { name: "10.14 ○○전자 전달력 +8 성장 리뷰 보기" })
      .click();

    await expect(page).toHaveURL("/reviews/2026-10-14");
    await expect(page.getByText("10월 14일 · 면접 1회 · 18분")).toBeVisible();
    await expect(page.getByRole("region", { name: "이날 나아진 점" })).toBeVisible();
    await expect(page.getByText("오늘도 연습해 볼까요?")).toBeVisible();
    await expect(page.getByRole("link", { name: "홈으로" })).toBeVisible();
  });

  test("S02 남은 시간은 1초마다 줄어든다", async ({ page }) => {
    // Playwright 시계 문서 권장 순서: install → 페이지가 실제 시간으로 뜨고 인트로가 끝나게 둔다 → pauseAt으로 멈춘 뒤 runFor로 넘긴다.
    // 인트로 도중에 시간을 건너뛰면 Motion 애니메이션이 중간에 멈춰 인트로가 사라지지 않는다.
    await page.clock.install({ time: new Date(`${EXAMPLE_TODAY}T23:00:00+09:00`) });
    await page.goto("/home");
    // 인트로가 뜨기 전에는 status가 없어 waitForIntro가 바로 통과하므로, 뜬 것을 본 뒤 끝나기를 기다린다.
    await expect(intro(page)).toBeVisible();
    await waitForIntro(page);
    await page.clock.pauseAt(new Date(`${EXAMPLE_TODAY}T23:00:30+09:00`));
    const chip = page.getByRole("main").getByText(/^오늘 남은 시간 \d{2}:\d{2}:\d{2}$/);

    await expect(chip).toHaveText("오늘 남은 시간 00:59:30");
    await page.clock.runFor(1_000);
    await expect(chip).toHaveText("오늘 남은 시간 00:59:29");
  });

  test("S02-B 오늘 완료: 완료 문구 · 내일 목표 · [한 번 더 연습하기] · 오늘 나아진 점", async ({
    page,
    msw,
  }) => {
    msw.use(http.get(api("/home"), () => HttpResponse.json(HOME.DONE_TODAY)));
    await page.goto("/home");
    await waitForIntro(page);
    const main = page.getByRole("main");

    await expect(main.getByRole("heading", { level: 1 })).toHaveText("8일째");
    await expect(main.getByText("오늘 연습 완료! 내일 또 만나요")).toBeVisible();
    await expect(main.getByText("내일 자정 전에 하면 9일째")).toBeVisible();
    await expect(main.getByText(/오늘 남은 시간/)).toHaveCount(0);
    await expect(weekCells(page).filter({ hasText: "오늘 연습함" })).toHaveCount(1);
    await expect(weekCells(page).filter({ hasText: "연습함" })).toHaveCount(7);
    // CTA가 '시작'에서 '한 번 더'로 약해진다.
    await expect(main.getByRole("link", { name: "한 번 더 연습하기" })).toHaveAttribute(
      "href",
      "/practice",
    );
    await expect(main.getByRole("link", { name: /연습 시작하기/ })).toHaveCount(0);
    await expect(main.getByText("오늘 면접 1회 · 18분")).toBeVisible();
    await expect(main.getByRole("link", { name: /오늘 나아진 점/ })).toHaveAttribute(
      "href",
      `/reviews/${EXAMPLE_TODAY}`,
    );
    await expect(main.getByText("전달력 +8 · 논리성 +4")).toBeVisible();
    await expect(main.getByText("오늘의 성장 리뷰 보기 →")).toBeVisible();
  });

  test("S02-C 스트릭 끊김: 0일째 · 지난 최고 기록 · [다시 1일째 시작하기] · 지난번 마지막 연습", async ({
    page,
    msw,
  }) => {
    msw.use(http.get(api("/home"), () => HttpResponse.json(HOME.BROKEN)));
    await page.goto("/home");
    await waitForIntro(page);
    const main = page.getByRole("main");

    await expect(main.getByRole("heading", { level: 1 })).toHaveText("0일째");
    await expect(main.getByText("스트릭이 끊겼어요. 오늘 다시 1일째부터!")).toBeVisible();
    await expect(main.getByText("지난 최고 기록 7일")).toBeVisible();
    await expect(weekCells(page).filter({ hasText: "오늘 아직 안 함" })).toHaveCount(1);
    await expect(main.getByRole("link", { name: "다시 1일째 시작하기" })).toHaveAttribute(
      "href",
      "/practice",
    );
    await expect(main.getByRole("link", { name: /지난번 마지막 연습/ })).toHaveAttribute(
      "href",
      "/reviews/2026-10-12",
    );
    await expect(main.getByText("10.12 · 전달력 +8")).toBeVisible();
    await expect(main.getByText("그때 성장 리뷰 보기 →")).toBeVisible();
  });

  test("S02-D 첫 방문: 0일째 · '첫 연습' 문구 · 빈 7칸 · [첫 면접 시작하기] · 3단계 안내 · 빈 성장 리뷰", async ({
    page,
    msw,
  }) => {
    msw.use(http.get(api("/home"), () => HttpResponse.json(HOME.FIRST_VISIT)));
    await page.goto("/home");
    await waitForIntro(page);
    const main = page.getByRole("main");

    // 끊김(S02-C)처럼 0일째를 보여 주고, 아래 문구만 다르다(지난 최고 기록 칩도 없다).
    await expect(main.getByRole("heading", { level: 1 })).toHaveText("0일째");
    await expect(main.getByText("첫 연습을 시작해볼까요?")).toBeVisible();
    await expect(main.getByText("스트릭이 끊겼어요", { exact: false })).toHaveCount(0);
    await expect(main.getByText("지난 최고 기록", { exact: false })).toHaveCount(0);
    await expect(weekCells(page).filter({ hasText: "기록 없음" })).toHaveCount(6);
    await expect(weekCells(page).filter({ hasText: "오늘 아직 안 함" })).toHaveCount(1);
    await expect(main.getByRole("link", { name: "첫 면접 시작하기" })).toHaveAttribute(
      "href",
      "/practice",
    );
    for (const step of ["1. 지원서 입력", "2. 3D 면접관과 면접", "3. 성장 리뷰"]) {
      await expect(main.getByText(step)).toBeVisible();
    }
    await expect(main.getByText("어제의 나에게서")).toHaveCount(0);
    await expect(
      main.getByText("최근 성장 리뷰 · 첫 면접을 마치면 여기에 차곡차곡 쌓여요"),
    ).toBeVisible();
  });
});

test.describe("S02 홈 · 불러오지 못했을 때", () => {
  test.beforeEach(async ({ signIn }) => {
    await signIn();
  });

  test("홈(3.1)이 500이면 오류 화면을 보여 주고, [다시 시도]로 다시 불러온다", async ({
    page,
    msw,
  }) => {
    let calls = 0;
    msw.use(
      http.get(api("/home"), () => {
        calls += 1;
        return calls === 1
          ? problemResponse(PROBLEM.INTERNAL_ERROR)
          : HttpResponse.json(HOME.NOT_DONE_TODAY);
      }),
    );
    await page.goto("/home");

    await expect(page.getByRole("heading", { name: "화면을 불러오지 못했어요" })).toBeVisible();
    // 헤더는 그대로 남는다.
    await expect(page.getByRole("button", { name: "프로필 메뉴" })).toBeVisible();

    await page.getByRole("button", { name: "다시 시도" }).click();

    await waitForIntro(page);
    await expect(page.getByRole("heading", { level: 1, name: "7일째" })).toBeVisible();
  });

  test("내 정보(2.1)가 500이어도 홈 본문은 열리고, 헤더 메뉴만 비운다", async ({ page, msw }) => {
    let meCalled = false;
    msw.use(
      http.get(api("/users/me"), () => {
        meCalled = true;
        return problemResponse(PROBLEM.INTERNAL_ERROR);
      }),
    );
    await page.goto("/home");

    await waitForIntro(page);
    await expect(page.getByRole("heading", { level: 1, name: "7일째" })).toBeVisible();
    await expect.poll(() => meCalled).toBe(true);
    // 헤더 메뉴 자리의 스켈레톤이 사라진(2.1 실패를 그린) 뒤에 메뉴가 없는지 본다.
    await expect(page.getByTestId("app-nav-skeleton")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "프로필 메뉴" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "화면을 불러오지 못했어요" })).toHaveCount(0);
  });
});

// 이번 주 7칸(S02 Week): 오늘을 포함한 최근 7일. 앞 6칸은 지난 6일의 요일, 마지막 칸은 항상 '오늘'.
// (Figma의 '월 … 토 오늘'은 일요일 기준 그림이다. 월요일 시작 달력 주가 아니라 최근 7일로 정했다.)
// 근거: Figma S02 · S02-B · S02-C · S02-D Week(연습함 ✓ · 빠짐 ✕ · 빈 칸 · 오늘 링), 모션 메모 'S02 스트릭 파도'
// 오늘(TODAY)은 2026-10-19(월)이라 앞 6칸은 10-13(화) ~ 10-18(일)이다.

test.describe("S02 홈 · 이번 주 7칸 (요일 · 연습 여부)", () => {
  test.beforeEach(async ({ signIn }) => {
    await signIn();
  });

  test("오늘 미완료: 앞 6칸은 지난 6일의 요일 순서, 마지막 칸은 '오늘'이고 아직 안 한 상태다", async ({
    page,
    msw,
  }) => {
    // 스트릭 3일(10-16 · 10-17 · 10-18) + 10-14에 한 번 더 연습
    msw.use(
      http.get(api("/home"), () =>
        HttpResponse.json({
          ...HOME.NOT_DONE_TODAY,
          currentStreak: 3,
          practiceDates: ["2026-10-14", "2026-10-16", "2026-10-17", "2026-10-18"],
        }),
      ),
    );
    await page.goto("/home");
    await waitForIntro(page);

    await expect(weekCells(page)).toHaveText([
      "화 빠짐",
      "수 연습함",
      "목 빠짐",
      "금 연습함",
      "토 연습함",
      "일 연습함",
      "오늘 아직 안 함",
    ]);
  });

  test("오늘 완료: '오늘' 칸이 연습함으로 채워진다", async ({ page, msw }) => {
    msw.use(
      http.get(api("/home"), () =>
        HttpResponse.json({
          ...HOME.DONE_TODAY,
          currentStreak: 2,
          practiceDates: ["2026-10-18", TODAY],
        }),
      ),
    );
    await page.goto("/home");

    await expect(weekCells(page)).toHaveText([
      "화 빠짐",
      "수 빠짐",
      "목 빠짐",
      "금 빠짐",
      "토 빠짐",
      "일 연습함",
      "오늘 연습함",
    ]);
  });

  test("7일 넘게 이어 오면 앞 6칸이 모두 연습함이다", async ({ page, msw }) => {
    msw.use(
      http.get(api("/home"), () =>
        HttpResponse.json({
          ...HOME.NOT_DONE_TODAY,
          currentStreak: 10,
          bestStreak: 10,
          practiceDates: [1, 2, 3, 4, 5, 6].map((days) => addDays(TODAY, -days)).reverse(),
        }),
      ),
    );
    await page.goto("/home");
    await waitForIntro(page);

    await expect(weekCells(page)).toHaveText([
      "화 연습함",
      "수 연습함",
      "목 연습함",
      "금 연습함",
      "토 연습함",
      "일 연습함",
      "오늘 아직 안 함",
    ]);
  });

  test("끊김: 연습한 날만 연습함이고 나머지는 빠짐(✕)이다", async ({ page, msw }) => {
    msw.use(
      http.get(api("/home"), () =>
        HttpResponse.json({ ...HOME.BROKEN, practiceDates: ["2026-10-15"] }),
      ),
    );
    await page.goto("/home");
    await waitForIntro(page);

    await expect(weekCells(page)).toHaveText([
      "화 빠짐",
      "수 빠짐",
      "목 연습함",
      "금 빠짐",
      "토 빠짐",
      "일 빠짐",
      "오늘 아직 안 함",
    ]);
  });

  test("첫 방문: 앞 6칸은 기록 없는 빈 칸이고 '오늘'만 링으로 남는다", async ({ page, msw }) => {
    msw.use(http.get(api("/home"), () => HttpResponse.json(HOME.FIRST_VISIT)));
    await page.goto("/home");
    await waitForIntro(page);

    await expect(weekCells(page)).toHaveText([
      "화 기록 없음",
      "수 기록 없음",
      "목 기록 없음",
      "금 기록 없음",
      "토 기록 없음",
      "일 기록 없음",
      "오늘 아직 안 함",
    ]);
  });
});

// 오늘이 무슨 요일이냐에 따라 7칸의 요일 순서가 바뀐다. 서버가 쓰는 '오늘'을 E2E 헤더로 정해 월~일을 하나씩 확인한다.
// 2026-10-19(월) ~ 2026-10-25(일). 오늘이 일요일이면 Figma 그림과 같은 '월 화 수 목 금 토 오늘'이 된다.
const WEEK_BY_TODAY = [
  { today: "2026-10-19", weekday: "월", past: ["화", "수", "목", "금", "토", "일"] },
  { today: "2026-10-20", weekday: "화", past: ["수", "목", "금", "토", "일", "월"] },
  { today: "2026-10-21", weekday: "수", past: ["목", "금", "토", "일", "월", "화"] },
  { today: "2026-10-22", weekday: "목", past: ["금", "토", "일", "월", "화", "수"] },
  { today: "2026-10-23", weekday: "금", past: ["토", "일", "월", "화", "수", "목"] },
  { today: "2026-10-24", weekday: "토", past: ["일", "월", "화", "수", "목", "금"] },
  { today: "2026-10-25", weekday: "일", past: ["월", "화", "수", "목", "금", "토"] },
] as const;

test.describe("S02 홈 · 이번 주 7칸 · 오늘 요일별 순서", () => {
  test.beforeEach(async ({ signIn }) => {
    await signIn();
  });

  for (const { today, weekday, past } of WEEK_BY_TODAY) {
    test.describe(`오늘 ${today}`, () => {
      test.use({ extraHTTPHeaders: { [E2E_TODAY_HEADER]: today } });

      test(`오늘이 ${weekday}요일이면 '${past.join(" ")} 오늘' 순서다`, async ({ page, msw }) => {
        // 열흘째 이어 오는 중이라 지난 6일 모두 연습했다(practiceDates).
        msw.use(
          http.get(api("/home"), () =>
            HttpResponse.json({
              ...HOME.NOT_DONE_TODAY,
              currentStreak: 10,
              bestStreak: 10,
              practiceDates: [1, 2, 3, 4, 5, 6].map((days) => addDays(today, -days)).reverse(),
            }),
          ),
        );
        await page.goto("/home");
        await waitForIntro(page);

        await expect(weekCells(page)).toHaveText([
          ...past.map((day) => `${day} 연습함`),
          "오늘 아직 안 함",
        ]);
      });
    });
  }
});

test.describe("C01 공통 헤더 · 프로필 메뉴", () => {
  test.beforeEach(async ({ page, signIn }) => {
    await signIn();
    await page.goto("/home");
    await waitForIntro(page);
  });

  test("메뉴는 홈 · 연습 기록 · 스트릭 · 프로필이다", async ({ page }) => {
    const nav = page.getByRole("navigation", { name: "주요 메뉴" });

    await expect(nav.getByRole("link", { name: "홈" })).toHaveAttribute("href", "/home");
    await expect(nav.getByRole("link", { name: "연습 기록" })).toHaveAttribute("href", "/records");
    await expect(nav.getByText(`${ME.currentStreak}일 연속 연습 중`)).toBeVisible();
    await expect(nav.getByRole("button", { name: "프로필 메뉴" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "마이" })).toHaveCount(0);
  });

  test("프로필을 누르면 닉네임 · 이메일 · [마이페이지] · [로그아웃]이 열린다", async ({ page }) => {
    const button = page.getByRole("button", { name: "프로필 메뉴" });

    await button.click();

    const menu = page.getByRole("menu");
    await expect(button).toHaveAttribute("aria-expanded", "true");
    await expect(menu.getByText(ME.nickname)).toBeVisible();
    await expect(menu.getByText(ME.email)).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: "마이페이지" })).toHaveAttribute(
      "href",
      "/mypage",
    );
    await expect(menu.getByRole("menuitem", { name: "로그아웃" })).toBeVisible();
  });

  test("Esc로 닫힌다", async ({ page }) => {
    await page.getByRole("button", { name: "프로필 메뉴" }).click();
    await expect(page.getByRole("menu")).toBeVisible();

    await page.keyboard.press("Escape");

    await expect(page.getByRole("menu")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "프로필 메뉴" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  test("바깥을 누르면 닫히고, 프로필을 다시 눌러도 닫힌다", async ({ page }) => {
    const button = page.getByRole("button", { name: "프로필 메뉴" });

    await button.click();
    await expect(page.getByRole("menu")).toBeVisible();
    await page.getByRole("heading", { level: 1 }).click();
    await expect(page.getByRole("menu")).toHaveCount(0);

    await button.click();
    await expect(page.getByRole("menu")).toBeVisible();
    await button.click();
    await expect(page.getByRole("menu")).toHaveCount(0);
  });
});

test.describe("C01 로그아웃 (1.5)", () => {
  test("[로그아웃]은 확인 없이 리프레시 토큰을 폐기하고, 쿠키를 지운 뒤 S00 랜딩으로 간다", async ({
    page,
    context,
    signIn,
    msw,
  }) => {
    let body: unknown;
    let authorization: string | null = null;
    msw.use(
      http.post(api("/auth/logout"), async ({ request }) => {
        body = await request.json();
        authorization = request.headers.get("Authorization");
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await signIn();
    await page.goto("/home");
    await waitForIntro(page);

    await page.getByRole("button", { name: "프로필 메뉴" }).click();
    await page.getByRole("menuitem", { name: "로그아웃" }).click();

    await expect(page).toHaveURL("/");
    expect(body).toEqual({ refreshToken: AUTH_TOKENS.refreshToken });
    // 1.5는 전역 bearer 보안이라 액세스 토큰을 붙인다(웹 Swagger).
    expect(authorization).toBe(`Bearer ${AUTH_TOKENS.accessToken}`);
    const names = (await context.cookies()).map((cookie) => cookie.name);
    expect(names).not.toContain(ACCESS_TOKEN_COOKIE);
    expect(names).not.toContain(REFRESH_TOKEN_COOKIE);
    // 랜딩 헤더가 로그인 전 메뉴로 돌아온다.
    await expect(
      page.getByRole("banner").getByRole("link", { name: "시작하기", exact: true }),
    ).toBeVisible();

    // 로그아웃 뒤에는 홈에 들어갈 수 없다.
    await page.goto("/home");
    await expect(page).toHaveURL("/login");
  });

  test("서버에 닿지 못해도 쿠키는 지우고 S00 랜딩으로 간다", async ({
    page,
    context,
    signIn,
    msw,
  }) => {
    msw.use(http.post(api("/auth/logout"), () => HttpResponse.error()));
    await signIn();
    await page.goto("/home");
    await waitForIntro(page);

    await page.getByRole("button", { name: "프로필 메뉴" }).click();
    await page.getByRole("menuitem", { name: "로그아웃" }).click();

    await expect(page).toHaveURL("/");
    const names = (await context.cookies()).map((cookie) => cookie.name);
    expect(names).not.toContain(ACCESS_TOKEN_COOKIE);
    expect(names).not.toContain(REFRESH_TOKEN_COOKIE);
  });
});
