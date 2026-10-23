import type { BrowserContext } from "@playwright/test";

import { ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE } from "../src/lib/api/auth-cookies";

import { AUTH_TOKENS, HOME, PROBLEM, REFRESHED_TOKENS } from "./mocks/data";
import { api, expect, http, HttpResponse, problemResponse, test } from "./test";

// S01 로그인 · 로그인 상태 유지(proxy)
// 근거: Figma S01 와이어프레임 · 디자인, S01 기획 메모
//   (S00에서 진입 / 자동 로그인 유지 → 스트릭이 끊기지 않게 / 로그인 성공 → S02 홈),
//   웹 Swagger 1.3 로그인 · 1.4 토큰 재발급

const EMAIL = "a@ssafy.com";
const PASSWORD = "abcd1234";

async function authCookie(context: BrowserContext, name: string) {
  return (await context.cookies()).find((cookie) => cookie.name === name);
}

test.describe("S01 로그인 · 입력 확인", () => {
  test("이메일 · 비밀번호를 비우고 누르면 칸별 안내가 나오고 API를 부르지 않는다", async ({
    page,
    msw,
  }) => {
    let called = false;
    msw.use(
      http.post(api("/auth/login"), () => {
        called = true;
        return HttpResponse.json(AUTH_TOKENS);
      }),
    );
    await page.goto("/login");

    await page.getByRole("button", { name: "로그인" }).click();

    await expect(page.getByText("이메일을 입력해 주세요.")).toBeVisible();
    await expect(page.getByText("비밀번호를 입력해 주세요.")).toBeVisible();
    await expect(page.getByLabel("이메일")).toHaveAttribute("aria-invalid", "true");
    await expect(page).toHaveURL("/login");
    expect(called).toBe(false);
  });

  test("이메일 형식이 틀리면 칸을 벗어날 때 안내하고, 고치면 사라진다", async ({ page }) => {
    await page.goto("/login");
    const email = page.getByLabel("이메일");

    await email.fill("a@ssafy");
    await email.blur();
    await expect(page.getByText("이메일 형식을 확인해 주세요.")).toBeVisible();

    await email.fill(EMAIL);
    await expect(page.getByText("이메일 형식을 확인해 주세요.")).toHaveCount(0);
  });

  test("눈 아이콘으로 비밀번호를 보이고 숨긴다", async ({ page }) => {
    await page.goto("/login");
    const password = page.getByLabel("비밀번호", { exact: true });
    await password.fill(PASSWORD);
    await expect(password).toHaveAttribute("type", "password");

    await page.getByRole("button", { name: "비밀번호 보기" }).click();
    await expect(password).toHaveAttribute("type", "text");
    await expect(password).toHaveValue(PASSWORD);

    await page.getByRole("button", { name: "비밀번호 숨기기" }).click();
    await expect(password).toHaveAttribute("type", "password");
  });
});

