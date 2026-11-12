// @vitest-environment node
// 기준: Swagger 2.2 닉네임 변경 · 2.3 비밀번호 변경(400 PASSWORD_MISMATCH) · 2.4 프로필 사진 업로드 주소 · 2.5 등록(404 FILE_NOT_FOUND)
// · 2.6 삭제 · 2.7 회원 탈퇴(400 PASSWORD_MISMATCH · 409 INTERVIEW_IN_PROGRESS) · 2.9 알림 켜기 · 2.10 시각 변경(409 PRACTICE_ALARM_UNAVAILABLE)
// · 2.11 끄기 · 2.12 계정 연결 · 2.13 연결 해제(409 PASSWORD_NOT_SET) · 8.14 유지권 사용(409 STREAK_FREEZE_DATE_NOT_ALLOWED) · 기획 메모 S09-1 · S09-1-B · S09-2
import { describe, expect, it, vi } from "vitest";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";

import { ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE } from "@/lib/api/auth-cookies";
import { RETRY_LATER } from "@/lib/api/problem-detail";
import {
  KAKAO_UNAVAILABLE,
  OAUTH_STATE_COOKIE,
  SOCIAL_LOGIN_UNAVAILABLE,
  verifyState,
} from "@/lib/auth/kakao";
import { axiosNoResponse, axiosProblem } from "@/test/axios-problem";
import { cookieValue, setCookie } from "@/test/next-headers";
import { RedirectError } from "@/test/next-navigation";
import { redirectTo } from "@/test/redirect";
import type {
  MeResponse,
  NicknameChangeResponse,
  StreakFreezeUseResponse,
  UploadUrlResponse,
} from "@/types/api";

import {
  applyStreakFreeze,
  changeNickname,
  changePassword,
  changePracticeAlarmTime,
  createProfileImageUploadUrl,
  deleteProfileImage,
  disablePracticeAlarm,
  registerProfileImage,
  startKakaoAlarm,
  startKakaoLink,
  unlinkKakao,
  withdraw,
  withdrawSocial,
} from "./actions";

// 경계 mock: HTTP(api)와 Next 런타임(쿠키 · redirect · unstable_rethrow · refresh)
const api = vi.hoisted(() => ({ patch: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() }));
vi.mock("@/lib/api/client", () => ({ api }));
vi.mock("next/navigation", () => import("@/test/next-navigation"));
vi.mock("next/headers", () => import("@/test/next-headers"));
vi.mock("next/cache", () => import("@/test/next-cache"));

// 예시 데이터: Swagger 2.1 · 2.2 200 예시(내 정보 + 새 액세스 토큰)
const ME: MeResponse = {
  id: 1,
  email: "example@ssafy.com",
  nickname: "면접왕",
  socialProvider: null,
  linkedProvider: null,
  profileImageUrl: "https://…",
  createdAt: "2026-09-01T10:00:00+09:00",
  currentStreak: 7,
};
const NICKNAME_CHANGED: NicknameChangeResponse = {
  ...ME,
  nickname: "새 닉네임",
  accessToken: "eyJ…new",
  expiresIn: 3600,
};
// 예시 데이터: Swagger 2.4 200 예시
const UPLOAD: UploadUrlResponse = {
  uploadUrl: "https://…s3…?X-Amz-Signature=…",
  objectKey: "profile/1/7f3c….png",
  expiresAt: "2026-10-15T12:10:00+09:00",
};
// 예시 데이터: Swagger 8.14 200 예시
const USED: StreakFreezeUseResponse = {
  practiceDate: "2026-10-19",
  freezeId: 31,
  availableCount: 1,
  currentStreak: 9,
};
// 예시 데이터: Swagger 2.3 · 2.5 · 2.7 · 2.10 · 2.13 · 8.14 오류 예시와 공통 500 예시
const PASSWORD_MISMATCH = {
  title: "Bad Request",
  status: 400,
  detail: "비밀번호가 맞지 않아요.",
  instance: "/api/v1/users/me/password",
  code: "PASSWORD_MISMATCH",
};
const FILE_NOT_FOUND = {
  title: "Not Found",
  status: 404,
  detail: "업로드한 파일을 찾을 수 없어요.",
  instance: "/api/v1/users/me/profile-image",
  code: "FILE_NOT_FOUND",
};
const INTERVIEW_IN_PROGRESS = {
  title: "Conflict",
  status: 409,
  detail: "진행 중인 면접을 끝낸 뒤 탈퇴할 수 있어요.",
  instance: "/api/v1/users/me",
  code: "INTERVIEW_IN_PROGRESS",
};
const PRACTICE_ALARM_UNAVAILABLE = {
  title: "Conflict",
  status: 409,
  detail: "카카오 계정을 연결한 회원만 연습 알림을 받을 수 있어요.",
  instance: "/api/v1/users/me/practice-alarm",
  code: "PRACTICE_ALARM_UNAVAILABLE",
};
const DATE_NOT_ALLOWED = {
  title: "Conflict",
  status: 409,
  detail: "이미 연습한 날이라 메울 수 없어요.",
  instance: "/api/v1/users/me/streak-freezes/use",
  code: "STREAK_FREEZE_DATE_NOT_ALLOWED",
};
// 공통 500 예시의 detail은 RETRY_LATER와 글자가 같아 서버 문구 경로를 구별하지 못하므로 detail만 바꿨다
const INTERNAL_ERROR = {
  title: "Internal Server Error",
  status: 500,
  detail: "요청을 처리하지 못했어요.",
  instance: "/api/v1/users/me",
  code: "INTERNAL_ERROR",
};
const PASSWORD_NOT_SET = {
  title: "Conflict",
  status: 409,
  detail: "소셜 로그인 회원은 비밀번호가 없어요.",
  instance: "/api/v1/users/me/social-accounts/kakao",
  code: "PASSWORD_NOT_SET",
};
const NEW_PASSWORD = "newpass123";

