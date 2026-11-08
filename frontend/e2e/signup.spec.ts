import type { Page } from "@playwright/test";

import { ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE } from "../src/lib/api/auth-cookies";

import { AUTH_TOKENS, HOME, PROBLEM } from "./mocks/data";
import { api, expect, http, HttpResponse, problemResponse, test } from "./test";

// S01-1 회원가입
// 근거: Figma S01-1 와이어프레임 · 디자인, S01-1 기획 메모
//   (입력 즉시 검사: 이메일 형식 · 중복, 비밀번호 조건, 확인 일치 → 칸 아래 안내 /
//    필수 동의 + 모든 칸 통과해야 버튼 활성화 / 가입 완료 → 자동 로그인 → S02-D 첫 방문 홈),
//   S01-1 모션 메모(규칙 칩 ○ → ✓, 전체 동의 → 하위 체크), 웹 Swagger 1.1 이메일 사용 가능 여부 · 1.2 회원가입
// 필수 동의는 Figma의 2개에 녹화 · 음성 동의(웹 Swagger 1.2 필수 약관 3개)와 만 14세 이상 확인(사용자 결정 2026-10-30)을 더한 4개다.
// [보기]는 본문 모달을 연다(lib/legal/documents.ts).

const NICKNAME = "면접왕";
const EMAIL = "a@ssafy.com";
const PASSWORD = "abcd1234";
const AGREEMENTS = [
  "[필수] 만 14세 이상입니다",
  "[필수] 이용약관",
  "[필수] 개인정보 수집 · 이용",
  "[필수] 면접 녹화 · 음성 이용",
];

const submitButton = (page: Page) => page.getByRole("button", { name: "가입하고 시작하기" });
const passwordInput = (page: Page) => page.getByLabel("비밀번호", { exact: true });
const formAlert = (page: Page) => page.getByRole("main").getByRole("alert");

/** 모든 칸을 올바르게 채우고 전체 동의한다. */
async function fillValidForm(page: Page, { nickname = NICKNAME } = {}) {
  await page.getByLabel("닉네임").fill(nickname);
  await page.getByLabel("이메일").fill(EMAIL);
  await passwordInput(page).fill(PASSWORD);
  await page.getByLabel("비밀번호 확인").fill(PASSWORD);
  await page.getByText("전체 동의").click();
  await expect(page.getByText("사용할 수 있는 이메일이에요")).toBeVisible();
}

