// 기준: Figma S09-1 Row 프로필 사진(18:3186: [사진 변경] · '삭제') · Swagger 2.4 업로드 주소 → 브라우저가 uploadUrl로 S3에 PUT → 2.5 등록 · 2.6 삭제
// · 모션 메모 S09-1(18:3261: 업로드 후 체크 토스트)
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { RETRY_LATER } from "@/lib/messages";
import {
  createProfileImageUploadUrl,
  deleteProfileImage,
  registerProfileImage,
} from "@/lib/user/actions";
import { useToastStore } from "@/stores/toast-store";
import { deferred } from "@/test/deferred";
import { flushPromises } from "@/test/flush";
import type { UploadUrlResponse } from "@/types/api";

import { ProfilePhotoRow } from "./profile-photo-row";

// 경계 mock: 서버 액션(2.4 · 2.5 · 2.6), 브라우저가 S3에 직접 올리는 fetch(BE 아님), 연출(motion)
vi.mock("@/lib/user/actions", () => ({
  createProfileImageUploadUrl: vi.fn(),
  registerProfileImage: vi.fn(),
  deleteProfileImage: vi.fn(),
}));
vi.mock("motion/react", async (importOriginal) =>
  (await import("@/test/motion")).reducedMotion(importOriginal),
);

// 예시 데이터: Swagger 2.4 200 예시
const UPLOAD: UploadUrlResponse = {
  uploadUrl: "https://…s3…?X-Amz-Signature=…",
  objectKey: "profile/1/7f3c….png",
  expiresAt: "2026-10-15T12:10:00+09:00",
};
const PNG = new File(["png"], "me.png", { type: "image/png" });
const SERVER_ERROR = "업로드한 파일을 찾을 수 없어요.";
// 2.4 · 2.6은 Swagger에 오류 예시가 없어, 대체 문구(RETRY_LATER)와 구별되는 서버 문구를 정했다
const REQUEST_FAILED = "요청을 처리하지 못했어요.";

const fetchMock = vi.fn();
const fileInput = () => screen.getByLabelText<HTMLInputElement>("프로필 사진 파일");
const changeButton = () => screen.getByRole("button", { name: "사진 변경" });
const deleteButton = () => screen.getByRole("button", { name: "삭제" });
const toastText = () => useToastStore.getState().toast?.text;

/** 파일 고르기에서 사진을 고른다 */
function pick(file: File) {
  fireEvent.change(fileInput(), { target: { files: [file] } });
}

beforeEach(() => {
  useToastStore.setState({ toast: null });
  vi.stubGlobal("fetch", fetchMock);
});

