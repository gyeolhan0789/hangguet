// @vitest-environment node
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";

import { axiosNoResponse, axiosProblem } from "@/test/axios-problem";
import { redirectTo } from "@/test/redirect";
import type {
  MeResponse,
  NicknameChangeResponse,
  NicknameRequest,
  PasswordChangeRequest,
  PracticeAlarmTimeRequest,
  ProblemDetail,
  ProfileImageUploadUrlRequest,
  StreakFreezeUseResponse,
  WithdrawRequest,
} from "@/types/api";

import type {
  NicknameValues,
  PasswordChangeValues,
  PracticeAlarmTimeValues,
  ProfileImageUploadValues,
  WithdrawValues,
} from "./schemas";

// HTTP 경계(api)와 Next 서버 함수(redirect · refresh · cookies)만 바꾼다. 입력 규칙 경계값은 schemas.test.ts가 맡는다.
const api = { patch: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() };
vi.mock("@/lib/api/client", () => ({ api }));

class RedirectSignal extends Error {}
const redirect = vi.fn((url: string) => {
  throw new RedirectSignal(`REDIRECT ${url}`);
});
vi.mock("next/navigation", () => ({
  redirect: (url: string) => redirect(url),
  unstable_rethrow: (error: unknown) => {
    if (error instanceof RedirectSignal) throw error;
  },
}));

const refresh = vi.fn();
vi.mock("next/cache", () => ({ refresh: () => refresh() }));

// has: 2.9 켜기 · 2.12 연결을 시작할 때 로그인했는지(액세스 토큰 쿠키) 본다
const cookieStore = { set: vi.fn(), delete: vi.fn(), has: vi.fn(() => true) };
vi.mock("next/headers", () => ({ cookies: async () => cookieStore }));

const {
  applyStreakFreeze,
  changeNickname,
  changePracticeAlarmTime,
  disablePracticeAlarm,
  startKakaoAlarm,
  startKakaoLink,
  unlinkKakao,
  withdrawSocial,
  changePassword,
  createProfileImageUploadUrl,
  deleteProfileImage,
  registerProfileImage,
  withdraw,
} = await import("./actions");

// Swagger 2.1 · 2.2 · 2.5 200 예시
const ME = {
  id: 1,
  email: "example@ssafy.com",
  nickname: "면접왕",
  socialProvider: null,
  linkedProvider: null,
  profileImageUrl: "https://…",
  createdAt: "2026-09-01T10:00:00+09:00",
  currentStreak: 7,
} satisfies MeResponse;

// 웹 Swagger 2.2 200 예시(내 정보 + 새 액세스 토큰)
const NICKNAME_CHANGED = {
  ...ME,
  accessToken: "eyJ…",
  expiresIn: 3600,
} satisfies NicknameChangeResponse;

// Swagger 2.3 · 2.7 400 예시
const PASSWORD_MISMATCH = {
  title: "Bad Request",
  status: 400,
  detail: "비밀번호가 맞지 않아요.",
  instance: "/api/v1/users/me/password",
  code: "PASSWORD_MISMATCH",
} satisfies ProblemDetail;