/** 로그인한 회원의 두 토큰 쿠키를 넣어 둔다 */
function signIn() {
  setCookie(ACCESS_TOKEN_COOKIE, "access-1");
  setCookie(REFRESH_TOKEN_COOKIE, "refresh-1");
}

/** 카카오 앱 설정(환경 변수)을 넣는다 */
function kakaoEnv() {
  vi.stubEnv("KAKAO_CLIENT_ID", "kakao-rest-key");
  vi.stubEnv("KAKAO_REDIRECT_URI", "http://localhost:3000/oauth/kakao/callback");
}

/** 마지막 redirect 주소의 state 파라미터 */
function sentState() {
  return new URL(vi.mocked(redirect).mock.calls[0][0]).searchParams.get("state");
}

describe("changeNickname · 닉네임 변경", () => {
  describe("정상 처리", () => {
    it("바꾸면 ok를 돌려주고 응답의 새 액세스 토큰만 쿠키에 담은 뒤 화면을 다시 그린다", async () => {
      signIn();
      api.patch.mockResolvedValue({ data: NICKNAME_CHANGED });

      expect(await changeNickname({ nickname: "새 닉네임" })).toEqual({ ok: true });
      expect(cookieValue(ACCESS_TOKEN_COOKIE)).toBe("eyJ…new");
      expect(cookieValue(REFRESH_TOKEN_COOKIE)).toBe("refresh-1");
      expect(refresh).toHaveBeenCalledTimes(1);
    });
  });

  describe("입력 검증", () => {
    it("닉네임이 공백뿐이면 요청하지 않고 닉네임 칸 오류를 돌려준다", async () => {
      expect(await changeNickname({ nickname: "   " })).toEqual({
        fieldErrors: { nickname: "필수 값입니다." },
      });
      expect(api.patch).not.toHaveBeenCalled();
    });
  });

  describe("오류 처리", () => {
    it("서버 문구가 있는 실패면 폼 오류로 돌려주고 쿠키 · 화면을 바꾸지 않는다", async () => {
      signIn();
      api.patch.mockRejectedValue(axiosProblem(INTERNAL_ERROR));

      expect(await changeNickname({ nickname: "새 닉네임" })).toEqual({
        formError: "요청을 처리하지 못했어요.",
      });
      expect(cookieValue(ACCESS_TOKEN_COOKIE)).toBe("access-1");
      expect(refresh).not.toHaveBeenCalled();
    });
  });

  describe("권한 · 로그인", () => {
    it("이동해야 하면 그 이동을 그대로 던진다", async () => {
      const moveToRefresh = new RedirectError("/api/auth/refresh");
      api.patch.mockRejectedValue(moveToRefresh);

      await expect(changeNickname({ nickname: "새 닉네임" })).rejects.toBe(moveToRefresh);
    });
  });
});

