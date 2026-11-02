// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  authorizeUrl,
  clearNotice,
  clearSignupToken,
  clearState,
  issueState,
  kakaoConfig,
  NOTICE_COOKIE,
  OAUTH_STATE_COOKIE,
  purposeOf,
  readNotice,
  saveNotice,
  saveSignupToken,
  SOCIAL_SIGNUP_COOKIE,
  verifyState,
} from "./kakao";

// 카카오 인가 도우미(lib/auth/kakao.ts). 쿠키는 set만 기록하는 가짜로 받는다.
// 기준: 카카오 로그인 REST API 인가 코드 받기(response_type · client_id · redirect_uri · state · scope) · 웹 Swagger 2.9(scope=talk_message)

const writer = () => ({ set: vi.fn() });

beforeEach(() => {
  vi.stubEnv("KAKAO_CLIENT_ID", "client-id");
  vi.stubEnv("KAKAO_REDIRECT_URI", "http://localhost:3000/oauth/kakao/callback");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("kakaoConfig", () => {
  it("앱 키와 콜백 주소가 있으면 그대로 쓴다", () => {
    expect(kakaoConfig()).toEqual({
      clientId: "client-id",
      redirectUri: "http://localhost:3000/oauth/kakao/callback",
    });
  });

  it("운영 주소는 https면 받는다", () => {
    vi.stubEnv("KAKAO_REDIRECT_URI", "https://hangguet.co.kr/oauth/kakao/callback");

    expect(kakaoConfig()?.redirectUri).toBe("https://hangguet.co.kr/oauth/kakao/callback");
  });

  it.each([
    ["앱 키가 없다", "KAKAO_CLIENT_ID", ""],
    ["콜백 주소가 없다", "KAKAO_REDIRECT_URI", ""],
    ["주소가 아니다", "KAKAO_REDIRECT_URI", "callback"],
    ["로컬이 아닌데 http다", "KAKAO_REDIRECT_URI", "http://hangguet.co.kr/oauth/kakao/callback"],
    ["콜백 경로가 아니다", "KAKAO_REDIRECT_URI", "https://hangguet.co.kr/oauth/callback"],
    ["쿼리가 붙었다", "KAKAO_REDIRECT_URI", "https://hangguet.co.kr/oauth/kakao/callback?x=1"],
    ["빈 쿼리가 붙었다", "KAKAO_REDIRECT_URI", "https://hangguet.co.kr/oauth/kakao/callback?"],
    ["해시가 붙었다", "KAKAO_REDIRECT_URI", "https://hangguet.co.kr/oauth/kakao/callback#x"],
    ["계정 정보가 붙었다", "KAKAO_REDIRECT_URI", "https://a:b@hangguet.co.kr/oauth/kakao/callback"],
  ])("%s면 쓰지 않는다(null)", (_, name, value) => {
    vi.stubEnv(name, value);

    expect(kakaoConfig()).toBeNull();
  });
});

describe("state", () => {
  it("무작위 state를 용도와 함께 httpOnly 쿠키에 10분 저장한다", () => {
    const cookies = writer();

    const state = issueState(cookies, "login");

    expect(state).toMatch(/^[\w-]{43}$/);
    expect(cookies.set).toHaveBeenCalledWith(OAUTH_STATE_COOKIE, `login.${state}`, {
      httpOnly: true,
      secure: false,
      sameSite: "lax",
      path: "/",
      maxAge: 600,
    });
  });

  it("부를 때마다 다른 state를 만든다", () => {
    expect(issueState(writer(), "login")).not.toBe(issueState(writer(), "login"));
  });

  it("돌아온 state가 저장한 값과 같으면 용도를 돌려준다", () => {
    expect(verifyState("alarm.abc", "abc")).toBe("alarm");
    expect(verifyState("login.abc", "abc")).toBe("login");
  });

  it.each([
    ["값이 다르다", "login.abc", "abd"],
    ["길이가 다르다", "login.abc", "abcd"],
    ["돌아온 state가 없다", "login.abc", null],
    ["쿠키가 없다", undefined, "abc"],
    ["쿠키의 state가 비었다", "login.", "abc"],
    ["돌아온 state가 빈 문자열이다", "login.abc", ""],
    ["모르는 용도다", "admin.abc", "abc"],
  ])("%s면 null", (_, saved, received) => {
    expect(verifyState(saved, received)).toBeNull();
  });

  it("purposeOf는 쿠키 값에서 용도만 읽는다", () => {
    expect(purposeOf("alarm.x")).toBe("alarm");
    expect(purposeOf("other.x")).toBeNull();
    expect(purposeOf("login")).toBeNull();
    expect(purposeOf(undefined)).toBeNull();
  });

  it("지울 때도 같은 속성으로 maxAge 0을 준다", () => {
    const cookies = writer();

    clearState(cookies);

    expect(cookies.set).toHaveBeenCalledWith(OAUTH_STATE_COOKIE, "", {
      httpOnly: true,
      secure: false,
      sameSite: "lax",
      path: "/",
      maxAge: 0,
    });
  });
});

describe("authorizeUrl", () => {
  const config = {
    clientId: "client-id",
    redirectUri: "http://localhost:3000/oauth/kakao/callback",
  };

  it("로그인은 인가 코드만 요청한다", () => {
    const url = new URL(authorizeUrl(config, "st", "login"));

    expect(`${url.origin}${url.pathname}`).toBe("https://kauth.kakao.com/oauth/authorize");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      response_type: "code",
      client_id: "client-id",
      redirect_uri: "http://localhost:3000/oauth/kakao/callback",
      state: "st",
    });
  });

  it("알림은 카카오톡 메시지 동의(talk_message)를 함께 요청한다", () => {
    const url = new URL(authorizeUrl(config, "st", "alarm"));

    expect(url.searchParams.get("scope")).toBe("talk_message");
  });
});

