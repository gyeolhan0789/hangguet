// 기준: Figma I04 비회원 문의 확인 · 기획 메모 I04(문의번호 · 조회 비밀번호 → 9.3 → I03, 404는 서버 문구) · I03(비회원은 9.3 ~ 9.5에
// 조회 비밀번호를 함께 보낸다, 없는 문의(404)면 I04로) · I01-1 [확인] → 바로 열기 · Swagger 9.3 · 9.4 · 9.5
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { addInquiryMessage, closeInquiry, openGuestInquiry } from "@/lib/inquiry/actions";
import { uploadInquiryPhotos } from "@/lib/inquiry/upload-photos";
import { RETRY_LATER } from "@/lib/messages";
import { useGuestInquiryStore } from "@/stores/guest-inquiry-store";
import { deferred } from "@/test/deferred";
import { flushPromises } from "@/test/flush";
import { router } from "@/test/next-navigation";
import type { InquiryResponse } from "@/types/api";

import { GuestInquiryView } from "./guest-inquiry-view";

// 경계 mock: 서버 액션(9.3 · 9.4 · 9.5), 사진 올리기(9.11 + S3 PUT), Next 라우터(bfcacheId), 연출(motion)
vi.mock("@/lib/inquiry/actions", () => ({
  openGuestInquiry: vi.fn(),
  addInquiryMessage: vi.fn(),
  closeInquiry: vi.fn(),
}));
vi.mock("@/lib/inquiry/upload-photos", () => ({ uploadInquiryPhotos: vi.fn() }));
vi.mock("next/navigation", () => import("@/test/next-navigation"));
vi.mock("motion/react", async (importOriginal) =>
  (await import("@/test/motion")).reducedMotion(importOriginal),
);

beforeEach(() => {
  useGuestInquiryStore.setState({ inquiryId: null, accessPassword: null });
});