test.describe("S01 로그인 · 제출", () => {
  test("성공하면 토큰을 httpOnly 쿠키에 저장하고 S02 홈으로 간다", async ({
    page,
    context,
    msw,
  }) => {
    let body: unknown;
    msw.use(
      http.post(api("/auth/login"), async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(AUTH_TOKENS);
      }),
    );
    await page.goto("/login");

    await page.getByLabel("이메일").fill(EMAIL);
    await page.getByLabel("비밀번호", { exact: true }).fill(PASSWORD);
    await page.getByRole("button", { name: "로그인" }).click();

    await expect(page).toHaveURL("/home");
    expect(body).toEqual({ email: EMAIL, password: PASSWORD });
    const access = await authCookie(context, ACCESS_TOKEN_COOKIE);
    const refresh = await authCookie(context, REFRESH_TOKEN_COOKIE);
    expect(access).toMatchObject({ value: AUTH_TOKENS.accessToken, httpOnly: true });
    expect(refresh).toMatchObject({ value: AUTH_TOKENS.refreshToken, httpOnly: true });
    // 토큰은 화면 스크립트에서 읽을 수 없다.
    expect(await page.evaluate(() => document.cookie)).not.toContain(AUTH_TOKENS.accessToken);
  });

  test("Enter 키로도 제출된다", async ({ page }) => {
    await page.goto("/login");

    await page.getByLabel("이메일").fill(EMAIL);
    await page.getByLabel("비밀번호", { exact: true }).fill(PASSWORD);
    await page.getByLabel("비밀번호", { exact: true }).press("Enter");

    await expect(page).toHaveURL("/home");
  });

  test("응답을 기다리는 동안 버튼이 '로그인하는 중…'으로 바뀌고 다시 누를 수 없다", async ({
    page,
    msw,
  }) => {
    let calls = 0;
    let respond!: () => void;
    const responded = new Promise<void>((resolve) => (respond = resolve));
    msw.use(
      http.post(api("/auth/login"), async () => {
        calls += 1;
        await responded;
        return HttpResponse.json(AUTH_TOKENS);
      }),
    );
    await page.goto("/login");

    await page.getByLabel("이메일").fill(EMAIL);
    await page.getByLabel("비밀번호", { exact: true }).fill(PASSWORD);
    await page.getByRole("button", { name: "로그인" }).click();

    const pending = page.getByRole("button", { name: "로그인하는 중…" });
    await expect(pending).toBeDisabled();
    await expect(pending).toHaveAttribute("aria-busy", "true");

    respond();
    await expect(page).toHaveURL("/home");
    expect(calls).toBe(1);
  });

  test("이메일 · 비밀번호가 틀리면(LOGIN_FAILED) 안내하고 로그인 화면에 머문다", async ({
    page,
    context,
    msw,
  }) => {
    msw.use(http.post(api("/auth/login"), () => problemResponse(PROBLEM.LOGIN_FAILED)));
    await page.goto("/login");

    await page.getByLabel("이메일").fill(EMAIL);
    await page.getByLabel("비밀번호", { exact: true }).fill("wrong1234");
    await page.getByRole("button", { name: "로그인" }).click();

    await expect(page.getByRole("main").getByRole("alert")).toHaveText(PROBLEM.LOGIN_FAILED.detail);
    await expect(page).toHaveURL("/login");
    await expect(page.getByRole("button", { name: "로그인" })).toBeEnabled();
    expect(await authCookie(context, ACCESS_TOKEN_COOKIE)).toBeUndefined();
  });

  test("틀린 뒤 다시 입력해 성공하면 S02 홈으로 간다", async ({ page, msw }) => {
    msw.use(
      http.post(api("/auth/login"), async ({ request }) => {
        const { password } = (await request.json()) as { password: string };
        return password === PASSWORD
          ? HttpResponse.json(AUTH_TOKENS)
          : problemResponse(PROBLEM.LOGIN_FAILED);
      }),
    );
    await page.goto("/login");
    const password = page.getByLabel("비밀번호", { exact: true });

    await page.getByLabel("이메일").fill(EMAIL);
    await password.fill("wrong1234");
    await page.getByRole("button", { name: "로그인" }).click();
    await expect(page.getByRole("main").getByRole("alert")).toHaveText(PROBLEM.LOGIN_FAILED.detail);

    await password.fill(PASSWORD);
    await page.getByRole("button", { name: "로그인" }).click();

    await expect(page).toHaveURL("/home");
  });

  test("서버 오류(500)면 잠시 후 다시 시도하라고 안내한다", async ({ page, msw }) => {
    msw.use(http.post(api("/auth/login"), () => problemResponse(PROBLEM.INTERNAL_ERROR)));
    await page.goto("/login");

    await page.getByLabel("이메일").fill(EMAIL);
    await page.getByLabel("비밀번호", { exact: true }).fill(PASSWORD);
    await page.getByRole("button", { name: "로그인" }).click();

    await expect(page.getByRole("main").getByRole("alert")).toHaveText(
      "잠시 후 다시 시도해 주세요.",
    );
    await expect(page).toHaveURL("/login");
  });

  test("서버에 닿지 못해도(네트워크 오류) 잠시 후 다시 시도하라고 안내한다", async ({
    page,
    msw,
  }) => {
    msw.use(http.post(api("/auth/login"), () => HttpResponse.error()));
    await page.goto("/login");

    await page.getByLabel("이메일").fill(EMAIL);
    await page.getByLabel("비밀번호", { exact: true }).fill(PASSWORD);
    await page.getByRole("button", { name: "로그인" }).click();

    await expect(page.getByRole("main").getByRole("alert")).toHaveText(
      "잠시 후 다시 시도해 주세요.",
    );
    await expect(page).toHaveURL("/login");
  });
});

test.describe("S01 로그인 · 이동", () => {
  test("[계정이 없나요? 회원가입] → S01-1 회원가입", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("link", { name: "계정이 없나요? 회원가입" }).click();

    await expect(page).toHaveURL("/signup");
    await expect(page.getByRole("heading", { name: "회원가입" })).toBeVisible();
  });

  test("로고 → S00 랜딩", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("link", { name: "한끗" }).click();

    await expect(page).toHaveURL("/");
  });
});