describe("changePassword · 비밀번호 변경", () => {
  describe("정상 처리", () => {
    it("바꾸면 ok를 돌려준다", async () => {
      api.patch.mockResolvedValue({ status: 204 });

      expect(
        await changePassword({ currentPassword: "password123", newPassword: NEW_PASSWORD }),
      ).toEqual({ ok: true });
    });
  });

  describe("입력 검증", () => {
    it("지금 비밀번호가 공백뿐이면 요청하지 않고 지금 비밀번호 칸 오류를 돌려준다", async () => {
      expect(await changePassword({ currentPassword: "   ", newPassword: NEW_PASSWORD })).toEqual({
        fieldErrors: { currentPassword: "필수 값입니다." },
      });
      expect(api.patch).not.toHaveBeenCalled();
    });
  });

  describe("오류 처리", () => {
    it("지금 비밀번호가 틀리면(PASSWORD_MISMATCH) 지금 비밀번호 칸에 서버 문구를 돌려준다", async () => {
      api.patch.mockRejectedValue(axiosProblem(PASSWORD_MISMATCH));

      expect(
        await changePassword({ currentPassword: "wrong123", newPassword: NEW_PASSWORD }),
      ).toEqual({ fieldErrors: { currentPassword: "비밀번호가 맞지 않아요." } });
    });

    it("서버 문구가 있는 그 밖의 실패면 폼 오류로 돌려준다", async () => {
      api.patch.mockRejectedValue(axiosProblem(INTERNAL_ERROR));

      expect(
        await changePassword({ currentPassword: "password123", newPassword: NEW_PASSWORD }),
      ).toEqual({ formError: "요청을 처리하지 못했어요." });
    });
  });

  describe("권한 · 로그인", () => {
    it("이동해야 하면 그 이동을 그대로 던진다", async () => {
      const moveToRefresh = new RedirectError("/api/auth/refresh");
      api.patch.mockRejectedValue(moveToRefresh);

      await expect(
        changePassword({ currentPassword: "password123", newPassword: NEW_PASSWORD }),
      ).rejects.toBe(moveToRefresh);
    });
  });
});

describe("createProfileImageUploadUrl · 프로필 사진 업로드 주소", () => {
  const PNG = { contentType: "image/png", size: 1024 } as const;

  describe("정상 처리", () => {
    it("주소를 받으면 그 주소를 돌려준다", async () => {
      api.post.mockResolvedValue({ data: UPLOAD });

      expect(await createProfileImageUploadUrl(PNG)).toEqual({ upload: UPLOAD });
    });
  });

  describe("입력 검증", () => {
    it("사진이 GIF면 요청하지 않고 형식 문구를 돌려준다", async () => {
      expect(
        await createProfileImageUploadUrl({
          contentType: "image/gif" as "image/png",
          size: 1024,
        }),
      ).toEqual({ formError: "JPG·PNG만 올릴 수 있습니다." });
      expect(api.post).not.toHaveBeenCalled();
    });
  });

  describe("오류 처리", () => {
    it("서버 문구만 있는 실패면 그 문구를 돌려준다", async () => {
      api.post.mockRejectedValue(axiosProblem(INTERNAL_ERROR));

      expect(await createProfileImageUploadUrl(PNG)).toEqual({
        formError: "요청을 처리하지 못했어요.",
      });
    });

    it("서버에 닿지 못하면 다시 시도 안내를 돌려준다", async () => {
      api.post.mockRejectedValue(axiosNoResponse());

      expect(await createProfileImageUploadUrl(PNG)).toEqual({ formError: RETRY_LATER });
    });
  });

  describe("권한 · 로그인", () => {
    it("이동해야 하면 그 이동을 그대로 던진다", async () => {
      const moveToRefresh = new RedirectError("/api/auth/refresh");
      api.post.mockRejectedValue(moveToRefresh);

      await expect(createProfileImageUploadUrl(PNG)).rejects.toBe(moveToRefresh);
    });
  });
});

