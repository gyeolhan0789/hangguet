// @vitest-environment node
// 기준: Swagger 1.6 소셜 로그인 · 2.9 연습 알림 켜기(scope=talk_message) · 2.12 소셜 계정 연결 · 기획 메모 S01-3 · S09-1-B · 카카오 REST API '인가 코드 받기'
import { describe, expect, it, vi } from "vitest";

import {
  authorizeUrl,
  issueState,
  kakaoConfig,
  purposeOf,
  readLinked,
  readNotice,
  saveLinked,
  saveNotice,
  saveSignupToken,
  verifyState,
} from "./kakao";

type KakaoModule = typeof import("./kakao");

// 경계 mock: 쿠키를 쓰는 곳(cookies() · NextResponse.cookies)은 가짜 CookieWriter로, 설정은 환경 변수(vi.stubEnv)로 바꾼다
function cookieWriter() {
  return { set: vi.fn() };
}

/** 운영 쿠키 이름(__Host-)은 모듈을 불러올 때 정해지므로 NODE_ENV를 바꾼 뒤 새로 불러온다 */
async function loadInProduction(): Promise<KakaoModule> {
  vi.stubEnv("NODE_ENV", "production");
  vi.resetModules();
  return import("./kakao");
}

function kakaoEnv(clientId: string, redirectUri: string) {
  vi.stubEnv("KAKAO_CLIENT_ID", clientId);
  vi.stubEnv("KAKAO_REDIRECT_URI", redirectUri);
}

// 예시 데이터: 운영 콜백 주소(BE *_REDIRECT_URIS · 카카오 앱에 등록한 값과 같은 모양)
const CALLBACK = "https://hangguet.yobistory.com/oauth/kakao/callback";
const CONFIG = { clientId: "kakao-rest-key", redirectUri: CALLBACK };

describe("kakaoConfig · 카카오 앱 설정", () => {
  describe("정상 처리", () => {
    it("앱 키와 https 콜백 주소가 있으면 설정을 돌려준다", () => {
      kakaoEnv("kakao-rest-key", CALLBACK);

      expect(kakaoConfig()).toEqual(CONFIG);
    });

    it("앱 키 · 콜백 주소의 앞뒤 공백 · 줄바꿈을 지운다", () => {
      kakaoEnv("  kakao-rest-key\n", ` ${CALLBACK}\r\n`);

      expect(kakaoConfig()).toEqual(CONFIG);
    });

    it.each([
      { host: "localhost", redirectUri: "http://localhost:3000/oauth/kakao/callback" },
      { host: "[::1]", redirectUri: "http://[::1]:3000/oauth/kakao/callback" },
    ])("로컬 주소 '$host'는 http여도 받는다", ({ redirectUri }) => {
      kakaoEnv("kakao-rest-key", redirectUri);

      expect(kakaoConfig()).toEqual({ clientId: "kakao-rest-key", redirectUri });
    });
  });

  describe("입력 검증", () => {
    it.each([
      { label: "앱 키 없음", clientId: "", redirectUri: CALLBACK },
      { label: "콜백 없음", clientId: "kakao-rest-key", redirectUri: "" },
      { label: "주소 아님", clientId: "kakao-rest-key", redirectUri: "oauth/kakao/callback" },
      {
        label: "로컬 아닌 http",
        clientId: "kakao-rest-key",
        redirectUri: "http://hangguet.yobistory.com/oauth/kakao/callback",
      },
      {
        label: "다른 경로",
        clientId: "kakao-rest-key",
        redirectUri: "https://hangguet.yobistory.com/oauth/kakao/cb",
      },
      { label: "쿼리 붙음", clientId: "kakao-rest-key", redirectUri: `${CALLBACK}?next=/home` },
      { label: "해시 붙음", clientId: "kakao-rest-key", redirectUri: `${CALLBACK}#top` },
      {
        label: "계정 정보 붙음",
        clientId: "kakao-rest-key",
        redirectUri: "https://user:pw@hangguet.yobistory.com/oauth/kakao/callback",
      },
      {
        label: "정규화하면 달라짐(대문자 호스트)",
        clientId: "kakao-rest-key",
        redirectUri: "https://Hangguet.yobistory.com/oauth/kakao/callback",
      },
      {
        label: "정규화하면 달라짐(:443)",
        clientId: "kakao-rest-key",
        redirectUri: "https://hangguet.yobistory.com:443/oauth/kakao/callback",
      },
    ])("설정이 '$label'이면 쓰지 않고 null을 돌려준다", ({ clientId, redirectUri }) => {
      kakaoEnv(clientId, redirectUri);

      expect(kakaoConfig()).toBeNull();
    });
  });
});

describe("issueState · 인가 state 만들기", () => {
  describe("정상 처리", () => {
    it("새 state를 용도와 함께 쿠키에 담고 state를 돌려준다", () => {
      const writer = cookieWriter();

      const state = issueState(writer, "alarm");

      expect(writer.set).toHaveBeenCalledWith(
        "hk_oauth_state",
        `alarm.${state}`,
        expect.any(Object),
      );
    });

    it("운영이면 __Host- 이름과 Secure로 쓴다", async () => {
      const kakao = await loadInProduction();
      const writer = cookieWriter();

      const state = kakao.issueState(writer, "login");

      expect(writer.set).toHaveBeenCalledWith(
        "__Host-hk_oauth_state",
        `login.${state}`,
        expect.objectContaining({ secure: true, path: "/" }),
      );
    });
  });
});

