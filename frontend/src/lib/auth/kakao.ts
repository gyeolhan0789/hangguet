import { randomBytes, timingSafeEqual } from "node:crypto";

// 카카오 인가(로그인 1.6 · 연습 알림 켜기 2.9)에 쓰는 설정 · 쿠키 · 주소. 서버(서버 액션 · Route Handler)에서만 쓴다.
// 기준: 웹 Swagger 1.6 소셜 로그인(code · redirectUri: 서버에 등록한 주소) · 2.9 연습 알림 켜기(scope=talk_message,
// redirectUri는 1.6과 같은 주소) · 기획 메모 S01-3 · S09-1-B(state는 서버가 만든 무작위 값을 httpOnly 쿠키에 한 번만 쓰도록 저장,
// 콜백은 주소 값 대신 쿠키에 저장한 용도로 로그인 · 알림을 고름, 가입 토큰과 오류 문구는 주소에 싣지 않고 httpOnly 쿠키로 넘김)
// · 카카오 로그인 REST API '인가 코드 받기'(GET kauth.kakao.com/oauth/authorize: client_id · redirect_uri · response_type=code
// · scope · state)

export const KAKAO_AUTHORIZE_URL = "https://kauth.kakao.com/oauth/authorize";

/** 연습 알림 메시지를 보내려면 받아야 하는 카카오 동의 항목(웹 Swagger 2.9) */
export const KAKAO_MESSAGE_SCOPE = "talk_message";

/** 인가를 시작한 용도. 콜백은 이 값으로 1.6(로그인)과 2.9(알림 켜기)를 고른다 */
export type KakaoPurpose = "login" | "alarm";

const production = process.env.NODE_ENV === "production";

/**
 * 운영에서는 이름에 __Host-를 붙인다: 브라우저가 Secure · Path=/ · Domain 없음일 때만 받으므로, 같은 상위 도메인의 다른
 * 하위 도메인이 state · 가입 토큰 · 문구 쿠키를 심지 못한다(로그인 CSRF · 문구 주입 방지). 개발(http)에서는 Secure를 쓸 수 없어 뺀다.
 */
const cookieName = (name: string) => (production ? `__Host-${name}` : name);

/** 인가 요청의 state와 용도. 콜백에서 한 번 확인하고 지운다 */
export const OAUTH_STATE_COOKIE = cookieName("hk_oauth_state");
/** 1.6이 준 가입 토큰(처음 온 사람). S01 위 약관 동의 모달(S01-3)이 1.7에 쓴다 */
export const SOCIAL_SIGNUP_COOKIE = cookieName("hk_social_signup");
/** 콜백 · 가입 실패 문구를 다음 화면 한 번만 보여 주려고 담아 두는 쿠키 */
export const NOTICE_COOKIE = cookieName("hk_notice");

/** 카카오 화면에서 동의하고 돌아올 때까지 기다리는 시간(초) */
const STATE_MAX_AGE_SECONDS = 600;
/** 문구 쿠키는 바로 다음 화면에서 읽으므로 짧게 둔다(초) */
const NOTICE_MAX_AGE_SECONDS = 60;
/** state 바이트 수(base64url로 43자) */
const STATE_BYTES = 32;

/** 사용자가 고칠 수 없는 로그인 실패(등록 안 된 주소 · state 불일치 등)에 보여 줄 문구. 웹 Swagger 1.6 401 SOCIAL_LOGIN_FAILED detail */
export const SOCIAL_LOGIN_FAILED = "소셜 로그인에 실패했어요. 다시 시도해 주세요.";
/**
 * 카카오에 닿지 못한 로그인(웹 Swagger 1.6 503 SOCIAL_LOGIN_UNAVAILABLE detail). FE 카카오 설정(KAKAO_CLIENT_ID ·
 * KAKAO_REDIRECT_URI)이 없을 때도 사용자에게는 같은 상황이라 이 문구를 쓴다(구현 결정).
 */
export const SOCIAL_LOGIN_UNAVAILABLE =
  "소셜 로그인 서버에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.";
/** 가입 토큰 쿠키가 유효 시간(signup.expiresIn)이 지나 사라졌을 때. 웹 Swagger 1.7 401 SIGNUP_TOKEN_INVALID detail */
export const SIGNUP_TOKEN_INVALID = "가입 시간이 지났어요. 다시 로그인해 주세요.";
/** 사용자가 고칠 수 없는 알림 켜기 실패. 웹 Swagger 2.9 400 KAKAO_CONSENT_FAILED detail */
export const KAKAO_CONSENT_FAILED = "카카오 동의를 확인하지 못했어요. 다시 시도해 주세요.";
/** 카카오에 닿지 못한 알림 켜기(웹 Swagger 2.9 503 KAKAO_UNAVAILABLE detail). FE 카카오 설정이 없을 때도 쓴다(구현 결정) */
export const KAKAO_UNAVAILABLE = "카카오 서버에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.";

export interface KakaoConfig {
  /** 카카오 앱 REST API 키(BE와 같은 앱) */
  clientId: string;
  /** 콜백 주소(절대 주소). BE *_REDIRECT_URIS와 카카오 앱 Redirect URI에 등록한 값과 글자까지 같아야 한다 */
  redirectUri: string;
}

/** 콜백 경로. app/oauth/kakao/callback(ROUTES.kakaoCallback)과 같다 */
const CALLBACK_PATH = "/oauth/kakao/callback";
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * 카카오 앱 설정. 요청 Host 헤더로 주소를 만들지 않고 환경 변수에 고정한다(Host를 바꿔 보내도 다른 주소로 인가 코드가 가지 않게).
 * 둘 중 하나라도 없거나, 콜백 주소가 이 사이트의 콜백 경로가 아니거나, 로컬이 아닌데 https가 아니면 null(쓰지 않는다).
 */