describe("가입 토큰 · 문구 쿠키", () => {
  it("가입 토큰을 유효 시간(signup.expiresIn초) 동안 저장하고, 지울 때는 maxAge 0", () => {
    const cookies = writer();

    saveSignupToken(cookies, "Zm9v", 600);
    clearSignupToken(cookies);

    expect(cookies.set).toHaveBeenNthCalledWith(
      1,
      SOCIAL_SIGNUP_COOKIE,
      "Zm9v",
      expect.objectContaining({ httpOnly: true, path: "/", maxAge: 600 }),
    );
    expect(cookies.set).toHaveBeenNthCalledWith(
      2,
      SOCIAL_SIGNUP_COOKIE,
      "",
      expect.objectContaining({ httpOnly: true, path: "/", maxAge: 0 }),
    );
  });

  it("문구는 그 화면 것만 읽는다", () => {
    const cookies = writer();
    saveNotice(cookies, { target: "settings", text: "카카오 서버에 연결하지 못했어요." });
    const value = cookies.set.mock.calls[0][1] as string;

    expect(cookies.set.mock.calls[0][0]).toBe(NOTICE_COOKIE);
    expect(cookies.set.mock.calls[0][2]).toEqual(expect.objectContaining({ maxAge: 60 }));
    expect(readNotice(value, "settings")).toBe("카카오 서버에 연결하지 못했어요.");
    expect(readNotice(value, "login")).toBeNull();
  });

  it.each([
    ["없다", undefined],
    ["JSON이 아니다", "문구"],
    ["모양이 다르다", JSON.stringify({ target: "login", text: 1 })],
    ["null이다", "null"],
    ["target이 없다", JSON.stringify({ text: "x" })],
  ])("문구 쿠키가 %s면 null", (_, value) => {
    expect(readNotice(value, "login")).toBeNull();
  });

  it("문구를 지울 때도 같은 속성으로 maxAge 0", () => {
    const cookies = writer();

    clearNotice(cookies);

    expect(cookies.set).toHaveBeenCalledWith(
      NOTICE_COOKIE,
      "",
      expect.objectContaining({ httpOnly: true, path: "/", maxAge: 0 }),
    );
  });
});

