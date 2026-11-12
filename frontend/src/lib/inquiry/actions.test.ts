// @vitest-environment node
// 기준: Swagger 9.1 문의 작성 · 9.3 문의 조회 · 9.4 이어서 쓰기(409 INQUIRY_CLOSED) · 9.5 종료 · 9.11 사진 업로드 주소
// · 기획 메모 I01(→ I03) · I01-B(→ I01-1) · I04(→ I03) · I03 · I03-1
import { describe, expect, it, vi } from "vitest";

import { refresh } from "next/cache";
import { redirect, RedirectType } from "next/navigation";

import { RETRY_LATER } from "@/lib/api/problem-detail";
import { axiosNoResponse, axiosProblem } from "@/test/axios-problem";
import { RedirectError } from "@/test/next-navigation";
import { redirectTo } from "@/test/redirect";
import type { AttachmentUploadUrl, InquiryResponse } from "@/types/api";

import {
  addInquiryMessage,
  closeInquiry,
  createGuestInquiry,
  createInquiry,
  createInquiryPhotoUploadUrls,
  openGuestInquiry,
} from "./actions";
import { PHOTO_COUNT } from "./schemas";

// 경계 mock: HTTP(api)와 Next 런타임(redirect · unstable_rethrow · refresh)
const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock("@/lib/api/client", () => ({ api }));
vi.mock("next/navigation", () => import("@/test/next-navigation"));
vi.mock("next/cache", () => import("@/test/next-cache"));

// 예시 데이터: Swagger 9.1 · 9.3 · 9.4 · 9.11 예시
const INVALID = "입력값을 확인해 주세요.";
const INQUIRY: InquiryResponse = {
  id: 7,
  title: "비밀번호를 잊어버렸어요",
  status: "WAITING",
  createdAt: "2026-10-26T10:00:00+09:00",
  updatedAt: "2026-10-26T10:00:00+09:00",
  messages: [
    {
      id: 21,
      authorType: "USER",
      content: "가입한 이메일은 a@ssafy.com이에요. 비밀번호를 바꿔 주세요.",
      createdAt: "2026-10-26T10:00:00+09:00",
      attachments: [],
    },
  ],
};
const MESSAGE = {
  id: 23,
  authorType: "USER",
  content: "확인 부탁드려요.",
  createdAt: "2026-10-26T12:00:00+09:00",
  attachments: [],
};
const PHOTO_KEY_INVALID = {
  title: "Bad Request",
  status: 400,
  detail: "입력값을 확인해 주세요.",
  instance: "/api/v1/inquiries",
  code: "VALIDATION_FAILED",
  errors: [{ field: "attachmentKeys", reason: "발급되지 않았거나 이미 쓴 키입니다." }],
};
const FILE_NOT_FOUND = {
  title: "Not Found",
  status: 404,
  detail: "업로드한 파일을 찾을 수 없어요.",
  instance: "/api/v1/inquiries",
  code: "FILE_NOT_FOUND",
};
const INQUIRY_NOT_FOUND = {
  title: "Not Found",
  status: 404,
  detail: "문의를 찾을 수 없어요.",
  instance: "/api/v1/inquiries/0",
  code: "INQUIRY_NOT_FOUND",
};
const INQUIRY_CLOSED = {
  title: "Conflict",
  status: 409,
  detail: "종료한 문의예요.",
  instance: "/api/v1/inquiries/7/messages",
  code: "INQUIRY_CLOSED",
};
const UPLOAD_A: AttachmentUploadUrl = {
  uploadUrl: "https://s3.example/inquiry/a.png?X-Amz-Signature=a",
  objectKey: "inquiry/a.png",
  expiresAt: "2026-10-26T10:10:00+09:00",
};
const UPLOAD_B: AttachmentUploadUrl = {
  uploadUrl: "https://s3.example/inquiry/b.jpg?X-Amz-Signature=b",
  objectKey: "inquiry/b.jpg",
  expiresAt: "2026-10-26T10:10:00+09:00",
};
const PNG = { contentType: "image/png", size: 1024 } as const;
const MEMBER = { title: "비밀번호를 잊어버렸어요", content: "비밀번호를 바꿔 주세요." };
const GUEST = { email: "a@ssafy.com", accessPassword: "1234", ...MEMBER };
const SIX_KEYS = Array.from({ length: 6 }, (_, index) => `inquiry/${index}.png`);
const GUEST_PASSWORD = "1234";