export function kakaoConfig(): KakaoConfig | null {
  // 배포 설정에 따라붙는 앞뒤 공백 · 줄바꿈은 지운다
  const clientId = process.env.KAKAO_CLIENT_ID?.trim();
  const redirectUri = process.env.KAKAO_REDIRECT_URI?.trim();
  if (!clientId || !redirectUri || !URL.canParse(redirectUri)) return null;
  const url = new URL(redirectUri);
  const secure = url.protocol === "https:" || LOCAL_HOSTS.has(url.hostname);
  // 쿼리 · 해시 · 계정 정보 없이 이 경로만 있는 주소(정규화한 주소와 글자까지 같아야 BE · 카카오 등록 값과 비교할 수 있다)
  const plain = url.href === `${url.origin}${CALLBACK_PATH}` && url.href === redirectUri;
  return secure && plain ? { clientId, redirectUri } : null;
}

/**
 * `cookies()`(서버 액션 · Route Handler)와 `NextResponse.cookies`가 같이 쓰는 모양. 지울 때도 set(maxAge 0)으로 같은 속성을 준다
 * (__Host- 쿠키는 Secure가 없는 Set-Cookie로는 지워지지 않는다).
 */
export interface CookieWriter {
  set(name: string, value: string, options?: Record<string, unknown>): unknown;
}

const baseOptions = {
  httpOnly: true,
  secure: production,
  sameSite: "lax",
  path: "/",
} as const;

/**
 * 새 state를 만들어 용도와 함께 쿠키에 저장하고 state를 돌려준다. 콜백은 카카오가 보낸 사이트 밖 GET(최상위 이동)이라
 * SameSite=Lax 쿠키가 실려 온다.
 */
export function issueState(cookies: CookieWriter, purpose: KakaoPurpose): string {
  const state = randomBytes(STATE_BYTES).toString("base64url");
  cookies.set(OAUTH_STATE_COOKIE, `${purpose}.${state}`, {
    ...baseOptions,
    maxAge: STATE_MAX_AGE_SECONDS,
  });
  return state;
}

/** state 쿠키 값에서 용도만 읽는다. 쿠키가 없거나 모양이 다르면 null */
export function purposeOf(saved: string | undefined): KakaoPurpose | null {
  if (!saved?.includes(".")) return null;
  const purpose = saved.split(".", 1)[0];
  return purpose === "login" || purpose === "alarm" ? purpose : null;
}

/** 콜백의 state가 쿠키에 저장한 값과 같으면 그 용도를, 다르면 null. 비교는 길이가 같을 때 일정한 시간으로 한다 */
export function verifyState(
  saved: string | undefined,
  received: string | null,
): KakaoPurpose | null {
  const purpose = purposeOf(saved);
  if (!purpose || !saved || !received) return null;
  const expected = Buffer.from(saved.slice(purpose.length + 1));
  const actual = Buffer.from(received);
  if (expected.length !== actual.length) return null;
  return timingSafeEqual(expected, actual) ? purpose : null;
}

/** 한 번 확인한 state는 다시 쓰지 못하게 지운다 */
export function clearState(cookies: CookieWriter) {
  cookies.set(OAUTH_STATE_COOKIE, "", { ...baseOptions, maxAge: 0 });
}

/** 카카오 인가 화면 주소. 알림은 메시지 동의(talk_message)를 함께 요청한다 */
export function authorizeUrl(config: KakaoConfig, state: string, purpose: KakaoPurpose): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    state,
  });
  if (purpose === "alarm") params.set("scope", KAKAO_MESSAGE_SCOPE);
  return `${KAKAO_AUTHORIZE_URL}?${params.toString()}`;
}

/** 1.6이 준 가입 토큰을 유효 시간(signup.expiresIn) 동안 저장한다 */
export function saveSignupToken(cookies: CookieWriter, signupToken: string, expiresIn: number) {
  cookies.set(SOCIAL_SIGNUP_COOKIE, signupToken, {
    ...baseOptions,
    maxAge: Math.max(Math.floor(expiresIn), 0),
  });
}

export function clearSignupToken(cookies: CookieWriter) {
  cookies.set(SOCIAL_SIGNUP_COOKIE, "", { ...baseOptions, maxAge: 0 });
}

/** 문구를 보여 줄 화면. 로그인 실패는 S01, 알림 켜기 실패는 S09-1 */
export type NoticeTarget = "login" | "settings";

export interface Notice {
  target: NoticeTarget;
  text: string;
}

/** 다음 화면에서 한 번 보여 줄 문구를 담는다. 주소(쿼리)에는 싣지 않는다(남이 만든 문구를 띄우지 못하게) */
export function saveNotice(cookies: CookieWriter, notice: Notice) {
  cookies.set(NOTICE_COOKIE, JSON.stringify(notice), {
    ...baseOptions,
    maxAge: NOTICE_MAX_AGE_SECONDS,
  });
}

/** 문구 쿠키를 읽는다. 그 화면 것이 아니거나 모양이 다르면 null */
export function readNotice(value: string | undefined, target: NoticeTarget): string | null {
  if (!value) return null;
  try {
    const notice: unknown = JSON.parse(value);
    if (
      typeof notice === "object" &&
      notice !== null &&
      "target" in notice &&
      "text" in notice &&
      notice.target === target &&
      typeof notice.text === "string"
    ) {
      return notice.text;
    }
  } catch {
    // 모양이 다른 값은 무시한다
  }
  return null;
}

export function clearNotice(cookies: CookieWriter) {
  cookies.set(NOTICE_COOKIE, "", { ...baseOptions, maxAge: 0 });
}
