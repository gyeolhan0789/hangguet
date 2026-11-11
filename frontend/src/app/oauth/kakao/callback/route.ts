import type { NextRequest } from "next/server";

import { ACCESS_TOKEN_COOKIE, setAuthCookies } from "@/lib/api/auth-cookies";
import { endpoints } from "@/lib/api/endpoints";
import { getProblemDetail, RETRY_LATER } from "@/lib/api/problem-detail";
import { plainClient } from "@/lib/api/token-refresh";
import {
  clearSignupToken,
  clearState,
  KAKAO_CONSENT_FAILED,
  KAKAO_UNAVAILABLE,
  kakaoConfig,
  OAUTH_STATE_COOKIE,
  purposeOf,
  saveLinked,
  saveNotice,
  saveSignupToken,
  SOCIAL_LINK_FAILED,
  SOCIAL_LOGIN_FAILED,
  SOCIAL_LOGIN_UNAVAILABLE,
  verifyState,
  type KakaoConfig,
  type KakaoPurpose,
} from "@/lib/auth/kakao";
import { redirectToPath } from "@/lib/auth/redirect-to-path";
import { ROUTES } from "@/lib/routes";
import type {
  ErrorCode,
  PracticeAlarmEnableRequest,
  SocialLinkRequest,
  SocialLoginRequest,
  SocialLoginResponse,
} from "@/types/api";

// 카카오 인가 화면에서 돌아오는 콜백. 로그인(1.6) · 연습 알림 켜기(2.9) · 계정 연결(2.12)이 같은 주소를 쓴다(웹 Swagger 2.9 · 2.12
// redirectUri "카카오 로그인(1.6)과 같은 주소"). 주소의 값은 믿지 않고, 인가를 시작할 때 쿠키에 저장한 state · 용도로 고른다(lib/auth/kakao.ts).
// 기준: 웹 Swagger 1.6 소셜 로그인(SocialLoginRequest → 200 SocialLoginResponse · 400 SOCIAL_EMAIL_REQUIRED · 401 SOCIAL_LOGIN_FAILED
// · 409 SOCIAL_EMAIL_DUPLICATED · 503 SOCIAL_LOGIN_UNAVAILABLE) · 2.9 연습 알림 켜기(PracticeAlarmEnableRequest → 200 · 400
// KAKAO_ACCOUNT_MISMATCH · KAKAO_MESSAGE_CONSENT_REQUIRED · KAKAO_CONSENT_FAILED · 409 PRACTICE_ALARM_UNAVAILABLE · 503 KAKAO_UNAVAILABLE)
// · 2.12 소셜 계정 연결(SocialLinkRequest → 200 MeResponse · 400 SOCIAL_LINK_FAILED · 409 SOCIAL_ALREADY_LINKED · SOCIAL_ACCOUNT_IN_USE
// · 503 SOCIAL_LOGIN_UNAVAILABLE) · 사용자 결정(연결하면 S09-1로 돌아와 '연결이 완료되었어요' 안내 모달, 실패는 서버 문구 토스트)
// · 기획 메모 S01-3(423:2140) · S09-1-B(428:2146): 가입한 회원 → S02 홈, 처음 온 사람 → S01 위 약관 동의 모달, 알림 → S09-1로 돌아옴,
// 카카오 화면에서 취소 → 문구 없이 돌아감, 고칠 수 있는 오류는 서버 detail · 고칠 수 없는 오류(VALIDATION_FAILED · state 불일치)는
// 정해 둔 문구, 처리 뒤 바로 다른 주소로 보내 인가 코드가 주소창 · 기록에 남지 않게 한다.
// 이 Handler는 인가 코드가 든 주소로 불리므로 다른 주소(재발급 · 로그아웃 Route Handler)로 그 주소를 넘기지 않는다: 401을 받아도
// api 인터셉터처럼 돌아올 주소를 붙여 보내지 않고 정해 둔 화면으로 끝낸다(OAuth 2.0 Security BCP RFC 9700 §4.2 · §4.3).

/**
 * 서버 문구(detail)를 그대로 보여 주는 1.6 오류(기획 메모 S01-3). 401 SOCIAL_LOGIN_FAILED는 정해 둔 문구(SOCIAL_LOGIN_FAILED)와 같아
 * 넣지 않는다: 그 밖의 오류와 함께 정해 둔 문구로 보인다.
 */
const LOGIN_SHOWN_CODES: ReadonlySet<string> = new Set<ErrorCode>([
  "SOCIAL_EMAIL_REQUIRED",
  "SOCIAL_EMAIL_DUPLICATED",
  "SOCIAL_LOGIN_UNAVAILABLE",
]);

/**
 * 서버 문구(detail)를 그대로 보여 주는 2.9 오류(기획 메모 S09-1-B). 400 KAKAO_CONSENT_FAILED는 정해 둔 문구(KAKAO_CONSENT_FAILED)와
 * 같아 넣지 않는다: 그 밖의 오류와 함께 정해 둔 문구로 보인다.
 */