test.describe("접근 제어 · 로그인 상태 유지", () => {
  test("로그인하지 않고 홈에 들어가면 로그인 화면으로 보낸다", async ({ page }) => {
    await page.goto("/home");

    await expect(page).toHaveURL("/login");
  });

  test("로그인한 채로 로그인 · 회원가입 화면에 들어가면 홈으로 보낸다", async ({
    page,
    signIn,
  }) => {
    await signIn();

    await page.goto("/login");
    await expect(page).toHaveURL("/home");

    await page.goto("/signup");
    await expect(page).toHaveURL("/home");
  });

  test("액세스 토큰이 만료돼도 리프레시 토큰으로 재발급해 로그인을 유지한다", async ({
    page,
    context,
    signIn,
    msw,
  }) => {
    const refreshToken = "e2e-refresh-valid";
    let refreshBody: unknown;
    let homeAuthorization: string | null = null;
    msw.use(
      http.post(api("/auth/token/refresh"), async ({ request }) => {
        refreshBody = await request.json();
        return HttpResponse.json(REFRESHED_TOKENS);
      }),
      http.get(api("/home"), ({ request }) => {
        homeAuthorization = request.headers.get("authorization");
        return HttpResponse.json(HOME.NOT_DONE_TODAY);
      }),
    );
    await signIn({ access: false, refreshToken });

    await page.goto("/home");

    await expect(page).toHaveURL("/home");
    expect(refreshBody).toEqual({ refreshToken });
    // 재발급한 그 요청에서 바로 새 액세스 토큰으로 홈(3.1)을 부른다.
    await expect.poll(() => homeAuthorization).toBe(`Bearer ${REFRESHED_TOKENS.accessToken}`);
    const access = await authCookie(context, ACCESS_TOKEN_COOKIE);
    const refresh = await authCookie(context, REFRESH_TOKEN_COOKIE);
    expect(access).toMatchObject({ value: REFRESHED_TOKENS.accessToken, httpOnly: true });
    expect(refresh).toMatchObject({ value: REFRESHED_TOKENS.refreshToken, httpOnly: true });
  });

  test("리프레시 토큰도 만료됐으면(REFRESH_TOKEN_INVALID) 쿠키를 지우고 로그인 화면으로 보낸다", async ({
    page,
    context,
    signIn,
    msw,
  }) => {
    msw.use(
      http.post(api("/auth/token/refresh"), () => problemResponse(PROBLEM.REFRESH_TOKEN_INVALID)),
    );
    await signIn({ access: false, refreshToken: "e2e-refresh-expired" });

    await page.goto("/home");

    await expect(page).toHaveURL("/login");
    expect(await authCookie(context, REFRESH_TOKEN_COOKIE)).toBeUndefined();
    expect(await authCookie(context, ACCESS_TOKEN_COOKIE)).toBeUndefined();
  });
});

// 웹 Swagger 공통 오류 401 TOKEN_EXPIRED: 토큰을 재발급한 뒤 다시 요청한다.
// 목 서버는 토큰을 검사하지 않아 TOKEN_EXPIRED를 주지 않으므로, ProblemDetail 형식으로 테스트에서 만든다.
// 액세스 토큰은 JWT(sub · nickname · iat · exp, 명세 1장)라 exp로 만료를 알 수 있다.
const jwtWithExp = (exp: number) =>
  `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.${Buffer.from(
    JSON.stringify({ sub: "1", nickname: "면접왕", iat: exp - 3600, exp }),
  ).toString("base64url")}.e2e-signature`;