describe("kakaoConfig 경계값", () => {
  it.each([
    [
      "앞뒤 공백 · 줄바꿈은 지운다",
      " http://localhost:3000/oauth/kakao/callback\r\n",
      "http://localhost:3000/oauth/kakao/callback",
    ],
    [
      "127.0.0.1은 http도 받는다",
      "http://127.0.0.1:3000/oauth/kakao/callback",
      "http://127.0.0.1:3000/oauth/kakao/callback",
    ],
    [
      "[::1]은 http도 받는다",
      "http://[::1]:3000/oauth/kakao/callback",
      "http://[::1]:3000/oauth/kakao/callback",
    ],
  ])("%s", (_, value, expected) => {
    vi.stubEnv("KAKAO_REDIRECT_URI", value);

    expect(kakaoConfig()?.redirectUri).toBe(expected);
  });

  it.each([
    ["끝에 / 가 붙었다", "https://hangguet.co.kr/oauth/kakao/callback/"],
    [
      "호스트에 대문자가 있다(등록 값과 글자가 다르다)",
      "https://Hangguet.co.kr/oauth/kakao/callback",
    ],
    ["기본 포트를 적었다", "https://hangguet.co.kr:443/oauth/kakao/callback"],
    ["공백뿐이다", "   "],
  ])("%s면 null", (_, value) => {
    vi.stubEnv("KAKAO_REDIRECT_URI", value);

    expect(kakaoConfig()).toBeNull();
  });

  it("앱 키의 앞뒤 공백 · 줄바꿈도 지운다", () => {
    vi.stubEnv("KAKAO_CLIENT_ID", "  client-id\n");

    expect(kakaoConfig()?.clientId).toBe("client-id");
  });

  it.each([
    ["앱 키가 공백뿐이다", "KAKAO_CLIENT_ID", "   "],
    ["앱 키 변수가 없다", "KAKAO_CLIENT_ID", undefined],
    ["콜백 주소 변수가 없다", "KAKAO_REDIRECT_URI", undefined],
  ])("%s면 null", (_, name, value) => {
    vi.stubEnv(name, value);

    expect(kakaoConfig()).toBeNull();
  });
});

describe("가입 토큰 유효 시간", () => {
  it.each([
    [600.9, 600],
    [-1, 0],
  ])("expiresIn %s초는 maxAge %s로 저장한다", (expiresIn, maxAge) => {
    const cookies = writer();

    saveSignupToken(cookies, "Zm9v", expiresIn);

    expect(cookies.set).toHaveBeenCalledWith(
      SOCIAL_SIGNUP_COOKIE,
      "Zm9v",
      expect.objectContaining({ maxAge }),
    );
  });
});

describe("운영 쿠키", () => {
  it("운영(NODE_ENV production)에서는 __Host- 이름 · Secure로 쓴다", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.resetModules();
    const prod = await import("./kakao");
    const cookies = writer();

    prod.issueState(cookies, "alarm");

    expect(prod.OAUTH_STATE_COOKIE).toBe("__Host-hk_oauth_state");
    expect(prod.SOCIAL_SIGNUP_COOKIE).toBe("__Host-hk_social_signup");
    expect(prod.NOTICE_COOKIE).toBe("__Host-hk_notice");
    const options = { httpOnly: true, secure: true, sameSite: "lax", path: "/" };
    expect(cookies.set).toHaveBeenCalledWith(
      "__Host-hk_oauth_state",
      expect.stringMatching(/^alarm\./),
      {
        ...options,
        maxAge: 600,
      },
    );

    // __Host- 쿠키는 Secure가 있는 Set-Cookie로만 지워진다: 지울 때도 같은 속성에 maxAge 0
    prod.clearState(cookies);
    prod.clearSignupToken(cookies);
    prod.clearNotice(cookies);
    expect(cookies.set).toHaveBeenCalledWith("__Host-hk_oauth_state", "", {
      ...options,
      maxAge: 0,
    });
    expect(cookies.set).toHaveBeenCalledWith("__Host-hk_social_signup", "", {
      ...options,
      maxAge: 0,
    });
    expect(cookies.set).toHaveBeenCalledWith("__Host-hk_notice", "", { ...options, maxAge: 0 });
  });
});