const ALARM_SHOWN_CODES: ReadonlySet<string> = new Set<ErrorCode>([
  "KAKAO_ACCOUNT_MISMATCH",
  "KAKAO_MESSAGE_CONSENT_REQUIRED",
  "PRACTICE_ALARM_UNAVAILABLE",
  "KAKAO_UNAVAILABLE",
]);

/** 서버 문구(detail)를 그대로 보여 주는 2.12 오류(사용자 결정: 2.12 오류는 모두 서버 문구 토스트) */
const LINK_SHOWN_CODES: ReadonlySet<string> = new Set<ErrorCode>([
  "SOCIAL_LINK_FAILED",
  "SOCIAL_ALREADY_LINKED",
  "SOCIAL_ACCOUNT_IN_USE",
  "SOCIAL_LOGIN_UNAVAILABLE",
]);

/** 토큰 오류(공통 401). 동의 문제가 아니므로 문구 없이 설정 화면으로 보낸다: 그 화면을 열 때 proxy가 재발급하거나 로그인으로 보낸다 */
const TOKEN_ERRORS: ReadonlySet<string> = new Set<ErrorCode>(["TOKEN_EXPIRED", "UNAUTHORIZED"]);

/** 카카오가 돌려준 오류 중 사용자가 동의 화면에서 취소한 경우(카카오 로그인 REST API 인가 코드 받기 error) */
const USER_CANCELLED = "access_denied";

interface Outcome {
  /** 보낼 화면 */
  next: string;
  /** 그 화면에 한 번 보일 문구 */
  notice?: string;
  /** 1.6 결과(가입한 회원 · 처음 온 사람) */
  login?: SocialLoginResponse;
  /** 2.12로 계정을 연결했다(S09-1에 완료 안내 모달) */
  linked?: boolean;
}

/** 로그인한 회원이 S09-1에서 시작하는 용도(알림 켜기 · 계정 연결) */
const SETTINGS_PURPOSES: ReadonlySet<KakaoPurpose> = new Set<KakaoPurpose>(["alarm", "link"]);

/** state가 맞지 않을 때 문구 · 돌아갈 화면을 고르는 용도(아래 GET 설명) */
function unverifiedPurpose(loggedIn: boolean, saved: string | undefined): KakaoPurpose {
  if (!loggedIn) return "login";
  return purposeOf(saved) === "link" ? "link" : "alarm";
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const saved = request.cookies.get(OAUTH_STATE_COOKIE)?.value;
  const purpose = verifyState(saved, params.get("state"));
  // state가 맞지 않으면 돌아갈 화면은 로그인 여부로 고른다: 로그인하지 않았으면 로그인(설정 화면은 문구를 보기 전에 로그인으로
  // 보내진다), 로그인한 회원은 설정 화면(로그인 화면은 로그인 전에만 열리므로 로그인 용도일 수 없다). 설정 화면의 문구는 쿠키에 남은
  // 용도(서버만 쓰는 값이라 문구를 고르는 데만 쓴다)가 연결이면 연결 실패, 그 밖(알림 · 만료로 없음)은 알림 실패 문구다.
  const loggedIn = request.cookies.has(ACCESS_TOKEN_COOKIE);
  const known = purpose ?? unverifiedPurpose(loggedIn, saved);
  const target = SETTINGS_PURPOSES.has(known) ? ROUTES.settings : ROUTES.login;
  const failed = failedText(known);

  const outcome: Outcome = !purpose
    ? { next: target, notice: failed }
    : await handle(purpose, request, failed);

  const response = redirectToPath(outcome.next);
  // 인가 코드 · 토큰이 든 응답이 캐시되거나 Referer로 새지 않게
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  // 맞는 state만 지운다: 남이 만든 링크(state가 다른 주소)로 진행 중인 인가를 취소시키지 못하게
  if (purpose) clearState(response.cookies);
  const { login, notice } = outcome;
  if (login?.signupRequired && login.signup) {
    saveSignupToken(response.cookies, login.signup.signupToken, login.signup.expiresIn);
  } else if (purpose === "login") {
    // 로그인했거나 실패했으면 전에 남은 가입 토큰(닫지 않고 떠난 모달)을 지운다
    clearSignupToken(response.cookies);
  }
  if (login && !login.signupRequired && login.token) setAuthCookies(response.cookies, login.token);
  if (outcome.linked) saveLinked(response.cookies);
  if (notice) {
    saveNotice(response.cookies, {
      target: outcome.next === ROUTES.settings ? "settings" : "login",
      text: notice,
    });
  }
  return response;
}

