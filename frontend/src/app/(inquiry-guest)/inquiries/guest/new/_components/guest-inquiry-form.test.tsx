// 기준: Figma I01-B 문의하기 · 비회원 · I01-1 문의 접수 완료 · 기획 메모 I01-B · I01-1([확인] → I03 그 문의)
// · Swagger 9.1 문의 작성(InquiryCreateRequest) · 9.11 → 9.1 attachmentKeys · 사용자 결정(2026-10-30: [필수] 개인정보 수집 · 이용 동의)
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createGuestInquiry } from "@/lib/inquiry/actions";
import { uploadInquiryPhotos } from "@/lib/inquiry/upload-photos";
import { GUEST_INQUIRY_CONSENT } from "@/lib/legal/documents";
import { RETRY_LATER } from "@/lib/messages";
import { ROUTES } from "@/lib/routes";
import { useGuestInquiryStore } from "@/stores/guest-inquiry-store";
import { deferred } from "@/test/deferred";
import { flushPromises } from "@/test/flush";
import { router } from "@/test/next-navigation";

import { GuestInquiryForm } from "./guest-inquiry-form";

// 경계 mock: 서버 액션(9.1), 사진 올리기(9.11 + S3 PUT), Next 라우터(replace · bfcacheId), 연출(motion),
// 미리보기 주소(URL 속성만, 테스트마다 되돌아간다)
vi.mock("@/lib/inquiry/actions", () => ({ createGuestInquiry: vi.fn() }));
vi.mock("@/lib/inquiry/upload-photos", () => ({ uploadInquiryPhotos: vi.fn() }));
vi.mock("next/navigation", () => import("@/test/next-navigation"));
vi.mock("motion/react", async (importOriginal) =>
  (await import("@/test/motion")).reducedMotion(importOriginal),
);
beforeEach(() => {
  useGuestInquiryStore.setState({ inquiryId: null, accessPassword: null });
  vi.spyOn(URL, "createObjectURL").mockImplementation((file) => `blob:${(file as File).name}`);
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
});

// 예시 데이터: Swagger 9.1 요청 · 201 예시(문의번호 7) · 404 FILE_NOT_FOUND 문구
const VALUES = {
  email: "a@ssafy.com",
  accessPassword: "1234",
  title: "비밀번호를 잊어버렸어요",
  content: "비밀번호를 바꿔 주세요.",
};
const FILE_NOT_FOUND = "업로드한 파일을 찾을 수 없어요.";
const photo = (name: string) => new File([new Uint8Array(10)], name, { type: "image/png" });
type Created = Awaited<ReturnType<typeof createGuestInquiry>>;

const emailInput = () => screen.getByRole<HTMLInputElement>("textbox", { name: "이메일" });
const passwordInput = () => screen.getByLabelText<HTMLInputElement>("조회 비밀번호");
const titleInput = () => screen.getByRole<HTMLInputElement>("textbox", { name: "제목" });
const submitButton = () => screen.getByRole("button", { name: "문의 보내기" });
const createdDialog = () => screen.queryByRole("dialog", { name: "문의를 남겼어요" });
/** 입력칸 아래 문구(aria-describedby). 없으면 undefined */
const messageOf = (input: HTMLElement) =>
  document.getElementById(input.getAttribute("aria-describedby") ?? "")?.textContent ?? undefined;

function fill(
  { agree, ...values }: typeof VALUES & { agree: boolean } = { ...VALUES, agree: true },
) {
  fireEvent.change(emailInput(), { target: { value: values.email } });
  fireEvent.change(passwordInput(), { target: { value: values.accessPassword } });
  fireEvent.change(titleInput(), { target: { value: values.title } });
  fireEvent.change(screen.getByRole("textbox", { name: "내용" }), {
    target: { value: values.content },
  });
  if (agree) {
    fireEvent.click(screen.getByRole("checkbox", { name: "[필수] 개인정보 수집 · 이용 동의" }));
  }
}
async function submit() {
  fireEvent.click(submitButton());
  await flushPromises();
}
/** 문의를 남겨 완료 모달까지 띄운다 */
async function created(inquiryId = 7) {
  vi.mocked(uploadInquiryPhotos).mockResolvedValue({ keys: [] });
  vi.mocked(createGuestInquiry).mockResolvedValue({ inquiryId });
  fill();
  await submit();
}

