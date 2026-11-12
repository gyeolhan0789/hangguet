// @vitest-environment node
// 기준: Swagger 9.11 문의 사진 업로드 주소 → 브라우저가 uploadUrl로 S3에 PUT → 9.1 · 9.4 attachmentKeys
import { beforeEach, describe, expect, it, vi } from "vitest";

import { RETRY_LATER } from "@/lib/messages";
import type { AttachmentUploadUrl } from "@/types/api";

import { createInquiryPhotoUploadUrls } from "./actions";
import { uploadInquiryPhotos } from "./upload-photos";

// 경계 mock: 업로드 주소를 받는 서버 액션(9.11)과 S3로 올리는 fetch(BE가 아님)
vi.mock("./actions", () => ({ createInquiryPhotoUploadUrls: vi.fn() }));
const fetchMock = vi.fn();
beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
});

// 예시 데이터: Swagger 9.11 200 예시
const UPLOAD_A: AttachmentUploadUrl = {
  uploadUrl: "https://s3.example/inquiry/a.jpg?X-Amz-Signature=a",
  objectKey: "inquiry/a.jpg",
  expiresAt: "2026-10-26T10:10:00+09:00",
};
const UPLOAD_B: AttachmentUploadUrl = {
  uploadUrl: "https://s3.example/inquiry/b.png?X-Amz-Signature=b",
  objectKey: "inquiry/b.png",
  expiresAt: "2026-10-26T10:10:00+09:00",
};
const JPG = new File([new Uint8Array(10)], "a.jpg", { type: "image/jpeg" });
const PNG = new File([new Uint8Array(10)], "b.png", { type: "image/png" });

describe("uploadInquiryPhotos · 문의 사진 올리기", () => {
  describe("정상 처리", () => {
    it("사진마다 받은 주소로 그 사진의 형식을 담아 올리고 키를 고른 순서대로 돌려준다", async () => {
      vi.mocked(createInquiryPhotoUploadUrls).mockResolvedValue({ uploads: [UPLOAD_A, UPLOAD_B] });
      fetchMock.mockResolvedValue({ ok: true });

      expect(await uploadInquiryPhotos([JPG, PNG])).toEqual({
        keys: ["inquiry/a.jpg", "inquiry/b.png"],
      });
      expect(fetchMock).toHaveBeenCalledWith(
        UPLOAD_A.uploadUrl,
        expect.objectContaining({ headers: { "Content-Type": "image/jpeg" }, body: JPG }),
      );
      expect(fetchMock).toHaveBeenCalledWith(
        UPLOAD_B.uploadUrl,
        expect.objectContaining({ headers: { "Content-Type": "image/png" }, body: PNG }),
      );
    });
  });

  describe("입력 검증", () => {
    it("사진이 규칙에 맞지 않으면 주소를 받지 않고 규칙 문구를 돌려준다", async () => {
      const gif = new File([new Uint8Array(10)], "c.gif", { type: "image/gif" });

      expect(await uploadInquiryPhotos([gif])).toEqual({ error: "JPG·PNG만 올릴 수 있습니다." });
      expect(createInquiryPhotoUploadUrls).not.toHaveBeenCalled();
    });
  });

  describe("경계값", () => {
    it("사진이 없으면 주소를 받지 않고 빈 키 목록을 돌려준다", async () => {
      expect(await uploadInquiryPhotos([])).toEqual({ keys: [] });
      expect(createInquiryPhotoUploadUrls).not.toHaveBeenCalled();
    });
  });

  describe("오류 처리", () => {
    it("주소를 받지 못하면 그 문구를 돌려주고 올리지 않는다", async () => {
      vi.mocked(createInquiryPhotoUploadUrls).mockResolvedValue({
        error: "입력값을 확인해 주세요.",
      });

      expect(await uploadInquiryPhotos([JPG])).toEqual({ error: "입력값을 확인해 주세요." });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it.each([
      { label: "올리기 거절", fail: () => fetchMock.mockResolvedValueOnce({ ok: false }) },
      { label: "연결 실패", fail: () => fetchMock.mockRejectedValueOnce(new TypeError("fail")) },
    ])("사진 하나라도 '$label'이면 다시 시도 안내를 돌려준다", async ({ fail }) => {
      vi.mocked(createInquiryPhotoUploadUrls).mockResolvedValue({ uploads: [UPLOAD_A, UPLOAD_B] });
      fetchMock.mockResolvedValue({ ok: true });
      fail();

      expect(await uploadInquiryPhotos([JPG, PNG])).toEqual({ error: RETRY_LATER });
    });
  });
});
