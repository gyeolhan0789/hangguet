import { PROBLEM } from "./mocks/data";
import { api, expect, http, HttpResponse, problemResponse, test } from "./test";

// 비밀번호 찾기 · 재설정 · 로그인 잠금 안내
// 근거: Figma [보류] S01-2 비밀번호 찾기(18:3300) · 웹 Swagger 1.3 로그인(429 LOGIN_LOCKED) · 1.8 비밀번호 찾기 메일 요청 ·
//   1.9 비밀번호 재설정 · 사용자 결정(2026-11-08: 회원가입 틀, 다시 보내기 30초, 재설정 화면)

const EMAIL = "a@ssafy.com";

test.describe("비밀번호 찾기(1.8)", () => {
  test("로그인 화면에서 들어와 메일을 요청하면 보낸 뒤 화면을 보인다", async ({ page, msw }) => {
    let body: unknown;
    msw.use(
      http.post(api("/auth/password-reset"), async ({ request }) => {
        body = await request.json();
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await page.goto("/login");

    await page.getByRole("link", { name: "비밀번호를 잊으셨나요?" }).click();
    await expect(page).toHaveURL("/forgot-password");
    await page.getByLabel("이메일").fill(EMAIL);
    await page.getByRole("button", { name: "재설정 링크 보내기" }).click();

    await expect(page.getByRole("heading", { name: "메일을 보냈어요!" })).toBeVisible();
    await expect(
      page.getByText(`${EMAIL}(으)로 가입했다면받은 편지함을 확인해주세요.(스팸함도 확인)`),
    ).toBeVisible();
    expect(body).toEqual({ email: EMAIL });

    await page.getByRole("link", { name: "로그인으로 돌아가기" }).click();
    await expect(page).toHaveURL("/login");
  });

  test("다시 보내기는 30초 뒤에 누를 수 있다", async ({ page, msw }) => {
    let calls = 0;
    msw.use(
      http.post(api("/auth/password-reset"), () => {
        calls += 1;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    // 시계를 멈춰 두고 1초씩 직접 넘긴다. 1초마다 다음 타이머를 거는 카운트다운이라 한 번에 넘기지 않는다.
    const start = new Date("2026-11-08T10:00:00+09:00");
    await page.clock.install({ time: start });
    await page.goto("/forgot-password");
    await page.clock.pauseAt(new Date(start.getTime() + 10_000));
    await page.getByLabel("이메일").fill(EMAIL);
    await page.getByRole("button", { name: "재설정 링크 보내기" }).click();

    await expect(page.getByText("다시 보내기 (30초 후)")).toBeVisible();
    await expect(page.getByRole("button", { name: "다시 보내기" })).toHaveCount(0);
    for (let seconds = 29; seconds >= 1; seconds--) {
      await page.clock.runFor(1000);
      await expect(page.getByText(`다시 보내기 (${seconds}초 후)`)).toBeVisible();
    }
    await page.clock.runFor(1000);
    await page.getByRole("button", { name: "다시 보내기" }).click();

    await expect(page.getByText("다시 보내기 (30초 후)")).toBeVisible();
    expect(calls).toBe(2);
  });
});

test.describe("비밀번호 재설정(1.9)", () => {
  test("메일 링크로 들어와 바꾸면 주소에서 token을 지우고 로그인으로 보낸다", async ({
    page,
    msw,
  }) => {
    let body: unknown;
    msw.use(
      http.post(api("/auth/password-reset/confirm"), async ({ request }) => {
        body = await request.json();
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await page.goto("/password-reset?token=token-1");
    await expect(page).toHaveURL("/password-reset");

    await page.getByLabel("새 비밀번호").fill("efgh5678");
    await page.getByLabel("비밀번호 확인").fill("efgh5678");
    await page.getByRole("button", { name: "비밀번호 바꾸기" }).click();

    await expect(page.getByRole("heading", { name: "비밀번호를 바꿨어요" })).toBeVisible();
    expect(body).toEqual({ token: "token-1", newPassword: "efgh5678" });
    await page.getByRole("link", { name: "로그인하러 가기" }).click();
    await expect(page).toHaveURL("/login");
  });

  test("만료된 링크면 서버 문구와 다시 받기를 보인다", async ({ page, msw }) => {
    msw.use(
      http.post(api("/auth/password-reset/confirm"), () =>
        problemResponse(PROBLEM.PASSWORD_RESET_TOKEN_INVALID),
      ),
    );
    await page.goto("/password-reset?token=expired");

    await page.getByLabel("새 비밀번호").fill("efgh5678");
    await page.getByLabel("비밀번호 확인").fill("efgh5678");
    await page.getByRole("button", { name: "비밀번호 바꾸기" }).click();

    await expect(page.getByRole("main").getByRole("alert")).toHaveText(
      PROBLEM.PASSWORD_RESET_TOKEN_INVALID.detail,
    );
    await page.getByRole("link", { name: "재설정 링크 다시 받기" }).click();
    await expect(page).toHaveURL("/forgot-password");
  });

  test("token 없이 들어오면 다시 받기 화면이다", async ({ page }) => {
    await page.goto("/password-reset");

    await expect(page.getByLabel("새 비밀번호")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "재설정 링크 다시 받기" })).toBeVisible();
  });
});

test.describe("로그인 잠금(1.3 429)", () => {
  test("잠기면 남은 시간을 분으로 안내하고 로그인 화면에 머문다", async ({ page, msw }) => {
    msw.use(http.post(api("/auth/login"), () => problemResponse(PROBLEM.LOGIN_LOCKED)));
    await page.goto("/login");

    await page.getByLabel("이메일").fill(EMAIL);
    await page.getByLabel("비밀번호", { exact: true }).fill("abcd1234");
    await page.getByRole("button", { name: "로그인", exact: true }).click();

    await expect(page.getByRole("main").getByRole("alert")).toHaveText(
      "로그인에 여러 번 실패했어요. 15분 뒤에 다시 시도해 주세요.",
    );
    await expect(page).toHaveURL("/login");
  });
});