describe("registerProfileImage · 프로필 사진 등록", () => {
  describe("정상 처리", () => {
    it("등록하면 ok를 돌려주고 화면을 다시 그린다", async () => {
      api.put.mockResolvedValue({ data: ME });

      expect(await registerProfileImage(UPLOAD.objectKey)).toEqual({ ok: true });
      expect(refresh).toHaveBeenCalledTimes(1);
    });
  });

  describe("입력 검증", () => {
    it("올린 파일 키가 공백뿐이면 요청하지 않고 다시 시도 안내를 돌려준다", async () => {
      expect(await registerProfileImage("   ")).toEqual({ formError: RETRY_LATER });
      expect(api.put).not.toHaveBeenCalled();
    });
  });

  describe("오류 처리", () => {
    it("올린 파일이 없으면(404 FILE_NOT_FOUND) 서버 문구를 돌려주고 화면을 다시 그리지 않는다", async () => {
      api.put.mockRejectedValue(axiosProblem(FILE_NOT_FOUND));

      expect(await registerProfileImage(UPLOAD.objectKey)).toEqual({
        formError: "업로드한 파일을 찾을 수 없어요.",
      });
      expect(refresh).not.toHaveBeenCalled();
    });
  });

  describe("권한 · 로그인", () => {
    it("이동해야 하면 그 이동을 그대로 던진다", async () => {
      const moveToRefresh = new RedirectError("/api/auth/refresh");
      api.put.mockRejectedValue(moveToRefresh);

      await expect(registerProfileImage(UPLOAD.objectKey)).rejects.toBe(moveToRefresh);
    });
  });
});

describe("deleteProfileImage · 프로필 사진 삭제", () => {
  describe("정상 처리", () => {
    it("지우면 오류 없이 화면을 다시 그린다", async () => {
      api.delete.mockResolvedValue({ status: 204 });

      expect((await deleteProfileImage()).formError).toBeUndefined();
      expect(refresh).toHaveBeenCalledTimes(1);
    });
  });

  describe("오류 처리", () => {
    it("서버에 닿지 못하면 다시 시도 안내를 돌려주고 화면을 다시 그리지 않는다", async () => {
      api.delete.mockRejectedValue(axiosNoResponse());

      expect(await deleteProfileImage()).toEqual({ formError: RETRY_LATER });
      expect(refresh).not.toHaveBeenCalled();
    });
  });

  describe("권한 · 로그인", () => {
    it("이동해야 하면 그 이동을 그대로 던진다", async () => {
      const moveToRefresh = new RedirectError("/api/auth/refresh");
      api.delete.mockRejectedValue(moveToRefresh);

      await expect(deleteProfileImage()).rejects.toBe(moveToRefresh);
    });
  });
});

describe("withdraw · 회원 탈퇴(이메일 회원)", () => {
  describe("정상 처리", () => {
    it("탈퇴하면 두 토큰 쿠키를 지우고 랜딩으로 보낸다", async () => {
      signIn();
      api.post.mockResolvedValue({ status: 204 });

      await expect(withdraw({ password: "password123" })).rejects.toThrow(redirectTo("/"));
      expect(cookieValue(ACCESS_TOKEN_COOKIE)).toBeUndefined();
      expect(cookieValue(REFRESH_TOKEN_COOKIE)).toBeUndefined();
    });
  });

  describe("입력 검증", () => {
    it("비밀번호가 공백뿐이면 요청하지 않고 비밀번호 칸 오류를 돌려준다", async () => {
      expect(await withdraw({ password: "   " })).toEqual({
        fieldErrors: { password: "필수 값입니다." },
      });
      expect(api.post).not.toHaveBeenCalled();
    });
  });

  describe("오류 처리", () => {
    it("비밀번호가 틀리면(PASSWORD_MISMATCH) 비밀번호 칸에 서버 문구를 돌려주고 쿠키를 지우지 않는다", async () => {
      signIn();
      api.post.mockRejectedValue(
        axiosProblem({ ...PASSWORD_MISMATCH, instance: "/api/v1/users/me" }),
      );

      expect(await withdraw({ password: "wrong123" })).toEqual({
        fieldErrors: { password: "비밀번호가 맞지 않아요." },
      });
      expect(cookieValue(ACCESS_TOKEN_COOKIE)).toBe("access-1");
      expect(cookieValue(REFRESH_TOKEN_COOKIE)).toBe("refresh-1");
    });

    it("진행 중인 면접이 있으면(409 INTERVIEW_IN_PROGRESS) 폼 오류로 서버 문구를 돌려주고 쿠키를 지우지 않는다", async () => {
      signIn();
      api.post.mockRejectedValue(axiosProblem(INTERVIEW_IN_PROGRESS));

      expect(await withdraw({ password: "password123" })).toEqual({
        formError: "진행 중인 면접을 끝낸 뒤 탈퇴할 수 있어요.",
      });
      expect(cookieValue(ACCESS_TOKEN_COOKIE)).toBe("access-1");
      expect(cookieValue(REFRESH_TOKEN_COOKIE)).toBe("refresh-1");
    });
  });

  describe("권한 · 로그인", () => {
    it("이동해야 하면 그 이동을 그대로 던진다", async () => {
      const moveToRefresh = new RedirectError("/api/auth/refresh");
      api.post.mockRejectedValue(moveToRefresh);

      await expect(withdraw({ password: "password123" })).rejects.toBe(moveToRefresh);
    });
  });
});