async function handle(
  purpose: KakaoPurpose,
  request: NextRequest,
  failed: string,
): Promise<Outcome> {
  const target = SETTINGS_PURPOSES.has(purpose) ? ROUTES.settings : ROUTES.login;
  const params = request.nextUrl.searchParams;
  const error = params.get("error");
  if (error) return { next: target, notice: error === USER_CANCELLED ? undefined : failed };
  const code = params.get("code");
  if (!code) return { next: target, notice: failed };
  const config = kakaoConfig();
  if (!config) {
    return {
      next: target,
      notice: purpose === "alarm" ? KAKAO_UNAVAILABLE : SOCIAL_LOGIN_UNAVAILABLE,
    };
  }
  const accessToken = request.cookies.get(ACCESS_TOKEN_COOKIE)?.value;
  if (purpose === "login") {
    // 다른 탭에서 그 사이 로그인했으면 지금 세션을 덮어쓰지 않고 홈으로(로그인 화면은 로그인 전에만 열린다)
    return accessToken ? { next: ROUTES.home } : socialLogin(code, config);
  }
  // 2.9 · 2.12는 로그인한 회원 API다. 토큰이 없으면(그 사이 로그아웃) 부르지 않고 로그인 화면으로 보낸다.
  if (!accessToken) return { next: ROUTES.login };
  return purpose === "link"
    ? linkAccount(code, config, accessToken)
    : enableAlarm(code, config, accessToken);
}

/** 용도별로 사용자가 고칠 수 없는 실패(state 불일치 · 카카오 오류 · code 없음)에 보일 정해 둔 문구 */
function failedText(purpose: KakaoPurpose): string {
  if (purpose === "alarm") return KAKAO_CONSENT_FAILED;
  if (purpose === "link") return SOCIAL_LINK_FAILED;
  return SOCIAL_LOGIN_FAILED;
}

/** 1.6 소셜 로그인. 토큰이 없어도 되는 API라 쿠키를 붙이지 않고 보낸다 */
async function socialLogin(code: string, { redirectUri }: KakaoConfig): Promise<Outcome> {
  const body: SocialLoginRequest = { code, redirectUri };
  try {
    const { data } = await plainClient.post<SocialLoginResponse>(
      endpoints.auth.socialLogin("kakao"),
      body,
    );
    if (!data.signupRequired && data.token) return { next: ROUTES.home, login: data };
    if (data.signupRequired && data.signup) return { next: ROUTES.login, login: data };
    return { next: ROUTES.login, notice: SOCIAL_LOGIN_FAILED };
  } catch (error) {
    return {
      next: ROUTES.login,
      notice: shownDetail(error, LOGIN_SHOWN_CODES, SOCIAL_LOGIN_FAILED),
    };
  }
}

/**
 * 2.9 연습 알림 켜기. 성공하면 문구 없이 S09-1로. 401이면(토큰 만료 · 무효) 재발급 · 로그아웃 Route Handler로 이 주소를 넘기지
 * 않고 문구 없이 S09-1로 보낸다: 그 화면을 열 때 proxy가 재발급하거나 로그인 화면으로 보낸다.
 */
async function enableAlarm(
  code: string,
  { redirectUri }: KakaoConfig,
  accessToken: string,
): Promise<Outcome> {
  const body: PracticeAlarmEnableRequest = { code, redirectUri };
  try {
    await plainClient.put(endpoints.users.practiceAlarm, body, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    return { next: ROUTES.settings };
  } catch (error) {
    const problemCode = getProblemDetail(error)?.code;
    if (problemCode && TOKEN_ERRORS.has(problemCode)) return { next: ROUTES.settings };
    return {
      next: ROUTES.settings,
      notice: shownDetail(error, ALARM_SHOWN_CODES, KAKAO_CONSENT_FAILED),
    };
  }
}

/**
 * 2.12 소셜 계정 연결. 성공하면 S09-1로 돌아가 완료 안내 모달을 띄운다. 401이면 2.9와 같이 문구 없이 S09-1로 보낸다.
 */
async function linkAccount(
  code: string,
  { redirectUri }: KakaoConfig,
  accessToken: string,
): Promise<Outcome> {
  const body: SocialLinkRequest = { code, redirectUri };
  try {
    await plainClient.put(endpoints.users.socialAccount("kakao"), body, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    return { next: ROUTES.settings, linked: true };
  } catch (error) {
    const problemCode = getProblemDetail(error)?.code;
    if (problemCode && TOKEN_ERRORS.has(problemCode)) return { next: ROUTES.settings };
    return {
      next: ROUTES.settings,
      notice: shownDetail(error, LINK_SHOWN_CODES, SOCIAL_LINK_FAILED),
    };
  }
}

/** 고칠 수 있는 오류면 서버 문구, 서버에 닿지 못했으면 다시 시도 안내, 그 밖에는 정해 둔 문구 */
function shownDetail(error: unknown, shown: ReadonlySet<string>, fallback: string): string {
  const problem = getProblemDetail(error);
  if (!problem) return RETRY_LATER;
  return problem.code && shown.has(problem.code) && problem.detail ? problem.detail : fallback;
}
