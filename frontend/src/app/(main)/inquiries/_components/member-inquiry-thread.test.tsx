// 기준: 기획 메모 I03(회원: 로그인 토큰으로 9.4 · 9.5, 없는 문의(404)면 I02로) · Swagger 9.4 · 9.5 404 INQUIRY_NOT_FOUND
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { addInquiryMessage, closeInquiry } from "@/lib/inquiry/actions";
import { uploadInquiryPhotos } from "@/lib/inquiry/upload-photos";
import { ROUTES } from "@/lib/routes";
import { flushPromises } from "@/test/flush";
import { router } from "@/test/next-navigation";
import type { InquiryResponse } from "@/types/api";

import { MemberInquiryThread } from "./member-inquiry-thread";

// 경계 mock: 서버 액션(9.4 · 9.5), 사진 올리기(9.11 + S3 PUT), Next 라우터, 연출(motion)
vi.mock("@/lib/inquiry/actions", () => ({ addInquiryMessage: vi.fn(), closeInquiry: vi.fn() }));
vi.mock("@/lib/inquiry/upload-photos", () => ({ uploadInquiryPhotos: vi.fn() }));
vi.mock("next/navigation", () => import("@/test/next-navigation"));
vi.mock("motion/react", async (importOriginal) =>
  (await import("@/test/motion")).reducedMotion(importOriginal),
);

// 예시 데이터: Swagger 9.3 200 예시(사진 없이) · 9.4 · 9.5 404 · 9.4 409 문구
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
const NOT_FOUND = { error: "문의를 찾을 수 없어요.", notFound: true as const };

async function sendMessage() {
  vi.mocked(uploadInquiryPhotos).mockResolvedValue({ keys: [] });
  fireEvent.change(screen.getByRole("textbox", { name: "이어서 쓰기" }), {
    target: { value: "확인 부탁드려요." },
  });
  fireEvent.click(screen.getByRole("button", { name: "보내기" }));
  await flushPromises();
}
async function closeThread() {
  fireEvent.click(screen.getByRole("button", { name: "문의 종료" }));
  fireEvent.click(screen.getByRole("button", { name: "종료" }));
  await flushPromises();
}

describe("MemberInquiryThread · 문의 상세(회원)", () => {
  describe("오류 처리", () => {
    it.each([
      {
        label: "이어서 쓰기",
        fail: () => vi.mocked(addInquiryMessage).mockResolvedValue(NOT_FOUND),
        run: sendMessage,
      },
      {
        label: "종료",
        fail: () => vi.mocked(closeInquiry).mockResolvedValue(NOT_FOUND),
        run: closeThread,
      },
    ])("'$label'에서 없는 문의(404)면 내 문의 목록으로 바꿔치기해 간다", async ({ fail, run }) => {
      fail();
      render(<MemberInquiryThread inquiry={INQUIRY} />);

      await run();

      expect(router.replace).toHaveBeenCalledWith(ROUTES.inquiries);
    });

    it("없는 문의가 아닌 실패면 이동하지 않는다", async () => {
      vi.mocked(addInquiryMessage).mockResolvedValue({
        error: "종료한 문의예요.",
        closed: true,
      });
      render(<MemberInquiryThread inquiry={INQUIRY} />);

      await sendMessage();

      expect(addInquiryMessage).toHaveBeenCalledTimes(1);
      expect(router.replace).not.toHaveBeenCalled();
    });
  });
});