// 예시 데이터: Swagger 9.3 200 예시(사진 없이, 답변 전 · 답변 뒤 · 종료) · 9.3 404 · 9.4 409 문구
const WAITING: InquiryResponse = {
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
const ANSWERED: InquiryResponse = {
  ...WAITING,
  status: "ANSWERED",
  updatedAt: "2026-10-26T11:30:00+09:00",
  messages: [
    ...WAITING.messages,
    {
      id: 22,
      authorType: "ADMIN",
      content: "요청하신 비밀번호로 바꿨어요. 다시 로그인해 주세요.",
      createdAt: "2026-10-26T11:30:00+09:00",
      attachments: [],
    },
  ],
};
const CLOSED: InquiryResponse = { ...WAITING, status: "CLOSED" };
const PASSWORD = "1234";
const NOT_FOUND = "문의를 찾을 수 없어요.";

const idInput = () => screen.getByRole<HTMLInputElement>("textbox", { name: "문의번호" });
const passwordInput = () => screen.getByLabelText<HTMLInputElement>("조회 비밀번호");
const confirmButton = () => screen.getByRole("button", { name: "확인" });
/** 입력칸 아래 문구(aria-describedby). 없으면 undefined */
const messageOf = (input: HTMLElement) =>
  document.getElementById(input.getAttribute("aria-describedby") ?? "")?.textContent ?? undefined;

async function lookUp(inquiryId = "7", accessPassword = PASSWORD) {
  fireEvent.change(idInput(), { target: { value: inquiryId } });
  fireEvent.change(passwordInput(), { target: { value: accessPassword } });
  fireEvent.click(confirmButton());
  await flushPromises();
}
/** I01-1 [확인]으로 온 것처럼 기억한 문의를 두고 그린다 */
async function renderRemembered() {
  useGuestInquiryStore.setState({ inquiryId: 7, accessPassword: PASSWORD });
  const view = render(<GuestInquiryView />);
  await flushPromises();
  return view;
}
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

describe("GuestInquiryView · 비회원 문의 확인", () => {
  describe("문의 확인", () => {
    describe("사용자 조작", () => {
      it("확인되면 그 문의를 열고 문의번호 · 조회 비밀번호를 기억한다", async () => {
        vi.mocked(openGuestInquiry).mockResolvedValue({ inquiry: WAITING });
        render(<GuestInquiryView />);

        await lookUp();

        expect(screen.getByRole("heading", { name: "비밀번호를 잊어버렸어요" })).toBeDefined();
        expect(useGuestInquiryStore.getState()).toMatchObject({
          inquiryId: 7,
          accessPassword: PASSWORD,
        });
      });
    });

    describe("입력 검증", () => {
      it("문의번호가 양의 정수가 아니면 요청하지 않고 문의번호 칸에 문구를 보여 준다", async () => {
        render(<GuestInquiryView />);

        await lookUp("0");

        expect(messageOf(idInput())).toBe(NOT_FOUND);
        expect(openGuestInquiry).not.toHaveBeenCalled();
      });
    });

    describe("오류 처리", () => {
      it("없는 문의 · 틀린 조회 비밀번호(404)면 조회 비밀번호 칸 아래에 서버 문구를 보여 준다", async () => {
        vi.mocked(openGuestInquiry).mockResolvedValue({ formError: NOT_FOUND });
        render(<GuestInquiryView />);

        await lookUp("7", "0000");

        expect(messageOf(passwordInput())).toBe(NOT_FOUND);
      });

      it("다시 확인하면 지난 서버 문구를 지운다", async () => {
        const retry = deferred<Awaited<ReturnType<typeof openGuestInquiry>>>();
        vi.mocked(openGuestInquiry)
          .mockResolvedValueOnce({ formError: NOT_FOUND })
          .mockReturnValueOnce(retry.promise);
        render(<GuestInquiryView />);
        await lookUp("7", "0000");

        await lookUp();

        expect(messageOf(passwordInput())).toBeUndefined();
        await act(async () => retry.resolve({ formError: NOT_FOUND }));
      });
    });

    describe("중복 · 경쟁 처리", () => {
      it("확인하는 동안에는 [확인]을 누를 수 없다", async () => {
        const opening = deferred<Awaited<ReturnType<typeof openGuestInquiry>>>();
        vi.mocked(openGuestInquiry).mockReturnValue(opening.promise);
        render(<GuestInquiryView />);

        await lookUp();

        expect(confirmButton().hasAttribute("disabled")).toBe(true);
        await act(async () => opening.resolve({ inquiry: WAITING }));
      });
    });
  });

  describe("접수 직후 바로 열기", () => {
    describe("화면 표시", () => {
      it("기억한 문의번호 · 조회 비밀번호가 있으면 처음 그릴 때 그 문의를 연다", async () => {
        vi.mocked(openGuestInquiry).mockResolvedValue({ inquiry: WAITING });

        await renderRemembered();

        expect(openGuestInquiry).toHaveBeenCalledWith({ inquiryId: "7", accessPassword: PASSWORD });
        expect(screen.getByRole("heading", { name: "비밀번호를 잊어버렸어요" })).toBeDefined();
      });
    });

    describe("상태 변화", () => {
      it("새로 들어오면(다른 bfcacheId) 기억한 문의를 다시 연다", async () => {
        vi.mocked(openGuestInquiry).mockResolvedValue({ inquiry: WAITING });
        const { rerender } = await renderRemembered();

        router.bfcacheId = "entry-2";
        rerender(<GuestInquiryView />);
        await flushPromises();

        expect(openGuestInquiry).toHaveBeenCalledTimes(2);
      });
    });

    describe("중복 · 경쟁 처리", () => {
      it("다시 그려도 기억한 문의를 한 번만 연다", async () => {
        vi.mocked(openGuestInquiry).mockResolvedValue({ inquiry: WAITING });
        const { rerender } = await renderRemembered();

        rerender(<GuestInquiryView />);
        await flushPromises();

        expect(openGuestInquiry).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe("연 문의", () => {
    describe("사용자 조작", () => {
      it("'‹ 내 문의'를 누르면 기억을 지우고 빈 확인 폼으로 돌아간다", async () => {
        vi.mocked(openGuestInquiry).mockResolvedValue({ inquiry: WAITING });
        render(<GuestInquiryView />);
        await lookUp();

        fireEvent.click(screen.getByRole("button", { name: "내 문의" }));

        expect(useGuestInquiryStore.getState()).toMatchObject({
          inquiryId: null,
          accessPassword: null,
        });
        expect(idInput().value).toBe("");
        expect(passwordInput().value).toBe("");
      });

      it.each([
        {
          label: "이어서 쓰기",
          write: () => vi.mocked(addInquiryMessage).mockResolvedValue({}),
          run: sendMessage,
          called: () => vi.mocked(addInquiryMessage).mock.calls[0],
          reloaded: ANSWERED,
          shown: "요청하신 비밀번호로 바꿨어요. 다시 로그인해 주세요.",
        },
        {
          label: "종료",
          write: () => vi.mocked(closeInquiry).mockResolvedValue({ ok: true }),
          run: closeThread,
          called: () => vi.mocked(closeInquiry).mock.calls[0],
          reloaded: CLOSED,
          shown: "종료한 문의예요.",
        },
      ])(
        "'$label'에 성공하면 기억한 조회 비밀번호로 부르고 그 문의를 다시 불러 새 상태로 그린다",
        async ({ write, run, called, reloaded, shown }) => {
          vi.mocked(openGuestInquiry)
            .mockResolvedValueOnce({ inquiry: WAITING })
            .mockResolvedValueOnce({ inquiry: reloaded });
          write();
          await renderRemembered();

          await run();

          expect(called().at(-1)).toBe(PASSWORD);
          expect(vi.mocked(openGuestInquiry).mock.calls[1][0]).toEqual({
            inquiryId: "7",
            accessPassword: PASSWORD,
          });
          expect(screen.getByText(shown)).toBeDefined();
        },
      );
    });

    describe("오류 처리", () => {
      it("그 사이 종료됐으면(409) 그 문의를 다시 불러 종료 상태로 그린다", async () => {
        vi.mocked(openGuestInquiry)
          .mockResolvedValueOnce({ inquiry: WAITING })
          .mockResolvedValueOnce({ inquiry: CLOSED });
        vi.mocked(addInquiryMessage).mockResolvedValue({ error: "종료한 문의예요.", closed: true });
        await renderRemembered();

        await sendMessage();

        expect(openGuestInquiry).toHaveBeenCalledTimes(2);
        expect(screen.queryByRole("textbox", { name: "이어서 쓰기" })).toBeNull();
        expect(screen.getByText("종료한 문의예요.")).toBeDefined();
      });

      it("종료가 아닌 실패면 다시 불러오지 않는다", async () => {
        vi.mocked(openGuestInquiry).mockResolvedValue({ inquiry: WAITING });
        vi.mocked(addInquiryMessage).mockResolvedValue({ error: RETRY_LATER });
        await renderRemembered();

        await sendMessage();

        expect(addInquiryMessage).toHaveBeenCalledTimes(1);
        expect(openGuestInquiry).toHaveBeenCalledTimes(1);
      });

      it("없는 문의(404)면 기억을 지우고 확인 폼으로 돌아간다", async () => {
        vi.mocked(openGuestInquiry).mockResolvedValue({ inquiry: WAITING });
        vi.mocked(addInquiryMessage).mockResolvedValue({ error: NOT_FOUND, notFound: true });
        await renderRemembered();

        await sendMessage();

        expect(useGuestInquiryStore.getState()).toMatchObject({
          inquiryId: null,
          accessPassword: null,
        });
        expect(screen.getByRole("heading", { name: "문의 확인" })).toBeDefined();
        expect(openGuestInquiry).toHaveBeenCalledTimes(1);
      });

      it("다시 불러오기가 실패하면 지금 문의를 그대로 보여 준다", async () => {
        vi.mocked(openGuestInquiry)
          .mockResolvedValueOnce({ inquiry: WAITING })
          .mockResolvedValueOnce({ formError: RETRY_LATER });
        vi.mocked(addInquiryMessage).mockResolvedValue({});
        await renderRemembered();

        await sendMessage();

        expect(openGuestInquiry).toHaveBeenCalledTimes(2);
        expect(screen.getByRole("heading", { name: "비밀번호를 잊어버렸어요" })).toBeDefined();
        expect(screen.queryByRole("heading", { name: "문의 확인" })).toBeNull();
      });
    });
  });
});
