// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

import { axiosNoResponse, axiosProblem } from "@/test/axios-problem";

// HTTP 경계(api)와 Next 서버 함수(redirect · refresh · unstable_rethrow)만 바꾼다.
const api = { get: vi.fn(), post: vi.fn() };
vi.mock("@/lib/api/client", () => ({ api }));

// 두 번째 인자(RedirectType)는 toHaveBeenCalledWith로 확인한다.
class RedirectSignal extends Error {}
const redirect = vi.fn<(url: string, type?: string) => never>((url) => {
  throw new RedirectSignal(url);
});
vi.mock("next/navigation", () => ({
  RedirectType: { push: "push", replace: "replace" },
  redirect: (url: string, type?: string) => redirect(url, type),
  unstable_rethrow: (error: unknown) => {
    if (error instanceof RedirectSignal) throw error;
  },
}));

const refresh = vi.fn();
vi.mock("next/cache", () => ({ refresh: () => refresh() }));

const {
  addInquiryMessage,
  closeInquiry,
  createGuestInquiry,
  createInquiry,
  createInquiryPhotoUploadUrls,
  openGuestInquiry,
} = await import("./actions");

// Swagger 9.1 · 9.3 응답 예시
const INQUIRY = {
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
    },
  ],
};
// Swagger 9.3 404 · 9.4 409 예시
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
const GUEST = { email: "a@ssafy.com", accessPassword: "1234", title: "제목", content: "내용" };

beforeEach(() => {
  vi.resetAllMocks();
});

describe("createInquiry (9.1 회원)", () => {
  it("제목 · 내용만 보내고 만든 문의(I03)로 기록을 바꿔치기해 간다(뒤로 가기로 보낸 폼에 돌아가지 않게)", async () => {
    api.post.mockResolvedValue({ data: INQUIRY });

    await expect(createInquiry({ title: "제목", content: "내용" })).rejects.toThrow("/inquiries/7");
    expect(api.post).toHaveBeenCalledWith("/inquiries", { title: "제목", content: "내용" });
    expect(redirect).toHaveBeenCalledWith("/inquiries/7", "replace");
  });

  it("붙인 사진이 있으면 attachmentKeys로 함께 보낸다", async () => {
    api.post.mockResolvedValue({ data: INQUIRY });

    await expect(
      createInquiry({ title: "제목", content: "내용" }, ["inquiry/a.png", "inquiry/b.jpg"]),
    ).rejects.toThrow("/inquiries/7");
    expect(api.post).toHaveBeenCalledWith("/inquiries", {
      title: "제목",
      content: "내용",
      attachmentKeys: ["inquiry/a.png", "inquiry/b.jpg"],
    });
  });

  it("사진 키 오류(400 attachmentKeys)는 서버가 준 이유를 문구로 돌려준다", async () => {
    api.post.mockRejectedValue(
      axiosProblem({
        status: 400,
        detail: "입력값을 확인해 주세요.",
        code: "VALIDATION_FAILED",
        errors: [{ field: "attachmentKeys", reason: "발급되지 않았거나 이미 쓴 키입니다." }],
      }),
    );

    expect(await createInquiry({ title: "제목", content: "내용" }, ["inquiry/a.png"])).toEqual({
      formError: "발급되지 않았거나 이미 쓴 키입니다.",
    });
    expect(await createGuestInquiry(GUEST, ["inquiry/a.png"])).toEqual({
      formError: "발급되지 않았거나 이미 쓴 키입니다.",
    });
    expect(
      await addInquiryMessage(7, { content: "확인", attachmentKeys: ["inquiry/a.png"] }),
    ).toEqual({ error: "발급되지 않았거나 이미 쓴 키입니다." });
  });

  it("사진 키가 6개 이상이면 보내지 않는다", async () => {
    const keys = Array.from({ length: 6 }, (_, i) => `inquiry/${i}.png`);

    expect(await createInquiry({ title: "제목", content: "내용" }, keys)).toEqual({
      formError: "입력값을 확인해 주세요.",
    });
    expect(api.post).not.toHaveBeenCalled();
  });

  it("칸 오류(400)는 그 칸에 서버 문구로 돌려준다", async () => {
    api.post.mockRejectedValue(
      axiosProblem({
        status: 400,
        detail: "입력값을 확인해 주세요.",
        code: "VALIDATION_FAILED",
        errors: [{ field: "title", reason: "최대 100자입니다." }],
      }),
    );

    expect(await createInquiry({ title: "제목", content: "내용" })).toEqual({
      fieldErrors: { title: "최대 100자입니다." },
    });
  });

  it("빈 칸이면 보내지 않는다", async () => {
    expect(await createInquiry({ title: " ", content: "내용" })).toEqual({
      formError: "입력값을 확인해 주세요.",
    });
    expect(api.post).not.toHaveBeenCalled();
  });
});