test.describe("S01-1 회원가입 · 이메일 확인 (1.1)", () => {
  test("형식이 맞으면 입력한 이메일로 중복을 확인하고, 쓸 수 있으면 알려 준다", async ({
    page,
    msw,
  }) => {
    const checked: string[] = [];
    msw.use(
      http.get(api("/auth/email-availability"), ({ request }) => {
        checked.push(new URL(request.url).searchParams.get("email") ?? "");
        return HttpResponse.json({ available: true });
      }),
    );
    await page.goto("/signup");

    await page.getByLabel("이메일").pressSequentially(EMAIL);

    await expect(page.getByText("사용할 수 있는 이메일이에요")).toBeVisible();
    // 글자마다가 아니라 입력이 멈춘 뒤 마지막 값으로 한 번 확인한다.
    expect(checked).toEqual([EMAIL]);
  });

  test("이미 가입된 이메일이면 칸 아래에 안내하고 버튼을 막는다", async ({ page, msw }) => {
    msw.use(
      http.get(api("/auth/email-availability"), () => HttpResponse.json({ available: false })),
    );
    await page.goto("/signup");

    await page.getByLabel("닉네임").fill(NICKNAME);
    await page.getByLabel("이메일").fill(EMAIL);
    await passwordInput(page).fill(PASSWORD);
    await page.getByLabel("비밀번호 확인").fill(PASSWORD);
    await page.getByText("전체 동의").click();

    await expect(page.getByText("이미 사용 중인 이메일이에요.")).toBeVisible();
    await expect(page.getByLabel("이메일")).toHaveAttribute("aria-invalid", "true");
    await expect(submitButton(page)).toBeDisabled();
  });

  test("확인하지 못하면(500) 다시 시도하라고 안내하고 버튼을 막는다", async ({ page, msw }) => {
    msw.use(
      http.get(api("/auth/email-availability"), () => problemResponse(PROBLEM.INTERNAL_ERROR)),
    );
    await page.goto("/signup");

    await page.getByLabel("이메일").fill(EMAIL);

    await expect(
      page.getByText("이메일을 확인하지 못했어요. 잠시 후 다시 시도해 주세요."),
    ).toBeVisible();
    await expect(submitButton(page)).toBeDisabled();
  });

  test("형식이 틀리면 형식 안내만 하고 중복 확인을 부르지 않는다", async ({ page, msw }) => {
    let called = false;
    msw.use(
      http.get(api("/auth/email-availability"), () => {
        called = true;
        return HttpResponse.json({ available: true });
      }),
    );
    // 확인 대기 시간(0.4초)을 실제로 기다리지 않고 브라우저 시계로 넘긴다.
    await page.clock.install();
    await page.goto("/signup");

    await page.getByLabel("이메일").fill("a@ssafy");

    await expect(page.getByText("이메일 형식을 확인해 주세요.")).toBeVisible();
    await page.clock.runFor(1_000);
    expect(called).toBe(false);
  });

  test("이메일을 바꾸면 바꾼 이메일로 다시 확인한다", async ({ page, msw }) => {
    const TAKEN = "taken@ssafy.com";
    msw.use(
      http.get(api("/auth/email-availability"), ({ request }) =>
        HttpResponse.json({ available: new URL(request.url).searchParams.get("email") !== TAKEN }),
      ),
    );
    await page.goto("/signup");
    const email = page.getByLabel("이메일");

    await email.fill(TAKEN);
    await expect(page.getByText("이미 사용 중인 이메일이에요.")).toBeVisible();

    await email.fill(EMAIL);
    await expect(page.getByText("사용할 수 있는 이메일이에요")).toBeVisible();
    await expect(page.getByText("이미 사용 중인 이메일이에요.")).toHaveCount(0);
  });
});

test.describe("S01-1 회원가입 · 입력 즉시 검사", () => {
  test("비밀번호 규칙 칩이 조건을 채울 때마다 충족으로 바뀐다", async ({ page }) => {
    await page.goto("/signup");
    const password = passwordInput(page);

    await expect(page.getByText("8자 이상 미충족")).toBeVisible();
    await expect(page.getByText("영문 + 숫자 미충족")).toBeVisible();

    await password.fill("abcdefgh");
    await expect(page.getByText("8자 이상 충족")).toBeVisible();
    await expect(page.getByText("영문 + 숫자 미충족")).toBeVisible();

    await password.fill("abc123");
    await expect(page.getByText("8자 이상 미충족")).toBeVisible();
    await expect(page.getByText("영문 + 숫자 충족")).toBeVisible();

    await password.fill(PASSWORD);
    await expect(page.getByText("8자 이상 충족")).toBeVisible();
    await expect(page.getByText("영문 + 숫자 충족")).toBeVisible();
  });

  test("비밀번호 확인이 다르면 안내하고, 같아지면 사라진다", async ({ page }) => {
    await page.goto("/signup");
    const confirm = page.getByLabel("비밀번호 확인");

    await passwordInput(page).fill(PASSWORD);
    await confirm.fill("abcd12345");
    await expect(page.getByText("비밀번호가 일치하지 않아요.")).toBeVisible();
    await expect(confirm).toHaveAttribute("aria-invalid", "true");

    await confirm.fill(PASSWORD);
    await expect(page.getByText("비밀번호가 일치하지 않아요.")).toHaveCount(0);
  });

  test("확인 칸을 채운 뒤 비밀번호를 바꿔도 다시 비교한다", async ({ page }) => {
    await page.goto("/signup");

    await passwordInput(page).fill(PASSWORD);
    await page.getByLabel("비밀번호 확인").fill(PASSWORD);
    await expect(page.getByText("비밀번호가 일치하지 않아요.")).toHaveCount(0);

    await passwordInput(page).fill("abcd5678");
    await expect(page.getByText("비밀번호가 일치하지 않아요.")).toBeVisible();
  });

  test("닉네임을 비운 채 다음 칸으로 넘어가거나 공백만 넣으면 안내한다", async ({ page }) => {
    await page.goto("/signup");
    const nickname = page.getByLabel("닉네임");

    await nickname.fill(NICKNAME);
    await nickname.fill("");
    await page.getByLabel("이메일").focus();
    await expect(page.getByText("닉네임을 입력해 주세요.")).toBeVisible();

    await nickname.fill("   ");
    await expect(page.getByText("닉네임을 입력해 주세요.")).toBeVisible();
  });
});