describe("withdrawSocial · 회원 탈퇴(소셜 회원)", () => {
  describe("정상 처리", () => {
    it("탈퇴하면 두 토큰 쿠키를 지우고 랜딩으로 보낸다", async () => {
      signIn();
      api.post.mockResolvedValue({ status: 204 });

      await expect(withdrawSocial()).rejects.toThrow(redirectTo("/"));
      expect(cookieValue(ACCESS_TOKEN_COOKIE)).toBeUndefined();
      expect(cookieValue(REFRESH_TOKEN_COOKIE)).toBeUndefined();
    });
  });

  describe("오류 처리", () => {
    it("서버 문구가 있는 실패면 폼 오류로 돌려주고 쿠키를 지우지 않는다", async () => {
      signIn();
      api.post.mockRejectedValue(axiosProblem(INTERVIEW_IN_PROGRESS));

      expect(await withdrawSocial()).toEqual({
        formError: "진행 중인 면접을 끝낸 뒤 탈퇴할 수 있어요.",
      });
      expect(cookieValue(ACCESS_TOKEN_COOKIE)).toBe("access-1");
      expect(cookieValue(REFRESH_TOKEN_COOKIE)).toBe("refresh-1");
    });
  });

  describe("권한 · 로그인", () => {
    it("이동해야 하면 그 이동을 그대로 던진다", async () => {
      const moveToRefresh = new RedirectError("/api/auth/refresh");
      api.post.mockRejectedValue(moveToRefresh);

      await expect(withdrawSocial()).rejects.toBe(moveToRefresh);
    });
  });
});

