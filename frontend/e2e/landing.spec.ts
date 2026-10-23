import type { Page } from "@playwright/test";

import { ACCESS_TOKEN_COOKIE } from "../src/lib/api/auth-cookies";

import { AUTH_TOKENS, ME, PROBLEM } from "./mocks/data";
import { api, expect, http, HttpResponse, problemResponse, test } from "./test";

// S00 랜딩
// 근거: Figma S00 디자인 프로토타입 연결, S00 기획 메모, 웹 Swagger 2.1(C01 헤더)
test.use({ colorScheme: "light" });

/** 히어로(첫 화면)의 [무료로 시작하기] */
const heroCta = (page: Page) =>
  page.getByRole("region", { name: /면접 준비/ }).getByRole("link", { name: "무료로 시작하기" });

test.describe("S00 랜딩 · 로그인 전", () => {
  test("첫 화면(fold)에 헤드라인 · 서브 카피 · CTA가 보인다", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByRole("heading", { level: 1 })).toHaveText(/면접 준비,\s*이제 습관처럼/);
    await expect(page.getByText("말하는 동안 반응하는 면접관과 매일 10분씩")).toBeInViewport();
    await expect(heroCta(page)).toBeInViewport();
  });

  test("[로그인] → S01 로그인", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("banner").getByRole("link", { name: "로그인" }).click();

    await expect(page).toHaveURL("/login");
    await expect(page.getByRole("heading", { name: "로그인" })).toBeVisible();
  });

  test("헤더 [시작하기] → S01-1 회원가입", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("banner").getByRole("link", { name: "시작하기", exact: true }).click();

    await expect(page).toHaveURL("/signup");
    await expect(page.getByRole("heading", { name: "회원가입" })).toBeVisible();
  });

  test("히어로 [무료로 시작하기] → S01-1 회원가입", async ({ page }) => {
    await page.goto("/");
    await heroCta(page).click();

    await expect(page).toHaveURL("/signup");
  });

  test("마지막 CTA [무료로 시작하기] → S01-1 회원가입", async ({ page }) => {
    await page.goto("/");
    const finalCta = page
      .getByRole("region", { name: /오늘부터 1일째/ })
      .getByRole("link", { name: "무료로 시작하기" });
    await finalCta.scrollIntoViewIfNeeded();
    await finalCta.click();

    await expect(page).toHaveURL("/signup");
  });

  test("[어떻게 동작하나요?] → '이렇게 진행돼요' 섹션으로 스크롤", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "어떻게 동작하나요?" }).click();

    await expect(page.getByRole("heading", { name: "하루 10분, 네 단계면 끝" })).toBeInViewport();
    await expect(page.getByText("피드백 · 성장 리뷰")).toBeVisible();
  });

  test("스크롤하면 상단 nav가 고정되고 [시작하기]가 계속 보인다", async ({ page }) => {
    await page.goto("/");
    const header = page.getByRole("banner");
    await expect(header).toHaveAttribute("data-overlay", "true");

    await page.getByRole("heading", { name: "하루 10분, 네 단계면 끝" }).scrollIntoViewIfNeeded();

    await expect(header).toHaveAttribute("data-overlay", "false");
    await expect(header).toBeInViewport();
    await expect(header.getByRole("link", { name: "시작하기", exact: true })).toBeInViewport();
  });

  test("테마 토글: 라이트 ↔ 다크, 새로고침해도 유지된다", async ({ page }) => {
    await page.goto("/");
    const html = page.locator("html");
    const toggle = page.getByRole("button", { name: "라이트·다크 모드 전환" });
    await expect(html).toHaveAttribute("data-theme", "light");

    await toggle.click();
    await expect(html).toHaveAttribute("data-theme", "dark");

    await page.reload();
    await expect(html).toHaveAttribute("data-theme", "dark");

    await toggle.click();
    await expect(html).toHaveAttribute("data-theme", "light");
  });
});