describe("createGuestInquiry (9.1 비회원)", () => {
  it("붙인 사진이 있으면 attachmentKeys로 함께 보낸다", async () => {
    api.post.mockResolvedValue({ data: INQUIRY });

    expect(await createGuestInquiry(GUEST, ["inquiry/a.png"])).toEqual({ inquiryId: 7 });
    expect(api.post).toHaveBeenCalledWith("/inquiries", {
      ...GUEST,
      attachmentKeys: ["inquiry/a.png"],
    });
  });

  it("이메일 · 조회 비밀번호까지 보내고 문의번호를 돌려준다", async () => {
    api.post.mockResolvedValue({ data: INQUIRY });

    expect(await createGuestInquiry(GUEST)).toEqual({ inquiryId: 7 });
    expect(api.post).toHaveBeenCalledWith("/inquiries", GUEST);
  });

  it("서버에 닿지 못하면 다시 시도 안내를 돌려준다", async () => {
    api.post.mockRejectedValue(axiosNoResponse());

    expect(await createGuestInquiry(GUEST)).toEqual({ formError: "잠시 후 다시 시도해 주세요." });
  });

  it("칸 오류(400)는 이메일 · 조회 비밀번호 칸에 서버 문구로 돌려준다", async () => {
    api.post.mockRejectedValue(
      axiosProblem({
        status: 400,
        detail: "입력값을 확인해 주세요.",
        code: "VALIDATION_FAILED",
        errors: [
          { field: "email", reason: "필수 값입니다." },
          { field: "accessPassword", reason: "필수 값입니다." },
        ],
      }),
    );

    expect(await createGuestInquiry(GUEST)).toEqual({
      fieldErrors: { email: "필수 값입니다.", accessPassword: "필수 값입니다." },
    });
  });
});

describe("openGuestInquiry (9.3 비회원)", () => {
  it("조회 비밀번호를 X-Inquiry-Password 헤더로 보낸다", async () => {
    api.get.mockResolvedValue({ data: INQUIRY });

    expect(await openGuestInquiry({ inquiryId: "7", accessPassword: "1234" })).toEqual({
      inquiry: INQUIRY,
    });
    expect(api.get).toHaveBeenCalledWith("/inquiries/7", {
      headers: { "X-Inquiry-Password": "1234" },
    });
  });

  it("문의번호가 양의 정수가 아니면 부르지 않는다", async () => {
    expect(await openGuestInquiry({ inquiryId: "a7", accessPassword: "1234" })).toEqual({
      formError: "입력값을 확인해 주세요.",
    });
    expect(api.get).not.toHaveBeenCalled();
  });

  it("없는 문의 · 틀린 조회 비밀번호(404)는 서버 문구를 돌려준다", async () => {
    api.get.mockRejectedValue(axiosProblem(INQUIRY_NOT_FOUND));

    expect(await openGuestInquiry({ inquiryId: "7", accessPassword: "9999" })).toEqual({
      formError: "문의를 찾을 수 없어요.",
    });
  });
});