describe("purposeOf · 저장한 용도 읽기", () => {
  describe("정상 처리", () => {
    it.each([{ purpose: "login" }, { purpose: "alarm" }, { purpose: "link" }])(
      "쿠키 값에서 용도 '$purpose'를 읽는다",
      ({ purpose }) => {
        expect(purposeOf(`${purpose}.state-1`)).toBe(purpose);
      },
    );
  });

  describe("입력 검증", () => {
    it.each([
      { label: "없음", saved: undefined },
      { label: "점 없음", saved: "login" },
      { label: "모르는 용도", saved: "admin.state-1" },
    ])("쿠키 값이 '$label'이면 null을 돌려준다", ({ saved }) => {
      expect(purposeOf(saved)).toBeNull();
    });
  });
});

describe("verifyState · state 확인", () => {
  describe("정상 처리", () => {
    it("돌아온 state가 저장한 값과 같으면 용도를 돌려준다", () => {
      expect(verifyState("link.state-abc", "state-abc")).toBe("link");
    });
  });

  describe("입력 검증", () => {
    it.each([
      { label: "같은 길이 다른 값", received: "state-abd" },
      { label: "길이가 다름", received: "state-ab" },
      { label: "돌아온 state 없음", received: null },
    ])("'$label'이면 null을 돌려준다", ({ received }) => {
      expect(verifyState("link.state-abc", received)).toBeNull();
    });
  });
});

describe("clearState · state 지우기", () => {
  describe("정상 처리", () => {
    it("운영이면 지울 때도 같은 __Host- 이름 · Secure에 유효 시간 0으로 덮어쓴다", async () => {
      const kakao = await loadInProduction();
      const writer = cookieWriter();

      kakao.clearState(writer);

      expect(writer.set).toHaveBeenCalledWith(
        "__Host-hk_oauth_state",
        "",
        expect.objectContaining({ secure: true, path: "/", maxAge: 0 }),
      );
    });
  });
});

describe("authorizeUrl · 카카오 인가 주소", () => {
  describe("정상 처리", () => {
    it("알림이면 메시지 동의(talk_message)를 함께 요청한다", () => {
      const url = new URL(authorizeUrl(CONFIG, "state-abc", "alarm"));

      expect(url.searchParams.get("scope")).toBe("talk_message");
    });

    it("로그인이면 동의 항목을 붙이지 않는다", () => {
      const url = new URL(authorizeUrl(CONFIG, "state-abc", "login"));

      expect(url.searchParams.has("scope")).toBe(false);
    });
  });
});

describe("saveSignupToken · 가입 토큰 저장", () => {
  describe("정상 처리", () => {
    it("가입 토큰을 받은 유효 시간(초) 동안 저장한다", () => {
      const writer = cookieWriter();

      saveSignupToken(writer, "signup-token-1", 600);

      expect(writer.set).toHaveBeenCalledWith(
        "hk_social_signup",
        "signup-token-1",
        expect.objectContaining({ maxAge: 600 }),
      );
    });
  });

  describe("경계값", () => {
    it.each([
      { label: "소수 599.9", expiresIn: 599.9, maxAge: 599 },
      { label: "음수", expiresIn: -5, maxAge: 0 },
    ])("유효 시간이 '$label'이면 쿠키 유효 시간을 '$maxAge'로 둔다", ({ expiresIn, maxAge }) => {
      const writer = cookieWriter();

      saveSignupToken(writer, "signup-token-1", expiresIn);

      expect(writer.set).toHaveBeenCalledWith(
        "hk_social_signup",
        "signup-token-1",
        expect.objectContaining({ maxAge }),
      );
    });
  });
});

describe("readNotice · 한 번 보여 줄 문구 읽기", () => {
  describe("정상 처리", () => {
    it("saveNotice로 담은 그 화면의 문구를 읽는다", () => {
      const writer = cookieWriter();
      saveNotice(writer, {
        target: "login",
        text: "소셜 로그인에 실패했어요. 다시 시도해 주세요.",
      });
      const saved = writer.set.mock.calls[0][1] as string;

      expect(readNotice(saved, "login")).toBe("소셜 로그인에 실패했어요. 다시 시도해 주세요.");
    });
  });

  describe("입력 검증", () => {
    it.each([
      { label: "없음", value: undefined, target: "login" },
      {
        label: "다른 화면 문구",
        value: JSON.stringify({ target: "settings", text: "문구" }),
        target: "login",
      },
      { label: "JSON 아님", value: "not-json", target: "login" },
      {
        label: "text가 문자열 아님",
        value: JSON.stringify({ target: "login", text: 1 }),
        target: "login",
      },
      {
        label: "계정 연결 완료 표시",
        value: JSON.stringify({ target: "settings", linked: true }),
        target: "settings",
      },
    ] as const)("쿠키 값이 '$label'이면 null을 돌려준다", ({ value, target }) => {
      expect(readNotice(value, target)).toBeNull();
    });
  });
});

describe("readLinked · 계정 연결 완료 표시 읽기", () => {
  describe("정상 처리", () => {
    it("saveLinked로 남긴 표시를 읽는다", () => {
      const writer = cookieWriter();
      saveLinked(writer);
      const saved = writer.set.mock.calls[0][1] as string;

      expect(readLinked(saved)).toBe(true);
    });
  });

  describe("입력 검증", () => {
    it.each([
      { label: "없음", value: undefined },
      { label: "문구 쿠키", value: JSON.stringify({ target: "settings", text: "문구" }) },
      { label: "JSON 아님", value: "not-json" },
      { label: "로그인 화면 표시", value: JSON.stringify({ target: "login", linked: true }) },
    ])("쿠키 값이 '$label'이면 false를 돌려준다", ({ value }) => {
      expect(readLinked(value)).toBe(false);
    });
  });
});