describe("startKakaoAlarm · 연습 알림 켜기 시작", () => {
  describe("정상 처리", () => {
    it("알림 용도로 기록한 state를 담은 카카오 동의 주소로 보낸다", async () => {
      signIn();
      kakaoEnv();

      await expect(startKakaoAlarm()).rejects.toThrow(/^REDIRECT https:\/\/kauth\.kakao\.com\//);
      expect(verifyState(cookieValue(OAUTH_STATE_COOKIE), sentState())).toBe("alarm");
    });
  });

  describe("오류 처리", () => {
    it("카카오 설정이 없으면 이동하지 않고 KAKAO_UNAVAILABLE 문구를 돌려준다", async () => {
      signIn();
      vi.stubEnv("KAKAO_CLIENT_ID", "");
      vi.stubEnv("KAKAO_REDIRECT_URI", "");

      expect(await startKakaoAlarm()).toEqual({ error: KAKAO_UNAVAILABLE });
      expect(redirect).not.toHaveBeenCalled();
    });
  });

  describe("권한 · 로그인", () => {
    it("로그인 쿠키가 없으면 state를 만들지 않고 로그인 화면으로 보낸다", async () => {
      kakaoEnv();

      await expect(startKakaoAlarm()).rejects.toThrow(redirectTo("/login"));
      expect(cookieValue(OAUTH_STATE_COOKIE)).toBeUndefined();
    });
  });
});

describe("disablePracticeAlarm · 연습 알림 끄기", () => {
  describe("정상 처리", () => {
    it("끄면 오류 없이 화면을 다시 그린다", async () => {
      api.delete.mockResolvedValue({ status: 204 });

      expect(await disablePracticeAlarm()).toEqual({});
      expect(refresh).toHaveBeenCalledTimes(1);
    });
  });

  describe("오류 처리", () => {
    it("서버 문구가 있는 실패면 그 문구를 돌려주고 화면을 다시 그리지 않는다", async () => {
      api.delete.mockRejectedValue(axiosProblem(INTERNAL_ERROR));

      expect(await disablePracticeAlarm()).toEqual({ error: "요청을 처리하지 못했어요." });
      expect(refresh).not.toHaveBeenCalled();
    });

    it("서버에 닿지 못하면 다시 시도 안내를 돌려준다", async () => {
      api.delete.mockRejectedValue(axiosNoResponse());

      expect(await disablePracticeAlarm()).toEqual({ error: RETRY_LATER });
    });
  });

  describe("권한 · 로그인", () => {
    it("이동해야 하면 그 이동을 그대로 던진다", async () => {
      const moveToRefresh = new RedirectError("/api/auth/refresh");
      api.delete.mockRejectedValue(moveToRefresh);

      await expect(disablePracticeAlarm()).rejects.toBe(moveToRefresh);
    });
  });
});

describe("changePracticeAlarmTime · 연습 알림 시각 변경", () => {
  describe("정상 처리", () => {
    it("바꾸면 오류 없이 화면을 다시 그린다", async () => {
      api.patch.mockResolvedValue({ data: { available: true, enabled: true, time: "22:30" } });

      expect(await changePracticeAlarmTime({ time: "22:30" })).toEqual({});
      expect(refresh).toHaveBeenCalledTimes(1);
    });
  });

  describe("입력 검증", () => {
    it("시각이 HH:mm이 아니면 요청하지 않고 형식 문구를 돌려준다", async () => {
      expect(await changePracticeAlarmTime({ time: "9:00" })).toEqual({
        error: "HH:mm 형식(00:00~23:59)입니다.",
      });
      expect(api.patch).not.toHaveBeenCalled();
    });
  });

  describe("오류 처리", () => {
    it("카카오 연결이 없어 거절하면(409 PRACTICE_ALARM_UNAVAILABLE) 서버 문구를 돌려주고 화면을 다시 그리지 않는다", async () => {
      api.patch.mockRejectedValue(axiosProblem(PRACTICE_ALARM_UNAVAILABLE));

      expect(await changePracticeAlarmTime({ time: "22:30" })).toEqual({
        error: "카카오 계정을 연결한 회원만 연습 알림을 받을 수 있어요.",
      });
      expect(refresh).not.toHaveBeenCalled();
    });

    it("서버에 닿지 못하면 다시 시도 안내를 돌려준다", async () => {
      api.patch.mockRejectedValue(axiosNoResponse());

      expect(await changePracticeAlarmTime({ time: "22:30" })).toEqual({ error: RETRY_LATER });
    });
  });

  describe("권한 · 로그인", () => {
    it("이동해야 하면 그 이동을 그대로 던진다", async () => {
      const moveToRefresh = new RedirectError("/api/auth/refresh");
      api.patch.mockRejectedValue(moveToRefresh);

      await expect(changePracticeAlarmTime({ time: "22:30" })).rejects.toBe(moveToRefresh);
    });
  });
});

describe("applyStreakFreeze · 스트릭 유지권 사용", () => {
  describe("정상 처리", () => {
    it("메우면 메운 결과를 돌려주고 스트릭 · 달력 · 유지권 박스가 바뀌도록 화면을 다시 그린다", async () => {
      api.post.mockResolvedValue({ data: USED });

      expect(await applyStreakFreeze(31)).toEqual({ used: USED });
      expect(refresh).toHaveBeenCalledTimes(1);
    });
  });

  describe("입력 검증", () => {
    it.each([
      { label: "0", id: 0 },
      { label: "음수", id: -1 },
      { label: "소수", id: 1.5 },
      { label: "NaN", id: Number.NaN },
      { label: "안전한 정수 범위 밖", id: Number.MAX_SAFE_INTEGER + 1 },
    ])("유지권 id가 '$label'이면 요청하지 않고 다시 시도 안내를 돌려준다", async ({ id }) => {
      expect(await applyStreakFreeze(id)).toEqual({ error: RETRY_LATER });
      expect(api.post).not.toHaveBeenCalled();
    });
  });

  describe("경계값", () => {
    it("유지권 id가 가장 작은 유효값 1이면 요청한다", async () => {
      api.post.mockResolvedValue({ data: { ...USED, freezeId: 1 } });

      await applyStreakFreeze(1);

      expect(api.post).toHaveBeenCalledTimes(1);
    });
  });

  describe("오류 처리", () => {
    it("서버가 거절하면(409 STREAK_FREEZE_DATE_NOT_ALLOWED) 서버 문구를 돌려주고 박스가 서버 상태와 같아지도록 화면을 다시 그린다", async () => {
      api.post.mockRejectedValue(axiosProblem(DATE_NOT_ALLOWED));

      expect(await applyStreakFreeze(31)).toEqual({ error: "이미 연습한 날이라 메울 수 없어요." });
      expect(refresh).toHaveBeenCalledTimes(1);
    });

    it("서버에 닿지 못하면 다시 시도 안내를 돌려주고 화면을 다시 그리지 않는다", async () => {
      api.post.mockRejectedValue(axiosNoResponse());

      expect(await applyStreakFreeze(31)).toEqual({ error: RETRY_LATER });
      expect(refresh).not.toHaveBeenCalled();
    });
  });

  describe("권한 · 로그인", () => {
    it("이동해야 하면 그 이동을 그대로 던진다", async () => {
      const moveToRefresh = new RedirectError("/api/auth/refresh");
      api.post.mockRejectedValue(moveToRefresh);

      await expect(applyStreakFreeze(31)).rejects.toBe(moveToRefresh);
      expect(refresh).not.toHaveBeenCalled();
    });
  });
});

describe("startKakaoLink · 카카오 계정 연결 시작", () => {
  describe("정상 처리", () => {
    it("연결 용도로 기록한 state를 담은 카카오 동의 주소로 보낸다", async () => {
      signIn();
      kakaoEnv();

      await expect(startKakaoLink()).rejects.toThrow(/^REDIRECT https:\/\/kauth\.kakao\.com\//);
      expect(verifyState(cookieValue(OAUTH_STATE_COOKIE), sentState())).toBe("link");
    });
  });

  describe("오류 처리", () => {
    it("카카오 설정이 없으면 이동하지 않고 SOCIAL_LOGIN_UNAVAILABLE 문구를 돌려준다", async () => {
      signIn();
      vi.stubEnv("KAKAO_CLIENT_ID", "");
      vi.stubEnv("KAKAO_REDIRECT_URI", "");

      expect(await startKakaoLink()).toEqual({ error: SOCIAL_LOGIN_UNAVAILABLE });
      expect(redirect).not.toHaveBeenCalled();
    });
  });

  describe("권한 · 로그인", () => {
    it("로그인 쿠키가 없으면 state를 만들지 않고 로그인 화면으로 보낸다", async () => {
      kakaoEnv();

      await expect(startKakaoLink()).rejects.toThrow(redirectTo("/login"));
      expect(cookieValue(OAUTH_STATE_COOKIE)).toBeUndefined();
    });
  });
});

describe("unlinkKakao · 카카오 연결 해제", () => {
  describe("정상 처리", () => {
    it("해제하면 오류 없이 화면을 다시 그린다", async () => {
      api.delete.mockResolvedValue({ status: 204 });

      expect(await unlinkKakao()).toEqual({});
      expect(refresh).toHaveBeenCalledTimes(1);
    });
  });

  describe("오류 처리", () => {
    it("서버 문구가 있는 실패면 그 문구를 돌려주고 화면을 다시 그리지 않는다", async () => {
      api.delete.mockRejectedValue(axiosProblem(PASSWORD_NOT_SET));

      expect(await unlinkKakao()).toEqual({ error: "소셜 로그인 회원은 비밀번호가 없어요." });
      expect(refresh).not.toHaveBeenCalled();
    });

    it("서버에 닿지 못하면 다시 시도 안내를 돌려준다", async () => {
      api.delete.mockRejectedValue(axiosNoResponse());

      expect(await unlinkKakao()).toEqual({ error: RETRY_LATER });
    });
  });

  describe("권한 · 로그인", () => {
    it("이동해야 하면 그 이동을 그대로 던진다", async () => {
      const moveToRefresh = new RedirectError("/api/auth/refresh");
      api.delete.mockRejectedValue(moveToRefresh);

      await expect(unlinkKakao()).rejects.toBe(moveToRefresh);
    });
  });
});