describe("createInquiryPhotoUploadUrls · 문의 사진 업로드 주소", () => {
  describe("정상 처리", () => {
    it("주소를 받으면 받은 업로드 주소 목록을 돌려준다", async () => {
      api.post.mockResolvedValue({ data: { files: [UPLOAD_A, UPLOAD_B] } });

      expect(await createInquiryPhotoUploadUrls([PNG, PNG])).toEqual({
        uploads: [UPLOAD_A, UPLOAD_B],
      });
    });
  });

  describe("입력 검증", () => {
    it("사진이 6장이면 요청하지 않고 장수 문구를 돌려준다", async () => {
      expect(await createInquiryPhotoUploadUrls(Array.from({ length: 6 }, () => PNG))).toEqual({
        error: PHOTO_COUNT,
      });
      expect(api.post).not.toHaveBeenCalled();
    });
  });

  describe("오류 처리", () => {
    it("사유 없이 서버 문구만 있으면 그 문구를 돌려준다", async () => {
      api.post.mockRejectedValue(
        axiosProblem({
          title: "Bad Request",
          status: 400,
          detail: "입력값을 확인해 주세요.",
          instance: "/api/v1/inquiries/attachments/upload-url",
          code: "VALIDATION_FAILED",
        }),
      );

      expect(await createInquiryPhotoUploadUrls([PNG])).toEqual({
        error: "입력값을 확인해 주세요.",
      });
    });

    it("서버에 닿지 못하면 다시 시도 안내를 돌려준다", async () => {
      api.post.mockRejectedValue(axiosNoResponse());

      expect(await createInquiryPhotoUploadUrls([PNG])).toEqual({ error: RETRY_LATER });
    });
  });

  describe("권한 · 로그인", () => {
    it("이동해야 하면 그 이동을 그대로 던진다", async () => {
      const moveToRefresh = new RedirectError("/api/auth/refresh");
      api.post.mockRejectedValue(moveToRefresh);

      await expect(createInquiryPhotoUploadUrls([PNG])).rejects.toBe(moveToRefresh);
    });
  });
});

describe("createInquiry · 문의 작성(회원)", () => {
  describe("정상 처리", () => {
    it("저장하면 만든 문의 주소로 기록을 바꿔치기해 보낸다", async () => {
      api.post.mockResolvedValue({ data: INQUIRY });

      await expect(createInquiry(MEMBER)).rejects.toThrow(redirectTo("/inquiries/7"));
      expect(vi.mocked(redirect).mock.calls[0][1]).toBe(RedirectType.replace);
    });
  });

  describe("입력 검증", () => {
    it.each([
      { label: "제목 공백", values: { ...MEMBER, title: "   " }, keys: [] },
      { label: "사진 키 6개", values: MEMBER, keys: SIX_KEYS },
    ])("'$label'이면 요청하지 않고 입력 확인 문구를 돌려준다", async ({ values, keys }) => {
      expect(await createInquiry(values, keys)).toEqual({ formError: INVALID });
      expect(api.post).not.toHaveBeenCalled();
    });
  });

  describe("오류 처리", () => {
    it("사진 키 오류(400 attachmentKeys)면 서버가 준 사유를 폼 오류로 돌려준다", async () => {
      api.post.mockRejectedValue(axiosProblem(PHOTO_KEY_INVALID));

      expect(await createInquiry(MEMBER, ["inquiry/a.png"])).toEqual({
        formError: "발급되지 않았거나 이미 쓴 키입니다.",
      });
    });

    it("사진 키 오류가 아닌 서버 문구가 있는 실패면(404 FILE_NOT_FOUND) 그 문구를 폼 오류로 돌려준다", async () => {
      api.post.mockRejectedValue(axiosProblem(FILE_NOT_FOUND));

      expect(await createInquiry(MEMBER, ["inquiry/a.png"])).toEqual({
        formError: "업로드한 파일을 찾을 수 없어요.",
      });
    });
  });

  describe("권한 · 로그인", () => {
    it("이동해야 하면 그 이동을 그대로 던진다", async () => {
      const moveToRefresh = new RedirectError("/api/auth/refresh");
      api.post.mockRejectedValue(moveToRefresh);

      await expect(createInquiry(MEMBER)).rejects.toBe(moveToRefresh);
    });
  });
});

