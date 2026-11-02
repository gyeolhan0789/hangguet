import type { Page } from "@playwright/test";

import { ACCESS_TOKEN_COOKIE } from "../src/lib/api/auth-cookies";

import {
  cookie,
  interceptKakao,
  KAKAO_CALLBACK,
  KAKAO_CLIENT_ID,
  KAKAO_NOTICE_COOKIE,
  KAKAO_SIGNUP_COOKIE,
  KAKAO_STATE_COOKIE,
} from "./kakao";
import { AUTH_TOKENS, SOCIAL_SIGNUP_REQUIRED } from "./mocks/data";
import { api, expect, http, HttpResponse, hydrated, problemResponse, test } from "./test";

// S01 [카카오 로그인] · S01-1 [카카오로 시작하기] · 콜백(1.6) · S01-3 약관 동의 모달(1.7)
// 근거: Figma S01 · S01-1 카카오 버튼 · S01-3(435:2095) · 기획 메모 S01-3(423:2140) · 웹 Swagger 1.6 · 1.7
// 카카오 인가 화면은 실제로 가지 않는다(e2e/kakao.ts). 콜백이 부르는 1.6 · 1.7은 MSW가 답한다.

const kakaoLogin = (page: Page) => page.getByRole("button", { name: "카카오 로그인" });
const signupModal = (page: Page) => page.getByRole("dialog", { name: "회원가입" });
const alert = (page: Page) => page.getByRole("main").getByRole("alert");

/** S01에서 [카카오 로그인]을 눌러 카카오 인가 화면까지 간다(서버가 state 쿠키를 심는다) */
async function startKakaoLogin(page: Page) {
  const kakao = await interceptKakao(page);
  await page.goto("/login");
  await kakaoLogin(page).click();
  await expect(page).toHaveTitle("카카오");
  return kakao;
}

test.describe("S01 [카카오 로그인] → 카카오 인가 화면", () => {
  test("state를 httpOnly 쿠키에 담고 카카오 인가 화면으로 간다(메시지 동의는 요청하지 않는다)", async ({
    page,
    context,
  }) => {
    const kakao = await startKakaoLogin(page);

    const authorize = kakao.last();
    expect(`${authorize.origin}${authorize.pathname}`).toBe(
      "https://kauth.kakao.com/oauth/authorize",
    );
    expect(Object.fromEntries(authorize.searchParams)).toEqual({
      response_type: "code",
      client_id: KAKAO_CLIENT_ID,
      redirect_uri: KAKAO_CALLBACK,
      state: expect.stringMatching(/^[\w-]{43}$/),
    });
    expect(await cookie(context, KAKAO_STATE_COOKIE)).toMatchObject({
      value: `login.${authorize.searchParams.get("state")}`,
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
      path: "/",
    });
  });

  test("S01-1 [카카오로 시작하기]도 같은 카카오 인가 화면으로 간다", async ({ page }) => {
    const kakao = await interceptKakao(page);
    await page.goto("/signup");

    await page.getByRole("button", { name: "카카오로 시작하기" }).click();

    await expect(page).toHaveTitle("카카오");
    expect(kakao.last().searchParams.get("redirect_uri")).toBe(KAKAO_CALLBACK);
  });
});

test.describe("콜백 · 1.6 소셜 로그인", () => {
  test("가입한 회원이면 인가 코드로 1.6을 부르고 토큰 쿠키를 저장해 S02 홈으로 간다", async ({
    page,
    msw,
    context,
  }) => {
    const bodies: unknown[] = [];
    msw.use(
      http.post(api("/auth/oauth/kakao"), async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json({ signupRequired: false, token: AUTH_TOKENS, signup: null });
      }),
    );
    const kakao = await startKakaoLogin(page);

    await kakao.returns({ code: "kakao-code" });

    await expect(page).toHaveURL("/home");
    expect(bodies).toEqual([{ code: "kakao-code", redirectUri: KAKAO_CALLBACK }]);
    expect((await cookie(context, ACCESS_TOKEN_COOKIE))?.value).toBe(AUTH_TOKENS.accessToken);
    // state는 한 번 쓰고 지운다
    expect(await cookie(context, KAKAO_STATE_COOKIE)).toBeUndefined();
  });

  test("이미 가입한 이메일이면(409) S01 로그인 버튼 위에 서버 문구를 보이고, 새로 고치면 사라진다", async ({
    page,
    msw,
    context,
  }) => {
    msw.use(
      http.post(api("/auth/oauth/kakao"), () =>
        problemResponse({
          title: "Conflict",
          status: 409,
          detail: "이미 가입한 이메일이에요. 처음 가입한 방법으로 로그인해 주세요.",
          instance: "/api/v1/auth/oauth/kakao",
          code: "SOCIAL_EMAIL_DUPLICATED",
        }),
      ),
    );
    const kakao = await startKakaoLogin(page);

    await kakao.returns({ code: "duplicated" });

    await expect(page).toHaveURL("/login");
    await expect(alert(page)).toHaveText(
      "이미 가입한 이메일이에요. 처음 가입한 방법으로 로그인해 주세요.",
    );
    await expect(signupModal(page)).toHaveCount(0);
    // 문구는 주소에 싣지 않고, 보여 준 뒤 쿠키에서 지운다
    expect(new URL(page.url()).search).toBe("");
    await expect.poll(() => cookie(context, KAKAO_NOTICE_COOKIE)).toBeUndefined();

    await page.reload();
    await hydrated(kakaoLogin(page));
    await expect(alert(page)).toHaveCount(0);
  });

  test("카카오 동의 화면에서 취소하면 1.6을 부르지 않고 문구 없이 S01로 돌아온다", async ({
    page,
    msw,
    context,
  }) => {
    let called = false;
    msw.use(
      http.post(api("/auth/oauth/kakao"), () => {
        called = true;
        return HttpResponse.json(SOCIAL_SIGNUP_REQUIRED);
      }),
    );
    const kakao = await startKakaoLogin(page);

    await kakao.returns({ error: "access_denied" });

    await expect(page).toHaveURL("/login");
    await expect(kakaoLogin(page)).toBeEnabled();
    expect(await cookie(context, KAKAO_NOTICE_COOKIE)).toBeUndefined();
    expect(await cookie(context, KAKAO_STATE_COOKIE)).toBeUndefined();
    await expect(alert(page)).toHaveCount(0);
    expect(called).toBe(false);
  });

  test("state가 저장한 값과 다르면 1.6을 부르지 않고 정해 둔 문구를 보이며, 진행 중이던 state는 지우지 않는다", async ({
    page,
    msw,
    context,
  }) => {
    let called = false;
    msw.use(
      http.post(api("/auth/oauth/kakao"), () => {
        called = true;
        return HttpResponse.json(SOCIAL_SIGNUP_REQUIRED);
      }),
    );
    const kakao = await startKakaoLogin(page);
    const saved = (await cookie(context, KAKAO_STATE_COOKIE))?.value;

    await kakao.returns({ code: "stolen" }, "forged");

    await expect(page).toHaveURL("/login");
    await expect(alert(page)).toHaveText("소셜 로그인에 실패했어요. 다시 시도해 주세요.");
    expect(called).toBe(false);
    expect((await cookie(context, KAKAO_STATE_COOKIE))?.value).toBe(saved);
  });
});

