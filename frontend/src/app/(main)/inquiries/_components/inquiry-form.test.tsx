// 기준: Figma I01 문의하기 · 회원(제목 카운터 'N / 100' · 내용 · 사진 칸 · [문의 보내기]) · 기획 메모 I01
// · Swagger 9.1 문의 작성(InquiryCreateRequest) · 9.11 → 9.1 attachmentKeys
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { FormActionResult } from "@/lib/api/problem-detail";
import { createInquiry } from "@/lib/inquiry/actions";
import { uploadInquiryPhotos } from "@/lib/inquiry/upload-photos";
import { RETRY_LATER } from "@/lib/messages";
import { deferred } from "@/test/deferred";
import { flushPromises } from "@/test/flush";
import { router } from "@/test/next-navigation";

import { InquiryForm } from "./inquiry-form";

// 경계 mock: 서버 액션(9.1), 사진 올리기(9.11 + S3 PUT), Next 라우터(bfcacheId), 연출(motion),
// 미리보기 주소(URL 속성만, 테스트마다 되돌아간다)
vi.mock("@/lib/inquiry/actions", () => ({ createInquiry: vi.fn() }));
vi.mock("@/lib/inquiry/upload-photos", () => ({ uploadInquiryPhotos: vi.fn() }));
vi.mock("next/navigation", () => import("@/test/next-navigation"));
vi.mock("motion/react", async (importOriginal) =>
  (await import("@/test/motion")).reducedMotion(importOriginal),
);
beforeEach(() => {
  vi.spyOn(URL, "createObjectURL").mockImplementation((file) => `blob:${(file as File).name}`);
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
});

// 예시 데이터: Swagger 9.1 요청 예시 · 404 FILE_NOT_FOUND 문구
const VALUES = { title: "비밀번호를 잊어버렸어요", content: "비밀번호를 바꿔 주세요." };
const FILE_NOT_FOUND = "업로드한 파일을 찾을 수 없어요.";
const photo = (name: string) => new File([new Uint8Array(10)], name, { type: "image/png" });

const titleInput = () => screen.getByRole<HTMLInputElement>("textbox", { name: "제목" });
const submitButton = () => screen.getByRole("button", { name: "문의 보내기" });
function fill(values = VALUES) {
  fireEvent.change(titleInput(), { target: { value: values.title } });
  fireEvent.change(screen.getByRole("textbox", { name: "내용" }), {
    target: { value: values.content },
  });
}
async function submit() {
  fireEvent.click(submitButton());
  await flushPromises();
}

describe("InquiryForm · 문의하기(회원)", () => {
  describe("사용자 조작", () => {
    it("보내면 고른 사진을 올린 뒤 그 키와 함께 문의를 쓴다", async () => {
      const a = photo("a.png");
      vi.mocked(uploadInquiryPhotos).mockResolvedValue({ keys: ["inquiry/a.png"] });
      vi.mocked(createInquiry).mockResolvedValue({});
      render(<InquiryForm />);
      fill();
      fireEvent.change(screen.getByLabelText("사진 파일"), { target: { files: [a] } });

      await submit();

      expect(uploadInquiryPhotos).toHaveBeenCalledWith([a]);
      expect(createInquiry).toHaveBeenCalledWith(VALUES, ["inquiry/a.png"]);
      expect(vi.mocked(uploadInquiryPhotos).mock.invocationCallOrder[0]).toBeLessThan(
        vi.mocked(createInquiry).mock.invocationCallOrder[0],
      );
    });
  });

  describe("상태 변화", () => {
    it("새로 들어오면(다른 bfcacheId) 지난 입력을 비운다", () => {
      const { rerender } = render(<InquiryForm />);
      fill();

      router.bfcacheId = "entry-2";
      rerender(<InquiryForm />);

      expect(titleInput().value).toBe("");
    });
  });

  describe("입력 검증", () => {
    it("제목 · 내용이 비면 사진을 올리지도 보내지도 않고 칸마다 문구를 보여 준다", async () => {
      render(<InquiryForm />);

      await submit();

      expect(
        screen.getByRole("textbox", { name: "제목", description: "필수 값입니다." }),
      ).toBeDefined();
      expect(
        screen.getByRole("textbox", { name: "내용", description: "필수 값입니다." }),
      ).toBeDefined();
      expect(uploadInquiryPhotos).not.toHaveBeenCalled();
      expect(createInquiry).not.toHaveBeenCalled();
    });
  });

  describe("오류 처리", () => {
    it("사진을 올리지 못하면 문의를 쓰지 않고 버튼 아래에 문구를 보여 준다", async () => {
      vi.mocked(uploadInquiryPhotos).mockResolvedValue({ error: RETRY_LATER });
      render(<InquiryForm />);
      fill();

      await submit();

      expect(createInquiry).not.toHaveBeenCalled();
      expect(screen.getByRole("alert").textContent).toBe(RETRY_LATER);
    });

    it("서버가 폼 오류를 주면 버튼 아래에 문구를 보여 준다", async () => {
      vi.mocked(uploadInquiryPhotos).mockResolvedValue({ keys: [] });
      vi.mocked(createInquiry).mockResolvedValue({ formError: FILE_NOT_FOUND });
      render(<InquiryForm />);
      fill();

      await submit();

      expect(screen.getByRole("alert").textContent).toBe(FILE_NOT_FOUND);
    });

    it("다시 보내면 지난 폼 오류를 지운다", async () => {
      const retry = deferred<FormActionResult<"title" | "content">>();
      vi.mocked(uploadInquiryPhotos).mockResolvedValue({ keys: [] });
      vi.mocked(createInquiry)
        .mockResolvedValueOnce({ formError: FILE_NOT_FOUND })
        .mockReturnValueOnce(retry.promise);
      render(<InquiryForm />);
      fill();
      await submit();

      await submit();

      expect(screen.queryByRole("alert")).toBeNull();
      await act(async () => retry.resolve({}));
    });
  });

  describe("중복 · 경쟁 처리", () => {
    it("보내는 동안에는 [문의 보내기]와 사진 칸을 누를 수 없다", async () => {
      const saving = deferred<FormActionResult<"title" | "content">>();
      vi.mocked(uploadInquiryPhotos).mockResolvedValue({ keys: [] });
      vi.mocked(createInquiry).mockReturnValue(saving.promise);
      render(<InquiryForm />);
      fill();

      await submit();

      expect(submitButton().hasAttribute("disabled")).toBe(true);
      expect(screen.getByRole("button", { name: "사진 추가" }).hasAttribute("disabled")).toBe(true);
      await act(async () => saving.resolve({}));
    });
  });
});
