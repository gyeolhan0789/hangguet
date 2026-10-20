// @vitest-environment node
import { beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";

import { axiosProblem } from "@/test/axios-problem";
import type {
  MeResponse,
  NicknameRequest,
  PasswordChangeRequest,
  ProblemDetail,
  ProfileImageUploadUrlRequest,
  WithdrawRequest,
} from "@/types/api";

import type {
  NicknameValues,
  PasswordChangeValues,
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

const cookieStore = { delete: vi.fn() };
vi.mock("next/headers", () => ({ cookies: async () => cookieStore }));

const {
  changeNickname,
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
  profileImageUrl: "https://…",
  createdAt: "2026-09-01T10:00:00+09:00",
  currentStreak: 7,
} satisfies MeResponse;

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
});

// tsc(npm run typecheck)가 검사한다: 스키마나 Swagger 요청 타입 어느 쪽이 바뀌어도 여기서 컴파일 오류가 난다.
describe("스키마 값의 타입이 Swagger 요청 타입과 같다", () => {
  it("2.2 · 2.3 · 2.4 · 2.7", () => {
    expectTypeOf<NicknameValues>().toEqualTypeOf<NicknameRequest>();
    expectTypeOf<PasswordChangeValues>().toEqualTypeOf<PasswordChangeRequest>();
    expectTypeOf<ProfileImageUploadValues>().toEqualTypeOf<ProfileImageUploadUrlRequest>();
    expectTypeOf<WithdrawValues>().toEqualTypeOf<WithdrawRequest>();
  });
});

describe("changeNickname (2.2 닉네임 변경)", () => {
  it("앞뒤 공백을 지워 보내고, 헤더 · 화면이 새 닉네임을 다시 불러오도록 다시 그린다", async () => {
    api.patch.mockResolvedValue({ data: { ...ME, nickname: "새 닉네임" } });

    expect(await changeNickname({ nickname: "  새 닉네임 " })).toEqual({ ok: true });
    expect(api.patch).toHaveBeenCalledWith("/users/me", { nickname: "새 닉네임" });
    expect(refresh).toHaveBeenCalledTimes(1);
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