test.describe("S00 랜딩 · 히어로 면접관 배경", () => {
  // 근거: 사용자 결정(2026-10-22: 하늘 · 실내(창문만 투명) · 면접관 3장을 겹치고, 멀수록 덜 움직이는 깊이를 준다)
  //   · Figma 모션 메모 S00(마우스 패럴랙스 ±12px, 배경 scale 1 → 1.04 → 1 · 8초, 번개 순간 brightness 1 → 1.4 → 1)
  // motion은 숨쉬기 · 번개를 브라우저 애니메이션(WAAPI)으로 돌리고 이 시간은 Playwright 시계로 넘길 수 없다.
  // 그래서 애니메이션을 멈추고 재생 위치를 직접 옮겨 보거나, 걸린 애니메이션의 키프레임을 본다(실제 시간을 기다리지 않는다).
  const backdrop = (page: Page) => page.getByTestId("hero-backdrop");
  const layers = (page: Page) => page.getByTestId("hero-layer");
  /** 층마다의 이동(px) */
  const shifts = (page: Page, axis: "m41" | "m42") =>
    layers(page).evaluateAll(
      (elements, key) =>
        elements.map((element) => new DOMMatrix(getComputedStyle(element).transform)[key]),
      axis,
    );
  /** 배경 상자에 걸린 애니메이션의 키프레임 값(속성 이름별) */
  const backdropAnimations = (page: Page) =>
    backdrop(page).evaluate((element) =>
      element.getAnimations().map((animation) => {
        const effect = animation.effect as KeyframeEffect;
        return {
          keyframes: effect.getKeyframes().map(({ transform, filter, scale }) => ({
            transform,
            filter,
            scale,
          })),
          iterations: effect.getTiming().iterations,
        };
      }),
    );

  test("하늘 → 실내 → 면접관 순서(뒤에서 앞)로 3장을 겹치고, 모두 불러온다", async ({ page }) => {
    await page.goto("/");

    const images = layers(page).locator("img");
    await expect(images).toHaveCount(3);
    const sources = await images.evaluateAll((elements) =>
      elements.map((image) => /hero-(\w+)/.exec((image as HTMLImageElement).src)?.[1]),
    );
    expect(sources).toEqual(["sky", "interior", "devil"]);
    for (const image of await images.all()) {
      await expect(image).toHaveJSProperty("complete", true);
      expect(
        await image.evaluate((element: HTMLImageElement) => element.naturalWidth),
      ).toBeGreaterThan(0);
    }
  });

  test("배경은 천천히 커졌다 작아진다(scale 1 → 1.04 → 1, 한 번에 4초씩 왕복)", async ({
    page,
  }) => {
    await page.goto("/");
    // 끝없이 반복하는 확대 애니메이션을 찾아 멈추고, 재생 위치를 옮겨 가며 크기를 본다.
    const scaleAt = (time: number) =>
      backdrop(page).evaluate((element, at) => {
        const breathing = element
          .getAnimations()
          .find((animation) => animation.effect?.getTiming().iterations === Infinity)!;
        breathing.pause();
        breathing.currentTime = at;
        return new DOMMatrix(getComputedStyle(element).transform).a;
      }, time);
    await expect
      .poll(() => backdropAnimations(page).then((list) => list.length))
      .toBeGreaterThan(0);

    expect(await scaleAt(0)).toBeCloseTo(1, 3);
    expect(await scaleAt(4000)).toBeCloseTo(1.04, 3);
    expect(await scaleAt(8000)).toBeCloseTo(1, 3);
  });

  test("번개가 치면(첫 번개 2초 뒤) 세 층을 감싼 배경 전체가 brightness 1 → 1.4 → 1로 밝아진다", async ({
    page,
  }) => {
    // 첫 번개를 일으키는 2초 타이머(setTimeout)는 시계로 넘긴다.
    await page.clock.install();
    await page.goto("/");
    await expect(layers(page)).toHaveCount(3);

    await page.clock.runFor(2000);

    await expect
      .poll(async () =>
        (await backdropAnimations(page)).some((animation) =>
          animation.keyframes.some(({ filter }) => filter === "brightness(1.4)"),
        ),
      )
      .toBe(true);
    // 밝기가 걸린 상자 안에 세 층이 모두 있다.
    await expect(backdrop(page).getByTestId("hero-layer")).toHaveCount(3);
  });

  test("마우스를 움직이면 멀리 있는 층일수록 덜 움직인다(하늘 0.3 · 실내 0.6 · 면접관 1배)", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(layers(page)).toHaveCount(3);

    // 층 이동은 스프링으로 따라가지만, 세 층이 같은 값에 배율만 곱하므로 비율은 어느 순간에나 같다.
    // 하이드레이션 전에 움직이면 이벤트를 놓치므로, 비율이 나올 때까지 마우스를 다시 움직인다.
    await expect(async () => {
      await page.mouse.move(0, 0);
      await page.mouse.move(1270, 700);
      const [sky, interior, devil] = await shifts(page, "m41");
      expect(devil).toBeGreaterThan(0);
      expect(sky / devil).toBeCloseTo(0.3, 2);
      expect(interior / devil).toBeCloseTo(0.6, 2);
    }).toPass();
  });

  test("스크롤하면 멀리 있는 층일수록 많이 내려가 천천히 지나가 보인다(하늘 120 : 실내 60 : 면접관 0)", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(layers(page)).toHaveCount(3);

    await page.mouse.wheel(0, 400);

    // 마우스를 움직이지 않았으므로 세로 이동은 스크롤 깊이뿐이다. 같은 진행도에 거리만 곱하므로 비율은 늘 같다.
    await expect
      .poll(async () => {
        const [sky, interior, devil] = await shifts(page, "m42");
        return sky > 0 && Math.abs(sky - interior * 2) < 0.5 && devil === 0;
      })
      .toBe(true);
  });

  test("동작 줄이기를 켜면 숨쉬기 · 번개 · 마우스 깊이를 하지 않는다", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.clock.install();
    await page.goto("/");
    await expect(layers(page)).toHaveCount(3);

    await page.mouse.move(0, 0);
    await page.mouse.move(1270, 700);
    await page.clock.runFor(2000);

    expect(await backdropAnimations(page)).toEqual([]);
    expect(await shifts(page, "m41")).toEqual([0, 0, 0]);
  });
});