describe("GuestInquiryForm · 문의하기(비회원)", () => {
  describe("문의 작성", () => {
    describe("사용자 조작", () => {
      it("보내면 동의 여부는 빼고 이메일 · 조회 비밀번호 · 제목 · 내용을 올린 사진 키와 함께 보낸다", async () => {
        const a = photo("a.png");
        vi.mocked(uploadInquiryPhotos).mockResolvedValue({ keys: ["inquiry/a.png"] });
        vi.mocked(createGuestInquiry).mockResolvedValue({ inquiryId: 7 });
        render(<GuestInquiryForm />);
        fill();
        fireEvent.change(screen.getByLabelText("사진 파일"), { target: { files: [a] } });

        await submit();

        expect(uploadInquiryPhotos).toHaveBeenCalledWith([a]);
        expect(createGuestInquiry).toHaveBeenCalledWith(VALUES, ["inquiry/a.png"]);
      });
    });

    describe("상태 변화", () => {
      it("새로 들어오면(다른 bfcacheId) 지난 입력과 완료 모달을 비운다", async () => {
        const { rerender } = render(<GuestInquiryForm />);
        await created();

        router.bfcacheId = "entry-2";
        rerender(<GuestInquiryForm />);

        expect(createdDialog()).toBeNull();
        expect(emailInput().value).toBe("");
        expect(titleInput().value).toBe("");
      });
    });

    describe("입력 검증", () => {
      it("개인정보 수집 · 이용에 동의하지 않으면 보내지 않고 동의 문구를 보여 준다", async () => {
        render(<GuestInquiryForm />);
        fill({ ...VALUES, agree: false });

        await submit();

        expect(screen.getByRole("alert").textContent).toBe("개인정보 수집 · 이용에 동의해 주세요.");
        expect(uploadInquiryPhotos).not.toHaveBeenCalled();
        expect(createGuestInquiry).not.toHaveBeenCalled();
      });

      it("이메일 · 조회 비밀번호가 규칙에 맞지 않으면 보내지 않고 칸마다 문구를 보여 준다", async () => {
        render(<GuestInquiryForm />);
        fill({ ...VALUES, email: "a-ssafy.com", accessPassword: "123", agree: true });

        await submit();

        expect(messageOf(emailInput())).toBe("이메일 형식이 아닙니다.");
        expect(messageOf(passwordInput())).toBe("4~20자입니다.");
        expect(createGuestInquiry).not.toHaveBeenCalled();
      });
    });

    describe("오류 처리", () => {
      it("사진을 올리지 못하면 문의를 쓰지 않고 버튼 아래에 문구를 보여 준다", async () => {
        vi.mocked(uploadInquiryPhotos).mockResolvedValue({ error: RETRY_LATER });
        render(<GuestInquiryForm />);
        fill();

        await submit();

        expect(createGuestInquiry).not.toHaveBeenCalled();
        expect(screen.getByRole("alert").textContent).toBe(RETRY_LATER);
      });

      it("서버가 폼 오류를 주면 버튼 아래에 문구를 보여 준다", async () => {
        vi.mocked(uploadInquiryPhotos).mockResolvedValue({ keys: [] });
        vi.mocked(createGuestInquiry).mockResolvedValue({ formError: FILE_NOT_FOUND });
        render(<GuestInquiryForm />);
        fill();

        await submit();

        expect(screen.getByRole("alert").textContent).toBe(FILE_NOT_FOUND);
        expect(createdDialog()).toBeNull();
      });

      it("다시 보내면 지난 폼 오류를 지운다", async () => {
        const retry = deferred<Created>();
        vi.mocked(uploadInquiryPhotos).mockResolvedValue({ keys: [] });
        vi.mocked(createGuestInquiry)
          .mockResolvedValueOnce({ formError: FILE_NOT_FOUND })
          .mockReturnValueOnce(retry.promise);
        render(<GuestInquiryForm />);
        fill();
        await submit();

        await submit();

        expect(screen.queryByRole("alert")).toBeNull();
        await act(async () => retry.resolve({ formError: FILE_NOT_FOUND }));
      });
    });

    describe("중복 · 경쟁 처리", () => {
      it("보내는 동안에는 [문의 보내기]를 누를 수 없다", async () => {
        const saving = deferred<Created>();
        vi.mocked(uploadInquiryPhotos).mockResolvedValue({ keys: [] });
        vi.mocked(createGuestInquiry).mockReturnValue(saving.promise);
        render(<GuestInquiryForm />);
        fill();

        await submit();

        expect(submitButton().hasAttribute("disabled")).toBe(true);
        await act(async () => saving.resolve({ inquiryId: 7 }));
      });
    });
  });

  describe("접수 완료", () => {
    describe("화면 표시", () => {
      it("접수되면 받은 문의번호를 완료 모달에 보여 준다", async () => {
        render(<GuestInquiryForm />);

        await created(7);

        expect(within(createdDialog()!).getByText("7")).toBeDefined();
      });
    });

    describe("사용자 조작", () => {
      it("[확인]을 누르면 문의번호 · 조회 비밀번호를 기억하고 문의 확인 화면으로 바꿔치기해 간다", async () => {
        render(<GuestInquiryForm />);
        await created(7);

        fireEvent.click(within(createdDialog()!).getByRole("button", { name: "확인" }));

        expect(useGuestInquiryStore.getState()).toMatchObject({
          inquiryId: 7,
          accessPassword: "1234",
        });
        expect(router.replace).toHaveBeenCalledWith(ROUTES.guestInquiry);
      });
    });
  });

  describe("동의 보기", () => {
    describe("사용자 조작", () => {
      it("[보기]를 누르면 동의서 모달을 열고 [확인]으로 닫는다", () => {
        render(<GuestInquiryForm />);

        fireEvent.click(
          screen.getByRole("button", { name: `${GUEST_INQUIRY_CONSENT.title} 보기` }),
        );
        const consent = screen.getByRole("dialog", { name: GUEST_INQUIRY_CONSENT.title });
        fireEvent.click(within(consent).getByRole("button", { name: "확인" }));

        expect(screen.queryByRole("dialog", { name: GUEST_INQUIRY_CONSENT.title })).toBeNull();
      });
    });
  });
});