describe("createGuestInquiry · 문의 작성(비회원)", () => {
  describe("정상 처리", () => {
    it("저장하면 문의번호를 돌려준다", async () => {
      api.post.mockResolvedValue({ data: INQUIRY });

      expect(await createGuestInquiry(GUEST)).toEqual({ inquiryId: 7 });
    });
  });

  describe("입력 검증", () => {
    it.each([
      { label: "이메일 형식 아님", values: { ...GUEST, email: "a-ssafy.com" }, keys: [] },
      { label: "사진 키 6개", values: GUEST, keys: SIX_KEYS },
    ])("'$label'이면 요청하지 않고 입력 확인 문구를 돌려준다", async ({ values, keys }) => {
      expect(await createGuestInquiry(values, keys)).toEqual({ formError: INVALID });
      expect(api.post).not.toHaveBeenCalled();
    });
  });

  describe("오류 처리", () => {
    it("사진 키 오류(400 attachmentKeys)면 서버가 준 사유를 폼 오류로 돌려준다", async () => {
      api.post.mockRejectedValue(axiosProblem(PHOTO_KEY_INVALID));

      expect(await createGuestInquiry(GUEST, ["inquiry/a.png"])).toEqual({
        formError: "발급되지 않았거나 이미 쓴 키입니다.",
      });
    });
  });

  describe("권한 · 로그인", () => {
    it("이동해야 하면 그 이동을 그대로 던진다", async () => {
      const moveToRefresh = new RedirectError("/api/auth/refresh");
      api.post.mockRejectedValue(moveToRefresh);

      await expect(createGuestInquiry(GUEST)).rejects.toBe(moveToRefresh);
    });
  });
});

describe("openGuestInquiry · 문의 조회(비회원)", () => {
  describe("정상 처리", () => {
    it("열면 그 문의를 돌려준다", async () => {
      api.get.mockResolvedValue({ data: INQUIRY });

      expect(await openGuestInquiry({ inquiryId: "7", accessPassword: GUEST_PASSWORD })).toEqual({
        inquiry: INQUIRY,
      });
    });
  });

  describe("입력 검증", () => {
    it("문의번호가 '0'이면 요청하지 않고 입력 확인 문구를 돌려준다", async () => {
      expect(await openGuestInquiry({ inquiryId: "0", accessPassword: GUEST_PASSWORD })).toEqual({
        formError: INVALID,
      });
      expect(api.get).not.toHaveBeenCalled();
    });
  });

  describe("오류 처리", () => {
    it("없는 문의 · 틀린 조회 비밀번호(404)면 서버 문구를 폼 오류로 돌려준다", async () => {
      api.get.mockRejectedValue(axiosProblem(INQUIRY_NOT_FOUND));

      expect(await openGuestInquiry({ inquiryId: "7", accessPassword: "0000" })).toEqual({
        formError: "문의를 찾을 수 없어요.",
      });
    });
  });

  describe("권한 · 로그인", () => {
    it("이동해야 하면 그 이동을 그대로 던진다", async () => {
      const moveToRefresh = new RedirectError("/api/auth/refresh");
      api.get.mockRejectedValue(moveToRefresh);

      await expect(
        openGuestInquiry({ inquiryId: "7", accessPassword: GUEST_PASSWORD }),
      ).rejects.toBe(moveToRefresh);
    });
  });
});