beforeEach(() => {
  vi.clearAllMocks();
  // 앞 테스트의 응답 설정(mockResolvedValue)이 다음 테스트로 새지 않게 API 모킹은 비운다.
  Object.values(api).forEach((fn) => fn.mockReset());
  cookieStore.has.mockReturnValue(true);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

// tsc(npm run typecheck)가 검사한다: 스키마나 Swagger 요청 타입 어느 쪽이 바뀌어도 여기서 컴파일 오류가 난다.
describe("스키마 값의 타입이 Swagger 요청 타입과 같다(탈퇴 폼은 더 좁다)", () => {
  it("2.2 · 2.3 · 2.4 · 2.7 · 2.10", () => {
    expectTypeOf<NicknameValues>().toEqualTypeOf<NicknameRequest>();
    expectTypeOf<PasswordChangeValues>().toEqualTypeOf<PasswordChangeRequest>();
    expectTypeOf<ProfileImageUploadValues>().toEqualTypeOf<ProfileImageUploadUrlRequest>();
    // 이메일 회원 탈퇴 폼은 비밀번호가 필수다(소셜 회원은 보내지 않아 요청 타입에서는 선택)
    expectTypeOf<WithdrawValues>().toExtend<WithdrawRequest>();
    expectTypeOf<PracticeAlarmTimeValues>().toEqualTypeOf<PracticeAlarmTimeRequest>();
  });
});

describe("changeNickname (2.2 닉네임 변경)", () => {
  it("앞뒤 공백을 지워 보내고, 헤더 · 화면이 새 닉네임을 다시 불러오도록 다시 그린다", async () => {
    api.patch.mockResolvedValue({ data: { ...NICKNAME_CHANGED, nickname: "새 닉네임" } });

    expect(await changeNickname({ nickname: "  새 닉네임 " })).toEqual({ ok: true });
    expect(api.patch).toHaveBeenCalledWith("/users/me", { nickname: "새 닉네임" });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("응답의 새 액세스 토큰만 쿠키에 저장하고 리프레시 토큰은 그대로 둔다", async () => {
    api.patch.mockResolvedValue({ data: NICKNAME_CHANGED });

    await changeNickname({ nickname: "새 닉네임" });

    expect(cookieStore.set).toHaveBeenCalledExactlyOnceWith(
      "hk_access",
      "eyJ…",
      expect.objectContaining({ httpOnly: true, maxAge: 3600 - 30 }),
    );
    expect(cookieStore.delete).not.toHaveBeenCalled();
  });

  it("규칙에 맞지 않으면 보내지 않고 닉네임 칸 오류(mock reason)를 돌려준다", async () => {
    expect(await changeNickname({ nickname: "   " })).toEqual({
      fieldErrors: { nickname: "필수 값입니다." },
    });
    expect(api.patch).not.toHaveBeenCalled();
  });

  it("서버가 칸 오류(VALIDATION_FAILED)를 주면 닉네임 칸에 보여 준다", async () => {
    // mock 서버 실제 응답(51자를 보냈을 때). Swagger 2.2에는 400 예시가 없다.
    api.patch.mockRejectedValue(
      axiosProblem({
        title: "Bad Request",
        status: 400,
        detail: "입력값을 확인해 주세요.",
        instance: "/api/v1/users/me",
        code: "VALIDATION_FAILED",
        errors: [{ field: "nickname", reason: "1~50자입니다." }],
      }),
    );

    expect(await changeNickname({ nickname: "면접왕" })).toEqual({
      fieldErrors: { nickname: "1~50자입니다." },
    });
    expect(refresh).not.toHaveBeenCalled();
  });

  it("api가 401로 재발급 · 로그아웃 화면에 보내면(redirect) 그대로 이동한다", async () => {
    const signedOut = new RedirectSignal("REDIRECT /login");
    api.patch.mockRejectedValue(signedOut);

    await expect(changeNickname({ nickname: "면접왕" })).rejects.toBe(signedOut);
  });
});

describe("changePassword (2.3 비밀번호 변경)", () => {
  const values = { currentPassword: "password1", newPassword: "newpass123" };

  it("지금 · 새 비밀번호를 보낸다", async () => {
    api.patch.mockResolvedValue({ data: undefined });

    expect(await changePassword(values)).toEqual({ ok: true });
    expect(api.patch).toHaveBeenCalledWith("/users/me/password", values);
  });

  it("지금 비밀번호가 틀리면(PASSWORD_MISMATCH) 지금 비밀번호 칸에 서버 문구를 돌려준다", async () => {
    api.patch.mockRejectedValue(axiosProblem(PASSWORD_MISMATCH));

    expect(await changePassword(values)).toEqual({
      fieldErrors: { currentPassword: PASSWORD_MISMATCH.detail },
    });
  });

  it("규칙에 맞지 않으면 보내지 않고 칸별 오류(mock reason)를 돌려준다", async () => {
    expect(await changePassword({ currentPassword: "  ", newPassword: "abc" })).toEqual({
      fieldErrors: {
        currentPassword: "필수 값입니다.",
        newPassword: "8~64자, 영문과 숫자를 모두 포함해야 합니다.",
      },
    });
    expect(api.patch).not.toHaveBeenCalled();
  });
});

describe("프로필 사진 (2.4 업로드 주소 · 2.5 등록 · 2.6 삭제)", () => {
  // Swagger 2.4 200 예시
  const upload = {
    uploadUrl: "https://…s3…?X-Amz-Signature=…",
    objectKey: "profile/1/7f3c….png",
    expiresAt: "2026-10-15T12:10:00+09:00",
  };

  it("2.4: 형식 · 크기를 보내고 업로드 주소를 돌려준다", async () => {
    api.post.mockResolvedValue({ data: upload });

    expect(await createProfileImageUploadUrl({ contentType: "image/png", size: 1000 })).toEqual({
      upload,
    });
    expect(api.post).toHaveBeenCalledWith("/users/me/profile-image/upload-url", {
      contentType: "image/png",
      size: 1000,
    });
  });

  it("2.4: 규칙에 맞지 않으면 보내지 않고 mock과 같은 문구를 돌려준다", async () => {
    expect(
      await createProfileImageUploadUrl({
        contentType: "image/gif",
        size: 1000,
      } as unknown as ProfileImageUploadValues),
    ).toEqual({ formError: "JPG·PNG만 올릴 수 있습니다." });
    expect(api.post).not.toHaveBeenCalled();
  });

  it("2.5: objectKey로 등록하고 다시 그린다", async () => {
    api.put.mockResolvedValue({ data: ME });

    expect(await registerProfileImage(upload.objectKey)).toEqual({ ok: true });
    expect(api.put).toHaveBeenCalledWith("/users/me/profile-image", {
      objectKey: upload.objectKey,
    });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("2.5: 올린 파일이 없으면(404 FILE_NOT_FOUND) 서버 문구를 돌려주고 다시 그리지 않는다", async () => {
    // Swagger 2.5 404 예시
    api.put.mockRejectedValue(
      axiosProblem({
        title: "Not Found",
        status: 404,
        detail: "업로드한 파일을 찾을 수 없어요.",
        instance: "/api/v1/users/me/profile-image",
        code: "FILE_NOT_FOUND",
      }),
    );

    expect(await registerProfileImage(upload.objectKey)).toEqual({
      formError: "업로드한 파일을 찾을 수 없어요.",
    });
    expect(refresh).not.toHaveBeenCalled();
  });

  it("2.6: 사진을 지우고 다시 그린다", async () => {
    api.delete.mockResolvedValue({ data: undefined });

    expect(await deleteProfileImage()).toEqual({ ok: true });
    expect(api.delete).toHaveBeenCalledWith("/users/me/profile-image");
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});

describe("withdraw (2.7 회원 탈퇴)", () => {
  it("비밀번호로 탈퇴하고, 두 토큰 쿠키를 지운 뒤 랜딩(S00)으로 보낸다", async () => {
    api.post.mockResolvedValue({ data: undefined });

    await expect(withdraw({ password: "password1" })).rejects.toThrow(RedirectSignal);
    expect(redirect).toHaveBeenCalledWith("/");
    expect(api.post).toHaveBeenCalledWith("/users/me", { password: "password1" });
    expect(cookieStore.delete).toHaveBeenCalledWith("hk_access");
    expect(cookieStore.delete).toHaveBeenCalledWith("hk_refresh");
  });

  it("비밀번호가 틀리면(PASSWORD_MISMATCH) 비밀번호 칸에 서버 문구를 돌려주고 쿠키를 지우지 않는다", async () => {
    api.post.mockRejectedValue(axiosProblem(PASSWORD_MISMATCH));

    expect(await withdraw({ password: "wrong" })).toEqual({
      fieldErrors: { password: PASSWORD_MISMATCH.detail },
    });
    expect(cookieStore.delete).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  });

  it("비밀번호를 비우면 보내지 않는다", async () => {
    expect(await withdraw({ password: " " })).toEqual({
      fieldErrors: { password: "필수 값입니다." },
    });
    expect(api.post).not.toHaveBeenCalled();
  });
});

describe("applyStreakFreeze (8.14 유지권 사용)", () => {
  // Swagger 8.14 200 · 409 예시
  const USED = {
    practiceDate: "2026-10-19",
    freezeId: 31,
    availableCount: 1,
    currentStreak: 9,
  } satisfies StreakFreezeUseResponse;
  const DATE_NOT_ALLOWED = {
    title: "Conflict",
    status: 409,
    detail: "이미 연습한 날이라 메울 수 없어요.",
    instance: "/api/v1/users/me/streak-freezes/use",
    code: "STREAK_FREEZE_DATE_NOT_ALLOWED",
  } satisfies ProblemDetail;

  it("유지권 id를 보내 메우고, 스트릭 · 달력 · 유지권 박스가 바뀌도록 다시 그린다", async () => {
    api.post.mockResolvedValue({ data: USED });

    expect(await applyStreakFreeze(31)).toEqual({ used: USED });
    expect(api.post).toHaveBeenCalledWith("/users/me/streak-freezes/use", { freezeId: 31 });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("이미 연습한 날(409)이면 서버 문구를 돌려주고, 박스가 서버 상태와 같아지도록 다시 그린다", async () => {
    api.post.mockRejectedValue(axiosProblem(DATE_NOT_ALLOWED));

    expect(await applyStreakFreeze(31)).toEqual({ error: DATE_NOT_ALLOWED.detail });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("서버에 닿지 못하면 다시 시도 안내를 돌려주고 다시 그리지 않는다", async () => {
    api.post.mockRejectedValue(axiosNoResponse());

    expect(await applyStreakFreeze(31)).toEqual({ error: "잠시 후 다시 시도해 주세요." });
    expect(refresh).not.toHaveBeenCalled();
  });

  it("유지권 id가 1 이상의 정수가 아니면 보내지 않는다", async () => {
    for (const id of [0, -1, 2.5]) {
      expect(await applyStreakFreeze(id)).toEqual({ error: "잠시 후 다시 시도해 주세요." });
    }
    expect(api.post).not.toHaveBeenCalled();
  });
});

describe("withdrawSocial (2.7 회원 탈퇴 · 소셜 회원)", () => {
  it("비밀번호 없이 탈퇴하고 쿠키를 지운 뒤 첫 화면으로 보낸다", async () => {
    api.post.mockResolvedValue({ data: undefined });

    await expect(withdrawSocial()).rejects.toThrow(redirectTo("/"));

    expect(api.post).toHaveBeenCalledWith("/users/me", {});
    expect(cookieStore.delete).toHaveBeenCalledWith("hk_access");
    expect(cookieStore.delete).toHaveBeenCalledWith("hk_refresh");
  });

  it("실패하면 서버 문구를 돌려주고 쿠키는 그대로 둔다", async () => {
    api.post.mockRejectedValue(
      axiosProblem({
        title: "Internal Server Error",
        status: 500,
        detail: "탈퇴를 처리하지 못했어요.",
        instance: "/api/v1/users/me",
        code: "INTERNAL_ERROR",
      }),
    );

    expect(await withdrawSocial()).toEqual({ formError: "탈퇴를 처리하지 못했어요." });
    expect(cookieStore.delete).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  });

  it("서버에 닿지 못하면 다시 시도 안내", async () => {
    api.post.mockRejectedValue(axiosNoResponse());

    expect(await withdrawSocial()).toEqual({ formError: "잠시 후 다시 시도해 주세요." });
    expect(redirect).not.toHaveBeenCalled();
  });
});

describe("startKakaoAlarm (2.9 연습 알림 켜기 시작)", () => {
  it("state를 쿠키에 담고 카카오 메시지 동의(talk_message) 화면으로 보낸다", async () => {
    vi.stubEnv("KAKAO_CLIENT_ID", "client-id");
    vi.stubEnv("KAKAO_REDIRECT_URI", "http://localhost:3000/oauth/kakao/callback");

    await expect(startKakaoAlarm()).rejects.toThrow(/^REDIRECT https:\/\/kauth\.kakao\.com\//);

    const url = new URL(redirect.mock.calls[0][0]);
    expect(url.searchParams.get("scope")).toBe("talk_message");
    expect(url.searchParams.get("client_id")).toBe("client-id");
    expect(url.searchParams.get("redirect_uri")).toBe("http://localhost:3000/oauth/kakao/callback");
    expect(cookieStore.has).toHaveBeenCalledWith("hk_access");
    expect(cookieStore.set).toHaveBeenCalledWith(
      "hk_oauth_state",
      `alarm.${url.searchParams.get("state")}`,
      expect.objectContaining({ httpOnly: true, maxAge: 600 }),
    );
  });

  it("로그인하지 않았으면 동의 화면 대신 로그인 화면으로", async () => {
    vi.stubEnv("KAKAO_CLIENT_ID", "client-id");
    vi.stubEnv("KAKAO_REDIRECT_URI", "http://localhost:3000/oauth/kakao/callback");
    cookieStore.has.mockReturnValue(false);

    await expect(startKakaoAlarm()).rejects.toThrow(redirectTo("/login"));
    expect(cookieStore.set).not.toHaveBeenCalled();
  });

  it("카카오 설정이 없으면 이동하지 않고 KAKAO_UNAVAILABLE 문구", async () => {
    vi.stubEnv("KAKAO_CLIENT_ID", "");

    expect(await startKakaoAlarm()).toEqual({
      error: "카카오 서버에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.",
    });
    expect(redirect).not.toHaveBeenCalled();
    expect(cookieStore.set).not.toHaveBeenCalled();
  });
});

describe("disablePracticeAlarm (2.11 연습 알림 끄기)", () => {
  it("끄고 화면을 다시 그린다", async () => {
    api.delete.mockResolvedValue({ data: undefined });

    expect(await disablePracticeAlarm()).toEqual({});
    expect(api.delete).toHaveBeenCalledWith("/users/me/practice-alarm");
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("서버가 거절하면 서버 문구, 다시 그리지 않는다", async () => {
    api.delete.mockRejectedValue(
      axiosProblem({
        title: "Internal Server Error",
        status: 500,
        detail: "알림을 끄지 못했어요.",
        instance: "/api/v1/users/me/practice-alarm",
        code: "INTERNAL_ERROR",
      }),
    );

    expect(await disablePracticeAlarm()).toEqual({ error: "알림을 끄지 못했어요." });
    expect(refresh).not.toHaveBeenCalled();
  });

  it("서버에 닿지 못하면 다시 시도 안내, 다시 그리지 않는다", async () => {
    api.delete.mockRejectedValue(axiosNoResponse());

    expect(await disablePracticeAlarm()).toEqual({ error: "잠시 후 다시 시도해 주세요." });
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("changePracticeAlarmTime (2.10 연습 알림 시각 변경)", () => {
  it("HH:mm을 보내고 화면을 다시 그린다", async () => {
    api.patch.mockResolvedValue({ data: { available: true, enabled: false, time: "22:30" } });

    expect(await changePracticeAlarmTime({ time: "22:30" })).toEqual({});
    expect(api.patch).toHaveBeenCalledWith("/users/me/practice-alarm", { time: "22:30" });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("서버에 닿지 못하면 다시 시도 안내", async () => {
    api.patch.mockRejectedValue(axiosNoResponse());

    expect(await changePracticeAlarmTime({ time: "22:30" })).toEqual({
      error: "잠시 후 다시 시도해 주세요.",
    });
    expect(refresh).not.toHaveBeenCalled();
  });

  it("형식이 틀리면 보내지 않는다", async () => {
    expect(await changePracticeAlarmTime({ time: "24:00" })).toEqual({
      error: "HH:mm 형식(00:00~23:59)입니다.",
    });
    expect(api.patch).not.toHaveBeenCalled();
  });

  it("409 PRACTICE_ALARM_UNAVAILABLE이면 서버 문구", async () => {
    api.patch.mockRejectedValue(
      axiosProblem({
        title: "Conflict",
        status: 409,
        detail: "카카오 계정을 연결한 회원만 연습 알림을 받을 수 있어요.",
        instance: "/api/v1/users/me/practice-alarm",
        code: "PRACTICE_ALARM_UNAVAILABLE",
      }),
    );

    expect(await changePracticeAlarmTime({ time: "22:30" })).toEqual({
      error: "카카오 계정을 연결한 회원만 연습 알림을 받을 수 있어요.",
    });
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("startKakaoLink (2.12 카카오 계정 연결 시작)", () => {
  it("state를 연결 용도로 쿠키에 담고, 동의 항목 없이 카카오 동의 화면으로 보낸다", async () => {
    vi.stubEnv("KAKAO_CLIENT_ID", "client-id");
    vi.stubEnv("KAKAO_REDIRECT_URI", "http://localhost:3000/oauth/kakao/callback");

    await expect(startKakaoLink()).rejects.toThrow(/^REDIRECT https:\/\/kauth\.kakao\.com\//);

    const url = new URL(redirect.mock.calls[0][0]);
    expect(url.searchParams.get("scope")).toBeNull();
    expect(url.searchParams.get("client_id")).toBe("client-id");
    expect(url.searchParams.get("redirect_uri")).toBe("http://localhost:3000/oauth/kakao/callback");
    expect(cookieStore.has).toHaveBeenCalledWith("hk_access");
    expect(cookieStore.set).toHaveBeenCalledWith(
      "hk_oauth_state",
      `link.${url.searchParams.get("state")}`,
      expect.objectContaining({ httpOnly: true, maxAge: 600 }),
    );
  });

  it("로그인하지 않았으면 동의 화면 대신 로그인 화면으로", async () => {
    vi.stubEnv("KAKAO_CLIENT_ID", "client-id");
    vi.stubEnv("KAKAO_REDIRECT_URI", "http://localhost:3000/oauth/kakao/callback");
    cookieStore.has.mockReturnValue(false);

    await expect(startKakaoLink()).rejects.toThrow(redirectTo("/login"));
    expect(cookieStore.set).not.toHaveBeenCalled();
  });

  it("카카오 설정이 없으면 이동하지 않고 2.12 503과 같은 문구", async () => {
    vi.stubEnv("KAKAO_CLIENT_ID", "");

    expect(await startKakaoLink()).toEqual({
      error: "소셜 로그인 서버에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.",
    });
    expect(redirect).not.toHaveBeenCalled();
    expect(cookieStore.set).not.toHaveBeenCalled();
  });
});

describe("unlinkKakao (2.13 카카오 연결 해제)", () => {
  it("해제하고 화면을 다시 그린다(2.1 linkedProvider · 2.8 알림이 바뀐다)", async () => {
    api.delete.mockResolvedValue({ data: undefined });

    expect(await unlinkKakao()).toEqual({});
    expect(api.delete).toHaveBeenCalledWith("/users/me/social-accounts/kakao");
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("소셜 회원이라 거절하면(409 PASSWORD_NOT_SET) 서버 문구, 다시 그리지 않는다", async () => {
    api.delete.mockRejectedValue(
      axiosProblem({
        title: "Conflict",
        status: 409,
        detail: "소셜 로그인 회원은 비밀번호가 없어요.",
        instance: "/api/v1/users/me/password",
        code: "PASSWORD_NOT_SET",
      }),
    );

    expect(await unlinkKakao()).toEqual({ error: "소셜 로그인 회원은 비밀번호가 없어요." });
    expect(refresh).not.toHaveBeenCalled();
  });

  it("서버에 닿지 못하면 다시 시도 안내, 다시 그리지 않는다", async () => {
    api.delete.mockRejectedValue(axiosNoResponse());

    expect(await unlinkKakao()).toEqual({ error: "잠시 후 다시 시도해 주세요." });
    expect(refresh).not.toHaveBeenCalled();
  });

  it("토큰이 없어 로그인 화면으로 보내지면(api 인터셉터의 redirect) 문구로 삼키지 않고 그대로 이동한다", async () => {
    const signedOut = new RedirectSignal("REDIRECT /login");
    api.delete.mockRejectedValue(signedOut);

    await expect(unlinkKakao()).rejects.toBe(signedOut);
    expect(refresh).not.toHaveBeenCalled();
  });
});