test.describe("접근 제어 · 토큰 만료 (TOKEN_EXPIRED)", () => {
  test("액세스 토큰 쿠키가 남아 있어도 토큰이 만료됐으면(exp) 들어가기 전에 재발급한다", async ({
    page,
    context,
    signIn,
    msw,
  }) => {
    const refreshToken = "e2e-refresh-exp";
    let refreshBody: unknown;
    msw.use(
      http.post(api("/auth/token/refresh"), async ({ request }) => {
        refreshBody = await request.json();
        return HttpResponse.json(REFRESHED_TOKENS);
      }),
    );
    await signIn({ accessToken: jwtWithExp(Math.floor(Date.now() / 1000) - 60), refreshToken });

    await page.goto("/home");

    await expect(page).toHaveURL("/home");
    expect(refreshBody).toEqual({ refreshToken });
    expect(await authCookie(context, ACCESS_TOKEN_COOKIE)).toMatchObject({
      value: REFRESHED_TOKENS.accessToken,
    });
  });

  test("화면을 그리는 중 API가 TOKEN_EXPIRED면 재발급하고 같은 화면을 다시 그린다", async ({
    page,
    context,
    signIn,
    msw,
  }) => {
    const refreshToken = "e2e-refresh-midrender";
    const homeAuthorizations: (string | null)[] = [];
    // 실제 BE처럼: 예전 토큰은 계속 TOKEN_EXPIRED, 재발급한 토큰이면 성공
    msw.use(
      http.get(api("/home"), ({ request }) => {
        const authorization = request.headers.get("authorization");
        homeAuthorizations.push(authorization);
        return authorization === `Bearer ${REFRESHED_TOKENS.accessToken}`
          ? HttpResponse.json(HOME.NOT_DONE_TODAY)
          : problemResponse(PROBLEM.TOKEN_EXPIRED);
      }),
      http.post(api("/auth/token/refresh"), () => HttpResponse.json(REFRESHED_TOKENS)),
    );
    await signIn({ refreshToken });

    await page.goto("/home");

    await expect(page).toHaveURL("/home");
    await expect(page.getByRole("heading", { level: 1, name: "7일째" })).toBeAttached();
    // 예전 토큰으로 먼저 불렀다가, 재발급한 토큰으로 다시 불렀다.
    expect(homeAuthorizations[0]).toBe(`Bearer ${AUTH_TOKENS.accessToken}`);
    expect(homeAuthorizations.at(-1)).toBe(`Bearer ${REFRESHED_TOKENS.accessToken}`);
    expect(await authCookie(context, ACCESS_TOKEN_COOKIE)).toMatchObject({
      value: REFRESHED_TOKENS.accessToken,
    });
  });

  test("재발급도 안 되면(REFRESH_TOKEN_INVALID) 쿠키를 지우고 로그인 화면으로 보낸다", async ({
    page,
    context,
    signIn,
    msw,
  }) => {
    msw.use(
      http.get(api("/home"), () => problemResponse(PROBLEM.TOKEN_EXPIRED)),
      http.post(api("/auth/token/refresh"), () => problemResponse(PROBLEM.REFRESH_TOKEN_INVALID)),
    );
    await signIn({ refreshToken: "e2e-refresh-midrender-invalid" });

    await page.goto("/home");

    await expect(page).toHaveURL("/login");
    expect(await authCookie(context, ACCESS_TOKEN_COOKIE)).toBeUndefined();
    expect(await authCookie(context, REFRESH_TOKEN_COOKIE)).toBeUndefined();
  });

  test("재발급한 뒤에도 TOKEN_EXPIRED면 재발급을 되풀이하지 않고 오류 화면을 보여 준다", async ({
    page,
    signIn,
    msw,
  }) => {
    let refreshCalls = 0;
    msw.use(
      http.get(api("/home"), () => problemResponse(PROBLEM.TOKEN_EXPIRED)),
      http.post(api("/auth/token/refresh"), () => {
        refreshCalls += 1;
        return HttpResponse.json(REFRESHED_TOKENS);
      }),
    );
    await signIn({ refreshToken: "e2e-refresh-loop" });

    await page.goto("/home");

    await expect(page.getByRole("heading", { name: "화면을 불러오지 못했어요" })).toBeVisible();
    expect(refreshCalls).toBe(1);
  });
});

// 웹 Swagger 공통 오류 401 UNAUTHORIZED. 목 서버는 토큰을 검사하지 않아(웹 Swagger 설명)
// 이 응답을 주지 않으므로, ProblemDetail 형식으로 테스트에서 만든다.
test.describe("접근 제어 · 인증 실패 (UNAUTHORIZED)", () => {
  test("홈 API가 UNAUTHORIZED면 남은 쿠키를 지우고 로그인 화면으로 보내며, 로그인 화면에 머물 수 있다", async ({
    page,
    context,
    signIn,
    msw,
  }) => {
    msw.use(
      http.get(api("/home"), () => problemResponse(PROBLEM.UNAUTHORIZED)),
      http.get(api("/users/me"), () => problemResponse(PROBLEM.UNAUTHORIZED)),
    );
    await signIn();

    await page.goto("/home");

    await expect(page).toHaveURL("/login");
    await expect(page.getByRole("heading", { name: "로그인" })).toBeVisible();
    expect(await authCookie(context, ACCESS_TOKEN_COOKIE)).toBeUndefined();
    expect(await authCookie(context, REFRESH_TOKEN_COOKIE)).toBeUndefined();

    // 쿠키가 지워졌으니 다시 들어와도 홈으로 튕기지 않는다.
    await page.reload();
    await expect(page).toHaveURL("/login");
  });
});