describe("addInquiryMessage · 문의 이어서 쓰기", () => {
  const QUESTION = { content: "확인 부탁드려요." };

  describe("정상 처리", () => {
    it("회원이 쓰면 오류 없이 화면을 다시 그린다", async () => {
      api.post.mockResolvedValue({ data: MESSAGE });

      expect(await addInquiryMessage(7, QUESTION)).not.toHaveProperty("error");
      expect(refresh).toHaveBeenCalledTimes(1);
    });

    it("비회원이 쓰면 오류 없이 화면을 다시 그리지 않는다", async () => {
      api.post.mockResolvedValue({ data: MESSAGE });

      expect(await addInquiryMessage(7, QUESTION, GUEST_PASSWORD)).not.toHaveProperty("error");
      expect(refresh).not.toHaveBeenCalled();
    });
  });

  describe("입력 검증", () => {
    it.each([
      { label: "0", id: 0 },
      { label: "음수", id: -1 },
      { label: "소수", id: 1.5 },
    ])("문의 id가 '$label'이면 요청하지 않고 입력 확인 문구를 돌려준다", async ({ id }) => {
      expect(await addInquiryMessage(id, QUESTION)).toEqual({ error: INVALID });
      expect(api.post).not.toHaveBeenCalled();
    });

    it.each([
      { label: "내용 공백", question: { content: "   " } },
      { label: "사진 키 6개", question: { ...QUESTION, attachmentKeys: SIX_KEYS } },
    ])("'$label'이면 요청하지 않고 입력 확인 문구를 돌려준다", async ({ question }) => {
      expect(await addInquiryMessage(7, question)).toEqual({ error: INVALID });
      expect(api.post).not.toHaveBeenCalled();
    });
  });

  describe("오류 처리", () => {
    it("회원 문의가 그 사이 종료됐으면(409) 종료 표시와 서버 문구를 돌려주고 화면을 다시 그린다", async () => {
      api.post.mockRejectedValue(axiosProblem(INQUIRY_CLOSED));

      expect(await addInquiryMessage(7, QUESTION)).toEqual({
        error: "종료한 문의예요.",
        closed: true,
      });
      expect(refresh).toHaveBeenCalledTimes(1);
    });

    it("비회원 문의가 그 사이 종료됐으면(409) 종료 표시를 돌려주고 화면을 다시 그리지 않는다", async () => {
      api.post.mockRejectedValue(axiosProblem(INQUIRY_CLOSED));

      expect(await addInquiryMessage(7, QUESTION, GUEST_PASSWORD)).toEqual({
        error: "종료한 문의예요.",
        closed: true,
      });
      expect(refresh).not.toHaveBeenCalled();
    });

    it("없는 문의(404)면 없음 표시와 서버 문구를 돌려주고 화면을 다시 그리지 않는다", async () => {
      api.post.mockRejectedValue(axiosProblem(INQUIRY_NOT_FOUND));

      expect(await addInquiryMessage(7, QUESTION)).toEqual({
        error: "문의를 찾을 수 없어요.",
        notFound: true,
      });
      expect(refresh).not.toHaveBeenCalled();
    });

    it("사진 키 오류(400 attachmentKeys)면 서버가 준 사유를 돌려준다", async () => {
      api.post.mockRejectedValue(axiosProblem(PHOTO_KEY_INVALID));

      expect(
        await addInquiryMessage(7, { ...QUESTION, attachmentKeys: ["inquiry/a.png"] }),
      ).toEqual({ error: "발급되지 않았거나 이미 쓴 키입니다." });
    });

    it("서버에 닿지 못하면 다시 시도 안내를 돌려주고 화면을 다시 그리지 않는다", async () => {
      api.post.mockRejectedValue(axiosNoResponse());

      expect(await addInquiryMessage(7, QUESTION)).toEqual({ error: RETRY_LATER });
      expect(refresh).not.toHaveBeenCalled();
    });
  });

  describe("권한 · 로그인", () => {
    it("이동해야 하면 그 이동을 그대로 던진다", async () => {
      const moveToRefresh = new RedirectError("/api/auth/refresh");
      api.post.mockRejectedValue(moveToRefresh);

      await expect(addInquiryMessage(7, QUESTION)).rejects.toBe(moveToRefresh);
      expect(refresh).not.toHaveBeenCalled();
    });
  });
});

describe("closeInquiry · 문의 종료", () => {
  describe("정상 처리", () => {
    it("회원이 종료하면 오류 없이 화면을 다시 그린다", async () => {
      api.post.mockResolvedValue({ status: 204 });

      expect(await closeInquiry(7)).not.toHaveProperty("error");
      expect(refresh).toHaveBeenCalledTimes(1);
    });

    it("비회원이 종료하면 오류 없이 화면을 다시 그리지 않는다", async () => {
      api.post.mockResolvedValue({ status: 204 });

      expect(await closeInquiry(7, GUEST_PASSWORD)).not.toHaveProperty("error");
      expect(refresh).not.toHaveBeenCalled();
    });
  });

  describe("입력 검증", () => {
    it("문의 id가 양의 정수가 아니면 요청하지 않고 입력 확인 문구를 돌려준다", async () => {
      expect(await closeInquiry(0)).toEqual({ error: INVALID });
      expect(api.post).not.toHaveBeenCalled();
    });
  });

  describe("오류 처리", () => {
    it("없는 문의(404)면 없음 표시와 서버 문구를 돌려준다", async () => {
      api.post.mockRejectedValue(axiosProblem(INQUIRY_NOT_FOUND));

      expect(await closeInquiry(7)).toEqual({ error: "문의를 찾을 수 없어요.", notFound: true });
    });
  });

  describe("권한 · 로그인", () => {
    it("이동해야 하면 그 이동을 그대로 던진다", async () => {
      const moveToRefresh = new RedirectError("/api/auth/refresh");
      api.post.mockRejectedValue(moveToRefresh);

      await expect(closeInquiry(7)).rejects.toBe(moveToRefresh);
      expect(refresh).not.toHaveBeenCalled();
    });
  });
});