test.describe("S01-1 회원가입 · 약관 동의 · 버튼 활성화", () => {
  test("[전체 동의]를 누르면 필수 동의 4개가 모두 체크되고, 다시 누르면 모두 풀린다", async ({
    page,
  }) => {
    await page.goto("/signup");
    const all = page.getByRole("checkbox", { name: "전체 동의" });

    await page.getByText("전체 동의").click();
    await expect(all).toBeChecked();
    for (const label of AGREEMENTS) {
      await expect(page.getByRole("checkbox", { name: label })).toBeChecked();
    }

    await page.getByText("전체 동의").click();
    await expect(all).not.toBeChecked();
    for (const label of AGREEMENTS) {
      await expect(page.getByRole("checkbox", { name: label })).not.toBeChecked();
    }
    // 만 14세 이상 확인 줄에는 본문이 없어 [보기]가 없다
    await expect(page.getByRole("button", { name: /보기$/ })).toHaveCount(3);
  });

  test("하나씩 모두 체크하면 [전체 동의]도 체크되고, 하나를 풀면 [전체 동의]도 풀린다", async ({
    page,
  }) => {
    await page.goto("/signup");
    const all = page.getByRole("checkbox", { name: "전체 동의" });

    for (const label of AGREEMENTS) await page.getByText(label).click();
    await expect(all).toBeChecked();

    await page.getByText("[필수] 면접 녹화 · 음성 이용").click();
    await expect(all).not.toBeChecked();
  });

  test("처음에는 버튼이 비활성이고, 모든 칸 통과 + 필수 동의를 마쳐야 활성화된다", async ({
    page,
  }) => {
    await page.goto("/signup");
    await expect(submitButton(page)).toBeDisabled();

    await fillValidForm(page);
    await expect(submitButton(page)).toBeEnabled();

    // 필수 동의를 하나라도 풀면 다시 막힌다(녹화 · 음성 동의 포함).
    await page.getByText("[필수] 면접 녹화 · 음성 이용").click();
    await expect(submitButton(page)).toBeDisabled();
    await page.getByText("[필수] 면접 녹화 · 음성 이용").click();
    await expect(submitButton(page)).toBeEnabled();

    // 만 14세 이상 확인을 풀어도 막힌다(서버에는 보내지 않는 화면 확인).
    await page.getByText("[필수] 만 14세 이상입니다").click();
    await expect(submitButton(page)).toBeDisabled();
    await page.getByText("[필수] 만 14세 이상입니다").click();
    await expect(submitButton(page)).toBeEnabled();

    // 비밀번호 조건이 깨져도 막힌다.
    await passwordInput(page).fill("abcdefgh");
    await expect(submitButton(page)).toBeDisabled();
  });

  test("[보기]는 동의 항목의 본문을 모달로 보여 주고, [확인]으로 닫는다. 체크는 바뀌지 않는다", async ({
    page,
  }) => {
    await page.goto("/signup");

    for (const [button, title] of [
      ["서비스 이용약관 보기", "서비스 이용약관"],
      ["개인정보 수집 · 이용 동의 보기", "개인정보 수집 · 이용 동의"],
      ["면접 녹화 · 음성 이용 동의 보기", "면접 녹화 · 음성 이용 동의"],
    ]) {
      await page.getByRole("button", { name: button }).click();
      const dialog = page.getByRole("dialog", { name: title });
      await expect(dialog).toBeVisible();
      await dialog.getByRole("button", { name: "확인" }).click();
      await expect(dialog).toBeHidden();
    }
    for (const label of AGREEMENTS) {
      await expect(page.getByRole("checkbox", { name: label })).not.toBeChecked();
    }
    // 만 14세 이상 확인 줄에는 본문이 없어 [보기]가 없다
    await expect(page.getByRole("button", { name: /보기$/ })).toHaveCount(3);
  });
});