test.describe("S00 랜딩 · OS 다크 모드", () => {
  test.use({ colorScheme: "dark" });

  test("고른 테마가 없으면 OS 설정(다크)을 따른다", async ({ page }) => {
    await page.goto("/");

    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  });
});

test.describe("S00 랜딩 · 로그인 후 (C01 헤더)", () => {
  test("헤더가 앱 메뉴(홈 · 연습 기록 · 스트릭 · 프로필)로 바뀐다", async ({
    page,
    signIn,
    msw,
  }) => {
    let authorization: string | null = null;
    msw.use(
      http.get(api("/users/me"), ({ request }) => {
        authorization = request.headers.get("authorization");
        return HttpResponse.json(ME);
      }),
    );
    await signIn();

    await page.goto("/");
    const header = page.getByRole("banner");

    await expect(header.getByRole("link", { name: "홈" })).toBeVisible();
    await expect(header.getByRole("link", { name: "연습 기록" })).toBeVisible();
    await expect(header.getByText("7일")).toBeVisible();
    await expect(header.getByRole("button", { name: "프로필 메뉴" })).toBeVisible();
    await expect(header.getByRole("link", { name: "로그인" })).toHaveCount(0);
    await expect(header.getByRole("link", { name: "시작하기", exact: true })).toHaveCount(0);
    // 서버가 쿠키의 액세스 토큰을 Bearer로 붙여 내 정보(2.1)를 부른다.
    expect(authorization).toBe(`Bearer ${AUTH_TOKENS.accessToken}`);
  });

  // 401 UNAUTHORIZED(웹 Swagger 공통 401): 남은 토큰 쿠키를 지우고 랜딩에 머문다.
  test("내 정보가 401(UNAUTHORIZED)이면 쿠키를 지우고 랜딩에서 로그인 전 메뉴를 보여 준다", async ({
    page,
    context,
    signIn,
    msw,
  }) => {
    msw.use(http.get(api("/users/me"), () => problemResponse(PROBLEM.UNAUTHORIZED)));
    await signIn();

    await page.goto("/");

    // 주소는 처음부터 "/"라 toHaveURL로는 기다리지 못한다. 쿠키를 지우는 Route Handler를 거쳐 돌아올 때까지 기다린다.
    await expect
      .poll(async () => (await context.cookies()).map((cookie) => cookie.name))
      .not.toContain(ACCESS_TOKEN_COOKIE);
    await expect(page).toHaveURL("/");
    const header = page.getByRole("banner");
    await expect(header.getByRole("link", { name: "시작하기", exact: true })).toBeVisible();
    await expect(header.getByRole("button", { name: "프로필 메뉴" })).toHaveCount(0);
  });

  test("내 정보를 못 불러와도(500) 랜딩은 로그인 전 메뉴로 열린다", async ({
    page,
    signIn,
    msw,
  }) => {
    msw.use(http.get(api("/users/me"), () => problemResponse(PROBLEM.INTERNAL_ERROR)));
    await signIn();

    await page.goto("/");

    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(
      page.getByRole("banner").getByRole("link", { name: "시작하기", exact: true }),
    ).toBeVisible();
  });
});