describe("ProfilePhotoRow · 설정 프로필 사진 줄", () => {
  describe("사진 바꾸기", () => {
    describe("사용자 조작", () => {
      it("파일을 고른 뒤 입력칸 값을 비워 같은 파일을 다시 고를 수 있게 한다", async () => {
        vi.mocked(createProfileImageUploadUrl).mockResolvedValue({ formError: RETRY_LATER });
        render(<ProfilePhotoRow imageUrl={null} />);
        const setValue = vi.spyOn(fileInput(), "value", "set");

        pick(PNG);
        await flushPromises();

        expect(setValue).toHaveBeenCalledWith("");
      });
      it("사진을 고르면 받은 주소로 그 형식을 담아 올린 뒤 받은 키로 등록하고 체크 토스트를 띄운다", async () => {
        vi.mocked(createProfileImageUploadUrl).mockResolvedValue({ upload: UPLOAD });
        fetchMock.mockResolvedValue({ ok: true });
        vi.mocked(registerProfileImage).mockResolvedValue({ ok: true });
        render(<ProfilePhotoRow imageUrl={null} />);

        pick(PNG);
        await flushPromises();

        expect(fetchMock).toHaveBeenCalledWith(UPLOAD.uploadUrl, {
          method: "PUT",
          headers: { "Content-Type": "image/png" },
          body: PNG,
        });
        expect(registerProfileImage).toHaveBeenCalledWith(UPLOAD.objectKey);
        expect(useToastStore.getState().toast).toMatchObject({
          text: "프로필 사진을 바꿨어요",
          icon: "/home/icon-check.svg",
        });
      });
    });

    describe("입력 검증", () => {
      it("사진이 규칙에 맞지 않으면 올리지 않고 규칙 문구를 토스트로 띄운다", () => {
        render(<ProfilePhotoRow imageUrl={null} />);

        pick(new File(["gif"], "me.gif", { type: "image/gif" }));

        expect(createProfileImageUploadUrl).not.toHaveBeenCalled();
        expect(toastText()).toBe("JPG·PNG만 올릴 수 있습니다.");
      });
    });

    describe("오류 처리", () => {
      it("업로드 주소를 받지 못하면 올리지 않고 서버 문구를 토스트로 띄운다", async () => {
        vi.mocked(createProfileImageUploadUrl).mockResolvedValue({ formError: REQUEST_FAILED });
        render(<ProfilePhotoRow imageUrl={null} />);

        pick(PNG);
        await flushPromises();

        expect(fetchMock).not.toHaveBeenCalled();
        expect(toastText()).toBe(REQUEST_FAILED);
      });

      it.each([
        { label: "올리기 거절", upload: () => fetchMock.mockResolvedValue({ ok: false }) },
        { label: "연결 실패", upload: () => fetchMock.mockRejectedValue(new TypeError("fail")) },
      ])(
        "올리기가 '$label'이면 등록하지 않고 다시 시도 안내를 토스트로 띄운다",
        async ({ upload }) => {
          vi.mocked(createProfileImageUploadUrl).mockResolvedValue({ upload: UPLOAD });
          upload();
          render(<ProfilePhotoRow imageUrl={null} />);

          pick(PNG);
          await flushPromises();

          expect(registerProfileImage).not.toHaveBeenCalled();
          expect(toastText()).toBe(RETRY_LATER);
        },
      );

      it("등록이 실패하면 서버 문구를 토스트로 띄운다", async () => {
        vi.mocked(createProfileImageUploadUrl).mockResolvedValue({ upload: UPLOAD });
        fetchMock.mockResolvedValue({ ok: true });
        vi.mocked(registerProfileImage).mockResolvedValue({ formError: SERVER_ERROR });
        render(<ProfilePhotoRow imageUrl={null} />);

        pick(PNG);
        await flushPromises();

        expect(toastText()).toBe(SERVER_ERROR);
      });
    });

    describe("중복 · 경쟁 처리", () => {
      it("올리는 동안에는 [사진 변경] · [삭제]를 누를 수 없다", async () => {
        const issuing = deferred<{ formError?: string }>();
        vi.mocked(createProfileImageUploadUrl).mockReturnValue(issuing.promise);
        render(<ProfilePhotoRow imageUrl={null} />);

        pick(PNG);

        expect(changeButton().hasAttribute("disabled")).toBe(true);
        expect(deleteButton().hasAttribute("disabled")).toBe(true);
        await act(async () => issuing.resolve({ formError: RETRY_LATER }));
      });
    });
  });

  describe("사진 삭제", () => {
    describe("사용자 조작", () => {
      it("[삭제]가 성공하면 토스트를 띄우지 않는다", async () => {
        vi.mocked(deleteProfileImage).mockResolvedValue({ ok: true });
        render(<ProfilePhotoRow imageUrl="https://…" />);

        fireEvent.click(deleteButton());
        await flushPromises();

        expect(deleteProfileImage).toHaveBeenCalledTimes(1);
        expect(useToastStore.getState().toast).toBeNull();
      });
    });

    describe("오류 처리", () => {
      it("삭제가 실패하면 서버 문구를 토스트로 띄운다", async () => {
        vi.mocked(deleteProfileImage).mockResolvedValue({ formError: REQUEST_FAILED });
        render(<ProfilePhotoRow imageUrl="https://…" />);

        fireEvent.click(deleteButton());
        await flushPromises();

        expect(toastText()).toBe(REQUEST_FAILED);
      });
    });

    describe("중복 · 경쟁 처리", () => {
      it("지우는 동안에는 [사진 변경] · [삭제]를 누를 수 없다", async () => {
        const deleting = deferred<{ ok?: true }>();
        vi.mocked(deleteProfileImage).mockReturnValue(deleting.promise);
        render(<ProfilePhotoRow imageUrl="https://…" />);

        fireEvent.click(deleteButton());

        expect(changeButton().hasAttribute("disabled")).toBe(true);
        expect(deleteButton().hasAttribute("disabled")).toBe(true);
        await act(async () => deleting.resolve({ ok: true }));
      });
    });
  });
});