describe("addInquiryMessage (9.4)", () => {
  it("회원은 헤더 없이 보내고 화면을 다시 그린다", async () => {
    api.post.mockResolvedValue({
      data: { id: 23, authorType: "USER", content: "확인", createdAt: "" },
    });

    // 화면은 사진이 없으면 빈 목록을 넘긴다. 그때는 attachmentKeys를 보내지 않는다
    const result = await addInquiryMessage(7, { content: "확인", attachmentKeys: [] });

    expect(result.message?.id).toBe(23);
    expect(api.post).toHaveBeenCalledWith("/inquiries/7/messages", { content: "확인" }, {});
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("붙인 사진이 있으면 attachmentKeys로 함께 보낸다", async () => {
    api.post.mockResolvedValue({
      data: { id: 23, authorType: "USER", content: "확인", createdAt: "", attachments: [] },
    });

    await addInquiryMessage(7, { content: "확인", attachmentKeys: ["inquiry/a.png"] }, "1234");

    expect(api.post).toHaveBeenCalledWith(
      "/inquiries/7/messages",
      { content: "확인", attachmentKeys: ["inquiry/a.png"] },
      { headers: { "X-Inquiry-Password": "1234" } },
    );
  });

  it("비회원은 조회 비밀번호를 헤더로 보내고 다시 그리지 않는다(화면이 9.3을 다시 부른다)", async () => {
    api.post.mockResolvedValue({
      data: { id: 23, authorType: "USER", content: "확인", createdAt: "" },
    });

    await addInquiryMessage(7, { content: "확인" }, "1234");

    expect(api.post).toHaveBeenCalledWith(
      "/inquiries/7/messages",
      { content: "확인" },
      { headers: { "X-Inquiry-Password": "1234" } },
    );
    expect(refresh).not.toHaveBeenCalled();
  });

  it("종료한 문의(409)는 closed와 서버 문구를 돌려주고 회원 I03을 다시 그린다", async () => {
    api.post.mockRejectedValueOnce(axiosProblem(INQUIRY_CLOSED));
    expect(await addInquiryMessage(7, { content: "확인" })).toEqual({
      error: "종료한 문의예요.",
      closed: true,
    });
    expect(refresh).toHaveBeenCalledTimes(1);

    api.post.mockRejectedValueOnce(axiosProblem(INQUIRY_CLOSED));
    expect(await addInquiryMessage(7, { content: "확인" }, "1234")).toEqual({
      error: "종료한 문의예요.",
      closed: true,
    });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("없는 문의(404)는 notFound를 함께 돌려준다", async () => {
    api.post.mockRejectedValueOnce(axiosProblem(INQUIRY_NOT_FOUND));
    expect(await addInquiryMessage(7, { content: "확인" })).toEqual({
      error: "문의를 찾을 수 없어요.",
      notFound: true,
    });
  });

  it("서버에 닿지 못하면 다시 시도 안내를 돌려준다", async () => {
    api.post.mockRejectedValue(axiosNoResponse());

    expect(await addInquiryMessage(7, { content: "확인" })).toEqual({
      error: "잠시 후 다시 시도해 주세요.",
    });
    expect(await closeInquiry(7)).toEqual({ error: "잠시 후 다시 시도해 주세요." });
  });

  it("빈 내용 · 잘못된 문의 id면 보내지 않는다", async () => {
    expect(await addInquiryMessage(7, { content: "  " })).toEqual({
      error: "입력값을 확인해 주세요.",
    });
    expect(await addInquiryMessage(0, { content: "확인" })).toEqual({
      error: "입력값을 확인해 주세요.",
    });
    expect(api.post).not.toHaveBeenCalled();
  });
});

describe("createInquiryPhotoUploadUrls (9.11)", () => {
  const PNG = { contentType: "image/png", size: 204800 } as const;

  it("사진마다 업로드 주소를 받아 요청한 순서대로 돌려준다", async () => {
    const files = [
      { uploadUrl: "https://s3.test/a", objectKey: "inquiry/a.png", expiresAt: "" },
      { uploadUrl: "https://s3.test/b", objectKey: "inquiry/b.jpg", expiresAt: "" },
    ];
    api.post.mockResolvedValue({ data: { files } });

    expect(
      await createInquiryPhotoUploadUrls([PNG, { contentType: "image/jpeg", size: 1 }]),
    ).toEqual({ uploads: files });
    expect(api.post).toHaveBeenCalledWith("/inquiries/attachments/upload-url", {
      files: [PNG, { contentType: "image/jpeg", size: 1 }],
    });
  });

  it("형식 · 크기 · 장수가 맞지 않으면 보내지 않고 서버와 같은 문구를 돌려준다", async () => {
    expect(
      await createInquiryPhotoUploadUrls([{ contentType: "image/gif" as "image/png", size: 1 }]),
    ).toEqual({ error: "JPG·PNG만 올릴 수 있습니다." });
    expect(await createInquiryPhotoUploadUrls([{ ...PNG, size: 5_242_881 }])).toEqual({
      error: "5MB 이하만 올릴 수 있습니다.",
    });
    expect(await createInquiryPhotoUploadUrls(Array(6).fill(PNG))).toEqual({
      error: "사진은 5장까지 붙일 수 있습니다.",
    });
    expect(api.post).not.toHaveBeenCalled();
  });

  it("서버가 거절하면(400) 이유를 그대로 돌려준다", async () => {
    api.post.mockRejectedValue(
      axiosProblem({
        status: 400,
        detail: "입력값을 확인해 주세요.",
        code: "VALIDATION_FAILED",
        errors: [{ field: "files[0].size", reason: "5MB 이하만 올릴 수 있습니다." }],
      }),
    );

    expect(await createInquiryPhotoUploadUrls([PNG])).toEqual({
      error: "5MB 이하만 올릴 수 있습니다.",
    });
  });

  it("서버에 닿지 못하면 다시 시도 안내를 돌려준다", async () => {
    api.post.mockRejectedValue(axiosNoResponse());

    expect(await createInquiryPhotoUploadUrls([PNG])).toEqual({
      error: "잠시 후 다시 시도해 주세요.",
    });
  });
});

describe("closeInquiry (9.5)", () => {
  it("회원은 종료하고 다시 그린다", async () => {
    api.post.mockResolvedValue({ status: 204 });

    expect(await closeInquiry(7)).toEqual({ ok: true });
    expect(api.post).toHaveBeenCalledWith("/inquiries/7/close", undefined, {});
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("비회원은 헤더를 보내고 다시 그리지 않는다", async () => {
    api.post.mockResolvedValue({ status: 204 });

    expect(await closeInquiry(7, "1234")).toEqual({ ok: true });
    expect(api.post).toHaveBeenCalledWith("/inquiries/7/close", undefined, {
      headers: { "X-Inquiry-Password": "1234" },
    });
    expect(refresh).not.toHaveBeenCalled();
  });

  it("api가 재발급 · 로그아웃 화면으로 보내면(redirect) 그대로 이동한다", async () => {
    api.post.mockRejectedValue(new RedirectSignal("REDIRECT /login"));

    await expect(closeInquiry(7)).rejects.toBeInstanceOf(RedirectSignal);
  });
});
