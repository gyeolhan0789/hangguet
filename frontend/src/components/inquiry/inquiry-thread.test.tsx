// 기준: Figma I03 문의 상세 · I03-1 문의 종료 확인 · 기획 메모 I03 · I03-1 · Swagger 9.3 InquiryResponse · 9.4 이어서 쓰기 · 9.5 종료
// · 사용자 결정(2026-11-03: 말풍선 아래 사진(누르면 원본 새 탭), 이어서 쓰기는 사진을 붙이는 입력 상자)
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { InquiryWriteResult } from "@/lib/inquiry/actions";
import { RETRY_LATER } from "@/lib/messages";
import { uploadInquiryPhotos } from "@/lib/inquiry/upload-photos";
import { ROUTES } from "@/lib/routes";
import { deferred } from "@/test/deferred";
import { flushPromises } from "@/test/flush";
import type { InquiryResponse } from "@/types/api";

import { InquiryThread } from "./inquiry-thread";

// 경계 mock: 사진 올리기(9.11 + S3 PUT), 연출(motion), 미리보기 주소(URL 속성만, 테스트마다 되돌아간다)
vi.mock("@/lib/inquiry/upload-photos", () => ({ uploadInquiryPhotos: vi.fn() }));
vi.mock("motion/react", async (importOriginal) =>
  (await import("@/test/motion")).reducedMotion(importOriginal),
);
beforeEach(() => {
  vi.spyOn(URL, "createObjectURL").mockImplementation((file) => `blob:${(file as File).name}`);
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
});

// 예시 데이터: Swagger 9.3 200 예시(내 질문(사진 1장) + 운영자 답변)
const PHOTO_URL = "https://…s3…/inquiry/7f3c….png?X-Amz-Signature=…";
const ANSWERED: InquiryResponse = {
  id: 7,
  title: "비밀번호를 잊어버렸어요",
  status: "ANSWERED",
  createdAt: "2026-10-26T10:00:00+09:00",
  updatedAt: "2026-10-26T11:30:00+09:00",
  messages: [
    {
      id: 21,
      authorType: "USER",
      content: "가입한 이메일은 a@ssafy.com이에요. 비밀번호를 바꿔 주세요.",
      createdAt: "2026-10-26T10:00:00+09:00",
      attachments: [{ id: 3, url: PHOTO_URL }],
    },
    {
      id: 22,
      authorType: "ADMIN",
      content: "요청하신 비밀번호로 바꿨어요. 다시 로그인해 주세요.",
      createdAt: "2026-10-26T11:30:00+09:00",
      attachments: [],
    },
  ],
};
const CLOSED: InquiryResponse = { ...ANSWERED, status: "CLOSED" };
const NO_PHOTOS: InquiryResponse = {
  ...ANSWERED,
  messages: ANSWERED.messages.map((message) => ({ ...message, attachments: [] })),
};
const SENT = {
  message: {
    id: 23,
    authorType: "USER",
    content: "확인 부탁드려요.",
    createdAt: "2026-10-26T12:00:00+09:00",
    attachments: [],
  },
} satisfies InquiryWriteResult;
const NOT_FOUND = { error: "문의를 찾을 수 없어요.", notFound: true } satisfies InquiryWriteResult;

const photo = (name: string, type = "image/png") => new File([new Uint8Array(10)], name, { type });

function renderThread({
  inquiry = ANSWERED,
  onSend = vi.fn(),
  onClose = vi.fn(),
}: {
  inquiry?: InquiryResponse;
  onSend?: (question: {
    content: string;
    attachmentKeys?: string[] | null;
  }) => Promise<InquiryWriteResult>;
  onClose?: () => Promise<InquiryWriteResult>;
} = {}) {
  render(
    <InquiryThread
      inquiry={inquiry}
      back={{ label: "내 문의", href: ROUTES.inquiries }}
      onSend={onSend}
      onClose={onClose}
    />,
  );
  return { onSend, onClose };
}

const textbox = () => screen.getByRole<HTMLTextAreaElement>("textbox", { name: "이어서 쓰기" });
const sendButton = () => screen.getByRole("button", { name: "보내기" });
const tiles = () => screen.queryAllByRole("img", { name: /고른 사진/ });
const write = (content: string) => fireEvent.change(textbox(), { target: { value: content } });
const pick = (files: File[]) =>
  fireEvent.change(screen.getByLabelText("사진 파일"), { target: { files } });
async function send() {
  fireEvent.click(sendButton());
  await flushPromises();
}
const openConfirm = () => fireEvent.click(screen.getByRole("button", { name: "문의 종료" }));
const confirmDialog = () => screen.queryByRole("dialog", { name: "문의를 종료할까요?" });
async function confirmClose() {
  fireEvent.click(screen.getByRole("button", { name: "종료" }));
  await flushPromises();
}