test.describe("S01-3 약관 동의 모달 · 1.7 소셜 회원가입", () => {
  test.beforeEach(async ({ msw }) => {
    msw.use(http.post(api("/auth/oauth/kakao"), () => HttpResponse.json(SOCIAL_SIGNUP_REQUIRED)));
  });

  /** 모달이 하이드레이션돼 포커스를 받은 뒤(그 전 클릭은 사라진다) 전체 동의를 체크한다 */
  const agreeAll = async (page: Page) => {
    await expect(signupModal(page)).toBeFocused();
    // 체크박스는 화면에 그린 상자에 가려져 있어 사람처럼 글자를 누른다(signup.spec.ts와 같다)
    await signupModal(page).getByText("전체 동의").click();
    await expect(signupModal(page).getByRole("checkbox", { name: "전체 동의" })).toBeChecked();
  };

  test("처음 온 사람은 S01 위에 모달이 뜨고, 모두 동의하면 1.7로 가입해 홈으로 간다", async ({
    page,
    msw,
    context,
  }) => {
    const bodies: unknown[] = [];
    msw.use(
      http.post(api("/auth/oauth/signup"), async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json(AUTH_TOKENS, { status: 201 });
      }),
    );
    const kakao = await startKakaoLogin(page);

    await kakao.returns({ code: "signup" });

    const modal = signupModal(page);
    await expect(modal).toBeVisible();
    await expect(modal).toContainText("카카오 계정으로 가입해요");
    // 가입 토큰은 주소에 싣지 않고 httpOnly 쿠키에만 둔다
    expect(new URL(page.url()).search).toBe("");
    expect(await cookie(context, KAKAO_SIGNUP_COOKIE)).toMatchObject({
      value: "Zm9v",
      httpOnly: true,
    });
    const submit = modal.getByRole("button", { name: "가입하고 시작하기" });
    await expect(submit).toBeDisabled();

    await agreeAll(page);
    await submit.click();

    await expect(page).toHaveURL("/home");
    expect(bodies).toEqual([
      {
        signupToken: "Zm9v",
        agreements: [
          { termsType: "TERMS", termsVersion: "1.0" },
          { termsType: "PRIVACY", termsVersion: "1.0" },
          { termsType: "RECORDING", termsVersion: "1.0" },
        ],
      },
    ]);
    expect((await cookie(context, ACCESS_TOKEN_COOKIE))?.value).toBe(AUTH_TOKENS.accessToken);
    expect(await cookie(context, KAKAO_SIGNUP_COOKIE)).toBeUndefined();
  });

  test("✕로 닫으면 가입하지 않고, 새로 고쳐도 모달이 다시 뜨지 않는다", async ({
    page,
    context,
  }) => {
    const kakao = await startKakaoLogin(page);
    await kakao.returns({ code: "signup" });
    await expect(signupModal(page)).toBeFocused();

    await signupModal(page).getByRole("button", { name: "닫기" }).click();

    await expect(signupModal(page)).toHaveCount(0);
    await expect.poll(() => cookie(context, KAKAO_SIGNUP_COOKIE)).toBeUndefined();
    await page.reload();
    await hydrated(kakaoLogin(page));
    await expect(signupModal(page)).toHaveCount(0);
  });

  test("가입 시간이 지났으면(1.7 401) 모달을 닫고 S01에 서버 문구를 보인다", async ({
    page,
    msw,
  }) => {
    msw.use(
      http.post(api("/auth/oauth/signup"), () =>
        problemResponse({
          title: "Unauthorized",
          status: 401,
          detail: "가입 시간이 지났어요. 다시 로그인해 주세요.",
          instance: "/api/v1/auth/oauth/signup",
          code: "SIGNUP_TOKEN_INVALID",
        }),
      ),
    );
    const kakao = await startKakaoLogin(page);
    await kakao.returns({ code: "signup" });

    await agreeAll(page);
    await signupModal(page).getByRole("button", { name: "가입하고 시작하기" }).click();

    await expect(alert(page)).toHaveText("가입 시간이 지났어요. 다시 로그인해 주세요.");
    await expect(signupModal(page)).toHaveCount(0);
    await expect(page).toHaveURL("/login");
  });
});