test.describe("S01-1 회원가입 · 제출 (1.2)", () => {
  test("가입하면 입력값과 필수 동의 3개를 보내고, 자동 로그인돼 S02-D 첫 방문 홈으로 간다", async ({
    page,
    context,
    msw,
  }) => {
    let body: unknown;
    msw.use(
      http.post(api("/auth/signup"), async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(AUTH_TOKENS, { status: 201 });
      }),
      http.get(api("/home"), () => HttpResponse.json(HOME.FIRST_VISIT)),
    );
    await page.goto("/signup");

    // 닉네임 앞뒤 공백은 빼고 보낸다(웹 Swagger SignupRequest.nickname).
    await fillValidForm(page, { nickname: `  ${NICKNAME} ` });
    await submitButton(page).click();

    await expect(page).toHaveURL("/home");
    // S02-D 첫 방문 홈: 0일 전환이 지나간 뒤 '첫 연습' 문구가 보인다.
    await expect(page.getByRole("status")).toHaveCount(0, { timeout: 10_000 });
    await expect(page.getByRole("main").getByText("첫 연습을 시작해볼까요?")).toBeVisible();
    expect(body).toEqual({
      nickname: NICKNAME,
      email: EMAIL,
      password: PASSWORD,
      agreements: [
        { termsType: "TERMS", termsVersion: "1.0" },
        { termsType: "PRIVACY", termsVersion: "1.0" },
        { termsType: "RECORDING", termsVersion: "1.1" },
      ],
    });
    const cookies = await context.cookies();
    expect(cookies.find((c) => c.name === ACCESS_TOKEN_COOKIE)).toMatchObject({
      value: AUTH_TOKENS.accessToken,
      httpOnly: true,
    });
    expect(cookies.find((c) => c.name === REFRESH_TOKEN_COOKIE)).toMatchObject({
      value: AUTH_TOKENS.refreshToken,
      httpOnly: true,
    });
  });

  test("응답을 기다리는 동안 버튼이 '가입하는 중…'으로 바뀌고 다시 누를 수 없다", async ({
    page,
    msw,
  }) => {
    let calls = 0;
    let respond!: () => void;
    const responded = new Promise<void>((resolve) => (respond = resolve));
    msw.use(
      http.post(api("/auth/signup"), async () => {
        calls += 1;
        await responded;
        return HttpResponse.json(AUTH_TOKENS, { status: 201 });
      }),
      http.get(api("/home"), () => HttpResponse.json(HOME.FIRST_VISIT)),
    );
    await page.goto("/signup");

    await fillValidForm(page);
    await submitButton(page).click();

    const pending = page.getByRole("button", { name: "가입하는 중…" });
    await expect(pending).toBeDisabled();
    await expect(pending).toHaveAttribute("aria-busy", "true");

    respond();
    await expect(page).toHaveURL("/home");
    expect(calls).toBe(1);
  });

  test("확인 뒤 다른 사람이 먼저 가입했으면(EMAIL_DUPLICATED) 이메일 칸에 안내한다", async ({
    page,
    msw,
  }) => {
    msw.use(http.post(api("/auth/signup"), () => problemResponse(PROBLEM.EMAIL_DUPLICATED)));
    await page.goto("/signup");

    await fillValidForm(page);
    await submitButton(page).click();

    await expect(page.getByText(PROBLEM.EMAIL_DUPLICATED.detail)).toBeVisible();
    await expect(page.getByLabel("이메일")).toHaveAttribute("aria-invalid", "true");
    await expect(page).toHaveURL("/signup");
  });

  test("서버가 입력값을 거절하면(VALIDATION_FAILED) 해당 칸에 서버 안내를 보여 준다", async ({
    page,
    msw,
  }) => {
    msw.use(http.post(api("/auth/signup"), () => problemResponse(PROBLEM.VALIDATION_FAILED)));
    await page.goto("/signup");

    await fillValidForm(page);
    await submitButton(page).click();

    await expect(page.getByText(PROBLEM.VALIDATION_FAILED.errors[0].reason)).toBeVisible();
    await expect(passwordInput(page)).toHaveAttribute("aria-invalid", "true");
    await expect(page).toHaveURL("/signup");
  });

  test("서버가 폼에 없는 칸(agreements)을 거절하면(VALIDATION_FAILED) 폼 아래에 안내한다", async ({
    page,
    msw,
  }) => {
    msw.use(
      http.post(api("/auth/signup"), () => problemResponse(PROBLEM.VALIDATION_FAILED_AGREEMENTS)),
    );
    await page.goto("/signup");

    await fillValidForm(page);
    await submitButton(page).click();

    await expect(formAlert(page)).toHaveText(PROBLEM.VALIDATION_FAILED_AGREEMENTS.detail);
    await expect(page).toHaveURL("/signup");
    await expect(submitButton(page)).toBeEnabled();
  });

  test("폼에 있는 칸과 없는 칸이 함께 거절되면, 칸 아래 안내와 폼 아래 안내를 모두 보여 준다", async ({
    page,
    msw,
  }) => {
    msw.use(
      http.post(api("/auth/signup"), () =>
        problemResponse({
          ...PROBLEM.VALIDATION_FAILED,
          errors: [
            ...PROBLEM.VALIDATION_FAILED.errors,
            ...PROBLEM.VALIDATION_FAILED_AGREEMENTS.errors,
          ],
        }),
      ),
    );
    await page.goto("/signup");

    await fillValidForm(page);
    await submitButton(page).click();

    await expect(page.getByText(PROBLEM.VALIDATION_FAILED.errors[0].reason)).toBeVisible();
    await expect(
      formAlert(page).filter({ hasText: PROBLEM.VALIDATION_FAILED.detail }),
    ).toBeVisible();
  });

  test("필수 약관 동의가 빠졌다고 하면(AGREEMENT_REQUIRED) 안내한다", async ({ page, msw }) => {
    msw.use(http.post(api("/auth/signup"), () => problemResponse(PROBLEM.AGREEMENT_REQUIRED)));
    await page.goto("/signup");

    await fillValidForm(page);
    await submitButton(page).click();

    await expect(formAlert(page)).toHaveText(PROBLEM.AGREEMENT_REQUIRED.detail);
    await expect(page).toHaveURL("/signup");
  });

  test("서버 오류(500)면 잠시 후 다시 시도하라고 안내하고, 쿠키를 만들지 않는다", async ({
    page,
    context,
    msw,
  }) => {
    msw.use(http.post(api("/auth/signup"), () => problemResponse(PROBLEM.INTERNAL_ERROR)));
    await page.goto("/signup");

    await fillValidForm(page);
    await submitButton(page).click();

    await expect(formAlert(page)).toHaveText("잠시 후 다시 시도해 주세요.");
    await expect(page).toHaveURL("/signup");
    expect((await context.cookies()).map((c) => c.name)).not.toContain(ACCESS_TOKEN_COOKIE);
  });
});

// 좁은 화면에서는 왼쪽 브랜드 패널('오늘' 링 카드)이 숨겨진다. 링이 다 채워지면 홈으로 넘어가므로, 숨겨져 있어도 넘어가는지 본다.
test.describe("S01-1 회원가입 · 좁은 화면", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("왼쪽 카드가 숨겨진 화면에서도 가입이 끝나면 S02-D 첫 방문 홈으로 간다", async ({
    page,
    msw,
  }) => {
    msw.use(http.get(api("/home"), () => HttpResponse.json(HOME.FIRST_VISIT)));
    await page.goto("/signup");

    await fillValidForm(page);
    await submitButton(page).click();

    await expect(page).toHaveURL("/home");
  });
});

test.describe("S01-1 회원가입 · 이동", () => {
  test("[이미 계정이 있나요? 로그인] → S01 로그인", async ({ page }) => {
    await page.goto("/signup");
    await page.getByRole("main").getByRole("link", { name: "로그인" }).click();

    await expect(page).toHaveURL("/login");
    await expect(page.getByRole("heading", { name: "로그인" })).toBeVisible();
  });
});
