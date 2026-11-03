import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { uploadInquiryPhotos } from "./upload-photos";

// 기준: Swagger 9.11 문의 사진 업로드 주소 → 브라우저가 uploadUrl로 S3에 PUT → 9.1 · 9.4 attachmentKeys
// 경계인 9.11 서버 액션과 fetch(S3)만 바꾼다. S3 응답은 호출 순서가 아니라 주소로 정한다.

const { createInquiryPhotoUploadUrls } = vi.hoisted(() => ({
  createInquiryPhotoUploadUrls: vi.fn(),
}));
vi.mock("./actions", () => ({ createInquiryPhotoUploadUrls }));

const fetchMock = vi.fn();
/** 주소별 S3 응답. 없으면 200 */
let s3Status: Record<string, number | "offline"> = {};

const photo = (name: string, type: string, size: number) =>
  new File([new Uint8Array(size)], name, { type });
const upload = (key: string) => ({
  uploadUrl: `https://s3.test/${key}`,
  objectKey: key,
  expiresAt: "2026-11-03T10:10:00+09:00",
});

beforeEach(() => {
  s3Status = {};
  fetchMock.mockImplementation(async (url: string) => {
    const status = s3Status[url] ?? 200;
    if (status === "offline") throw new TypeError("Failed to fetch");
    return new Response(null, { status });
  });
  vi.stubGlobal("fetch", fetchMock);
  createInquiryPhotoUploadUrls.mockResolvedValue({
    uploads: [upload("inquiry/a.png"), upload("inquiry/b.jpg")],
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

describe("uploadInquiryPhotos", () => {
  const files = [photo("a.png", "image/png", 3), photo("b.jpg", "image/jpeg", 4)];

  it("사진마다 형식 · 크기로 주소를 받아 자기 주소에 그 형식으로 올리고, 키를 고른 순서대로 준다", async () => {
    expect(await uploadInquiryPhotos(files)).toEqual({ keys: ["inquiry/a.png", "inquiry/b.jpg"] });

    expect(createInquiryPhotoUploadUrls).toHaveBeenCalledWith([
      { contentType: "image/png", size: 3 },
      { contentType: "image/jpeg", size: 4 },
    ]);
    expect(fetchMock).toHaveBeenCalledWith("https://s3.test/inquiry/a.png", {
      method: "PUT",
      headers: { "Content-Type": "image/png" },
      body: files[0],
    });
    expect(fetchMock).toHaveBeenCalledWith("https://s3.test/inquiry/b.jpg", {
      method: "PUT",
      headers: { "Content-Type": "image/jpeg" },
      body: files[1],
    });
  });

  it("사진이 없으면 9.11을 부르지 않고 빈 키 목록을 준다", async () => {
    expect(await uploadInquiryPhotos([])).toEqual({ keys: [] });
    expect(createInquiryPhotoUploadUrls).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("9.11이 실패하면 그 문구를 그대로 주고 S3에 올리지 않는다", async () => {
    createInquiryPhotoUploadUrls.mockResolvedValue({ error: "5MB 이하만 올릴 수 있습니다." });

    expect(await uploadInquiryPhotos(files)).toEqual({ error: "5MB 이하만 올릴 수 있습니다." });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    { name: "S3가 거절하면(403)", status: 403 },
    { name: "S3에 닿지 못하면", status: "offline" as const },
  ])("$name 다시 시도 안내를 준다", async ({ status }) => {
    s3Status = { "https://s3.test/inquiry/b.jpg": status };

    expect(await uploadInquiryPhotos(files)).toEqual({ error: "잠시 후 다시 시도해 주세요." });
  });
});