describe("InquiryThread · 문의 상세", () => {
  describe("문의 머리 · 메시지", () => {
    describe("화면 표시", () => {
      it("내 질문과 운영자 답변을 보여 주고 답변에만 '운영자'를 붙인다", () => {
        renderThread({ inquiry: NO_PHOTOS });

        const [question, answer] = within(
          screen.getByRole("list", { name: "주고받은 메시지" }),
        ).getAllByRole("listitem");
        expect(question.textContent).toContain("비밀번호를 바꿔 주세요.");
        expect(question.textContent).not.toContain("운영자");
        expect(answer.textContent).toContain("운영자");
        expect(answer.textContent).toContain("요청하신 비밀번호로 바꿨어요.");
      });

      it("메시지 시각을 'MM.DD HH:mm'으로 보여 준다", () => {
        renderThread();

        expect(screen.getByText("10.26 10:00")).toBeDefined();
        expect(screen.getByText("10.26 11:30")).toBeDefined();
      });

      it("붙인 사진이 없으면 사진 칸을 그리지 않는다", () => {
        renderThread({ inquiry: NO_PHOTOS });

        expect(screen.queryByRole("list", { name: "붙인 사진" })).toBeNull();
      });

      it("종료한 문의면 입력칸과 [문의 종료] 대신 '종료한 문의예요.'를 보여 준다", () => {
        renderThread({ inquiry: CLOSED });

        expect(screen.getByText("종료한 문의예요.")).toBeDefined();
        expect(screen.queryByRole("textbox", { name: "이어서 쓰기" })).toBeNull();
        expect(screen.queryByRole("button", { name: "문의 종료" })).toBeNull();
      });
    });
  });

  describe("이어서 쓰기", () => {
    describe("사용자 조작", () => {
      it("보내면 고른 사진을 올린 키와 함께 쓰고 끝나면 칸과 고른 사진을 비운다", async () => {
        const a = photo("a.png");
        vi.mocked(uploadInquiryPhotos).mockResolvedValue({ keys: ["inquiry/a.png"] });
        const { onSend } = renderThread({ onSend: vi.fn().mockResolvedValue(SENT) });
        write("확인 부탁드려요.");
        pick([a]);

        await send();

        expect(uploadInquiryPhotos).toHaveBeenCalledWith([a]);
        expect(onSend).toHaveBeenCalledWith({
          content: "확인 부탁드려요.",
          attachmentKeys: ["inquiry/a.png"],
        });
        expect(textbox().value).toBe("");
        expect(tiles()).toHaveLength(0);
      });
    });

    describe("입력 검증", () => {
      it("내용이 비면 보내지 않고 칸 아래에 문구를 보여 준다", async () => {
        const { onSend } = renderThread();

        await send();

        expect(screen.getByRole("alert").textContent).toBe("필수 값입니다.");
        expect(uploadInquiryPhotos).not.toHaveBeenCalled();
        expect(onSend).not.toHaveBeenCalled();
      });

      it("고른 사진이 규칙에 맞지 않으면 문구만 보이고 입력칸은 오류로 표시하지 않는다", () => {
        renderThread();

        pick([photo("a.gif", "image/gif")]);

        expect(screen.getByRole("alert").textContent).toBe("JPG·PNG만 올릴 수 있습니다.");
        expect(textbox().getAttribute("aria-invalid")).toBeNull();
      });

      it("내용이 비고 고른 사진도 규칙에 맞지 않으면 내용 문구를 보여 준다", async () => {
        renderThread();
        pick([photo("a.gif", "image/gif")]);

        await send();

        expect(screen.getByRole("alert").textContent).toBe("필수 값입니다.");
      });
    });

    describe("오류 처리", () => {
      it("사진을 올리지 못하면 보내지 않고 문구를 보여 주며 쓴 글과 고른 사진은 남긴다", async () => {
        vi.mocked(uploadInquiryPhotos).mockResolvedValue({ error: RETRY_LATER });
        const { onSend } = renderThread();
        write("확인 부탁드려요.");
        pick([photo("a.png")]);

        await send();

        expect(onSend).not.toHaveBeenCalled();
        expect(screen.getByRole("alert").textContent).toBe(RETRY_LATER);
        expect(textbox().value).toBe("확인 부탁드려요.");
        expect(tiles()).toHaveLength(1);
      });

      it("보내기가 실패하면 서버 문구를 칸 아래에 보여 주고 쓴 글은 남긴다", async () => {
        vi.mocked(uploadInquiryPhotos).mockResolvedValue({ keys: [] });
        renderThread({ onSend: vi.fn().mockResolvedValue(NOT_FOUND) });
        write("확인 부탁드려요.");

        await send();

        expect(screen.getByRole("alert").textContent).toBe("문의를 찾을 수 없어요.");
        expect(textbox().value).toBe("확인 부탁드려요.");
      });

      it("실패 뒤 다시 보내면 지난 서버 문구를 지운다", async () => {
        vi.mocked(uploadInquiryPhotos).mockResolvedValue({ keys: [] });
        renderThread({
          onSend: vi.fn().mockResolvedValueOnce(NOT_FOUND).mockResolvedValueOnce(SENT),
        });
        write("확인 부탁드려요.");
        await send();

        write("다시 확인 부탁드려요.");
        await send();

        expect(screen.queryByRole("alert")).toBeNull();
      });
    });

    describe("중복 · 경쟁 처리", () => {
      it("보내는 동안에는 [보내기]를 누를 수 없다", async () => {
        const sending = deferred<InquiryWriteResult>();
        vi.mocked(uploadInquiryPhotos).mockResolvedValue({ keys: [] });
        renderThread({ onSend: vi.fn().mockReturnValue(sending.promise) });
        write("확인 부탁드려요.");

        await send();

        expect(sendButton().hasAttribute("disabled")).toBe(true);
        await act(async () => sending.resolve(SENT));
      });
    });
  });

  describe("문의 종료", () => {
    describe("사용자 조작", () => {
      it("[문의 종료]를 누르면 종료 확인 모달을 연다", () => {
        renderThread();

        openConfirm();

        expect(confirmDialog()).not.toBeNull();
      });

      it("[취소]를 누르면 모달을 닫는다", () => {
        renderThread();
        openConfirm();

        fireEvent.click(screen.getByRole("button", { name: "취소" }));

        expect(confirmDialog()).toBeNull();
      });

      it("Esc를 누르면 모달을 닫는다", () => {
        renderThread();
        openConfirm();

        fireEvent.keyDown(document, { key: "Escape" });

        expect(confirmDialog()).toBeNull();
      });

      it("[종료]를 눌러 종료되면 모달을 닫는다", async () => {
        const { onClose } = renderThread({ onClose: vi.fn().mockResolvedValue({ ok: true }) });
        openConfirm();

        await confirmClose();

        expect(onClose).toHaveBeenCalledTimes(1);
        expect(confirmDialog()).toBeNull();
      });
    });

    describe("오류 처리", () => {
      it("종료가 실패하면 모달 안에 서버 문구를 보여 주고 닫지 않는다", async () => {
        renderThread({ onClose: vi.fn().mockResolvedValue(NOT_FOUND) });
        openConfirm();

        await confirmClose();

        const dialog = confirmDialog();
        expect(dialog).not.toBeNull();
        expect(within(dialog!).getByRole("alert").textContent).toBe("문의를 찾을 수 없어요.");
      });

      it("실패 뒤 다시 [종료]를 누르면 지난 서버 문구를 지운다", async () => {
        const retry = deferred<InquiryWriteResult>();
        renderThread({
          onClose: vi.fn().mockResolvedValueOnce(NOT_FOUND).mockReturnValueOnce(retry.promise),
        });
        openConfirm();
        await confirmClose();

        await confirmClose();

        expect(screen.queryByRole("alert")).toBeNull();
        await act(async () => retry.resolve({ ok: true }));
      });
    });

    describe("중복 · 경쟁 처리", () => {
      it("종료 요청 중에는 Esc로 닫지 않고 두 버튼을 누를 수 없다", async () => {
        const closing = deferred<InquiryWriteResult>();
        renderThread({ onClose: vi.fn().mockReturnValue(closing.promise) });
        openConfirm();
        await confirmClose();

        fireEvent.keyDown(document, { key: "Escape" });

        expect(confirmDialog()).not.toBeNull();
        expect(screen.getByRole("button", { name: "취소" }).hasAttribute("disabled")).toBe(true);
        expect(screen.getByRole("button", { name: "종료" }).hasAttribute("disabled")).toBe(true);
        await act(async () => closing.resolve({ ok: true }));
      });
    });

    describe("정리", () => {
      it("모달을 닫으면 Esc를 더 이상 받지 않는다", () => {
        const added = vi.spyOn(document, "addEventListener");
        const removed = vi.spyOn(document, "removeEventListener");
        renderThread();
        openConfirm();
        const onKey = added.mock.calls.find(([type]) => type === "keydown")?.[1];

        fireEvent.click(screen.getByRole("button", { name: "취소" }));

        expect(onKey).toBeDefined();
        expect(removed).toHaveBeenCalledWith("keydown", onKey);
      });
    });
  });
});
