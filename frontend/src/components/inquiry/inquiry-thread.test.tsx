import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MotionGlobalConfig } from "motion/react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { InquiryResponse } from "@/types/api";

import { InquiryThread } from "./inquiry-thread";

// 기준: Figma I03 문의 상세 · I03-1 문의 종료 확인 · 기획 메모 I03 · I03-1 · Swagger 9.3 예시(InquiryResponse)
// · 사용자 결정(2026-11-03: 말풍선 아래 사진(누르면 원본 새 탭), 입력칸 옆 사진 버튼 → 보낼 때 9.11로 올리고 9.4 attachmentKeys)
// 쓰기 · 종료(서버 액션)는 부모가 넘긴 함수라 vi.fn으로 바꾼다. 실제 9.4 · 9.5 호출과 다시 그리기는 E2E(inquiry.spec.ts)가 본다.
// 사진 올리기(9.11 + S3 PUT)는 경계 함수 uploadInquiryPhotos만 바꾼다. 테스트가 고른 파일 이름으로 키를 돌려준다.

const { uploadInquiryPhotos } = vi.hoisted(() => ({ uploadInquiryPhotos: vi.fn() }));
vi.mock("@/lib/inquiry/upload-photos", () => ({ uploadInquiryPhotos }));

const { createObjectURL, revokeObjectURL } = URL;
const revoke = vi.fn();

beforeAll(() => {
  MotionGlobalConfig.skipAnimations = true;
  // jsdom에는 미리보기 주소를 만드는 함수가 없다
  URL.createObjectURL = (file: Blob) => `blob:${(file as File).name}`;
  URL.revokeObjectURL = revoke;
});
afterAll(() => {
  MotionGlobalConfig.skipAnimations = false;
  URL.createObjectURL = createObjectURL;
  URL.revokeObjectURL = revokeObjectURL;
});
afterEach(() => {
  cleanup();
  uploadInquiryPhotos.mockReset();
  revoke.mockReset();
});

beforeEach(() => {
  uploadInquiryPhotos.mockImplementation(async (files: File[]) => ({
    keys: files.map((file) => `inquiry/${file.name}`),
  }));
});

const photo = (name: string, type = "image/png", size = 1024) =>
  new File([new Uint8Array(size)], name, { type });

function pickPhotos(...files: File[]) {
  fireEvent.change(screen.getByLabelText("사진 파일"), { target: { files } });
}

const ANSWERED = {
  id: 7,
  title: "비밀번호를 잊어버렸어요",
  status: "ANSWERED",
  createdAt: "2026-10-26T10:00:00+09:00",
  updatedAt: "2026-10-26T11:30:00+09:00",
  messages: [
    {
      id: 21,
      authorType: "USER",
      content: "바꿔 주세요.",
      createdAt: "2026-10-26T10:00:00+09:00",
      attachments: [],
    },
    {
      id: 22,
      authorType: "ADMIN",
      content: "바꿨어요.",
      createdAt: "2026-10-26T11:30:00+09:00",
      attachments: [],
    },
  ],
} satisfies InquiryResponse;

function renderThread(inquiry: InquiryResponse = ANSWERED) {
  const onSend = vi.fn().mockResolvedValue({ message: { id: 23 } });
  const onClose = vi.fn().mockResolvedValue({ ok: true });
  render(
    <InquiryThread
      inquiry={inquiry}
      back={{ label: "내 문의", href: "/inquiries" }}
      onSend={onSend}
      onClose={onClose}
    />,
  );
  return { onSend, onClose };
}

describe("InquiryThread (I03)", () => {
  it("제목 · 문의번호 · 상태와 메시지를 오래된 순으로, 답변에는 '운영자'와 시각을 붙여 보여 준다", () => {
    renderThread();

    expect(screen.getByRole("heading", { level: 1, name: "비밀번호를 잊어버렸어요" })).toBeTruthy();
    expect(screen.getByText("문의번호 7")).toBeTruthy();
    expect(screen.getByText("답변함")).toBeTruthy();
    const items = within(screen.getByRole("list", { name: "주고받은 메시지" })).getAllByRole(
      "listitem",
    );
    expect(items.map((li) => li.textContent)).toEqual([
      "바꿔 주세요.10.26 10:00",
      "운영자바꿨어요.10.26 11:30",
    ]);
  });

  it("이어서 쓰면 보낸 뒤 칸을 비우고, 빈 칸이면 보내지 않는다", async () => {
    const { onSend } = renderThread();
    const box = screen.getByLabelText("이어서 쓰기") as HTMLTextAreaElement;

    fireEvent.click(screen.getByRole("button", { name: "보내기" }));
    expect(await screen.findByText("필수 값입니다.")).toBeTruthy();
    expect(onSend).not.toHaveBeenCalled();

    fireEvent.change(box, { target: { value: "또 궁금해요" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "보내기" }));
    });

    expect(onSend).toHaveBeenCalledWith({ content: "또 궁금해요", attachmentKeys: [] });
    await waitFor(() => expect(box.value).toBe(""));
  });

  it("보내기가 실패하면 서버 문구를 칸 아래에 보여 준다", async () => {
    const { onSend } = renderThread();
    onSend.mockResolvedValue({ error: "종료한 문의예요." });

    fireEvent.change(screen.getByLabelText("이어서 쓰기"), { target: { value: "또" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "보내기" }));
    });

    expect(await screen.findByText("종료한 문의예요.")).toBeTruthy();
    // 실패하면 쓴 글을 남겨 다시 보낼 수 있다
    expect((screen.getByLabelText("이어서 쓰기") as HTMLTextAreaElement).value).toBe("또");
  });

  it("보내는 동안에는 [보내기]를 다시 누를 수 없다", async () => {
    const { onSend } = renderThread();
    let resolve: (value: unknown) => void = () => {};
    onSend.mockReturnValue(new Promise((r) => (resolve = r)));

    fireEvent.change(screen.getByLabelText("이어서 쓰기"), { target: { value: "또" } });
    fireEvent.click(screen.getByRole("button", { name: "보내기" }));

    const button = await screen.findByRole("button", { name: "보내기", busy: true });
    expect(button.hasAttribute("disabled")).toBe(true);
    fireEvent.click(button);
    expect(onSend).toHaveBeenCalledTimes(1);
    await act(async () => resolve({ message: { id: 23 } }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "보내기" }).hasAttribute("disabled")).toBe(false),
    );
  });

  it("붙인 사진은 말풍선 아래에 두고, 누르면 원본을 새 탭에서 연다", () => {
    const withPhotos: InquiryResponse = structuredClone(ANSWERED);
    withPhotos.messages[0].attachments = [
      { id: 3, url: "https://s3.test/a.png" },
      { id: 4, url: "https://s3.test/b.png" },
    ];
    renderThread(withPhotos);

    const links = within(screen.getByRole("list", { name: "붙인 사진" })).getAllByRole("link");
    expect(links.map((a) => a.getAttribute("href"))).toEqual([
      "https://s3.test/a.png",
      "https://s3.test/b.png",
    ]);
    expect(links[0].getAttribute("target")).toBe("_blank");
    expect(links[0].getAttribute("aria-label")).toBe("붙인 사진 1 원본 보기(새 탭)");
  });

  it("고른 사진을 입력칸 위에 보여 주고, 보낼 때 올린 키를 함께 보낸 뒤 비운다", async () => {
    const { onSend } = renderThread();

    pickPhotos(photo("a.png"), photo("b.jpg", "image/jpeg"));
    expect(screen.getByRole("img", { name: "고른 사진 1" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "사진 1 빼기" }));
    expect(screen.getAllByRole("img", { name: /고른 사진/ })).toHaveLength(1);

    fireEvent.change(screen.getByLabelText("이어서 쓰기"), { target: { value: "사진 봐 주세요" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "보내기" }));
    });

    expect(revoke).toHaveBeenCalledWith("blob:a.png");
    expect(uploadInquiryPhotos).toHaveBeenCalledWith([expect.objectContaining({ name: "b.jpg" })]);
    expect(onSend).toHaveBeenCalledWith({
      content: "사진 봐 주세요",
      attachmentKeys: ["inquiry/b.jpg"],
    });
    await waitFor(() => expect(screen.queryByRole("list", { name: "고른 사진" })).toBeNull());
    expect(revoke).toHaveBeenCalledWith("blob:b.jpg");
  });

  it("JPG · PNG가 아니거나 5MB를 넘는 사진은 빼고 서버와 같은 문구를 보여 준다", () => {
    renderThread();

    pickPhotos(photo("a.gif", "image/gif"));
    expect(screen.getByText("JPG·PNG만 올릴 수 있습니다.")).toBeTruthy();
    pickPhotos(photo("big.png", "image/png", 5_242_881));
    expect(screen.getByText("5MB 이하만 올릴 수 있습니다.")).toBeTruthy();
    expect(screen.queryByRole("img", { name: /고른 사진/ })).toBeNull();
    // 사진 탓이라 입력칸은 빨갛게 하지 않는다
    expect(screen.getByLabelText("이어서 쓰기").getAttribute("aria-invalid")).toBeNull();
  });

  it("5장까지만 고르고, 5장이면 사진 버튼을 막는다", () => {
    renderThread();

    // 4장을 고른 뒤 2장을 더 고르면 남은 1장만 받는다
    pickPhotos(...["1", "2", "3", "4"].map((n) => photo(`${n}.png`)));
    pickPhotos(photo("5.png"), photo("6.png"));

    expect(screen.getAllByRole("img", { name: /고른 사진/ })).toHaveLength(5);
    expect(screen.getByText("사진은 5장까지 붙일 수 있습니다.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "사진 붙이기" }).hasAttribute("disabled")).toBe(true);
  });

  it("사진을 올리지 못하면 보내지 않고 문구를 보여 주며, 고른 사진과 글은 남긴다", async () => {
    const { onSend } = renderThread();
    uploadInquiryPhotos.mockResolvedValue({ error: "잠시 후 다시 시도해 주세요." });

    pickPhotos(photo("a.png"));
    fireEvent.change(screen.getByLabelText("이어서 쓰기"), { target: { value: "또" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "보내기" }));
    });

    expect(await screen.findByText("잠시 후 다시 시도해 주세요.")).toBeTruthy();
    expect(onSend).not.toHaveBeenCalled();
    expect(screen.getByRole("img", { name: "고른 사진 1" })).toBeTruthy();
    expect((screen.getByLabelText("이어서 쓰기") as HTMLTextAreaElement).value).toBe("또");
  });

  it("[문의 종료] → I03-1, [취소] · Esc로 닫고 [종료]면 종료한다", async () => {
    const { onClose } = renderThread();

    fireEvent.click(screen.getByRole("button", { name: "문의 종료" }));
    expect(screen.getByRole("dialog", { name: "문의를 종료할까요?" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "취소" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    fireEvent.click(screen.getByRole("button", { name: "문의 종료" }));
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    fireEvent.click(screen.getByRole("button", { name: "문의 종료" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "종료" }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("종료가 실패하면 모달 안에 서버 문구를 보여 주고 닫지 않는다", async () => {
    const { onClose } = renderThread();
    onClose.mockResolvedValue({ error: "잠시 후 다시 시도해 주세요." });

    fireEvent.click(screen.getByRole("button", { name: "문의 종료" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "종료" }));
    });

    expect(
      within(screen.getByRole("dialog")).getByText("잠시 후 다시 시도해 주세요."),
    ).toBeTruthy();
  });

  it("종료한 문의면 입력칸 · [문의 종료] 대신 '종료한 문의예요.'", () => {
    renderThread({ ...ANSWERED, status: "CLOSED" });

    expect(screen.getByText("종료한 문의예요.")).toBeTruthy();
    expect(screen.queryByLabelText("이어서 쓰기")).toBeNull();
    expect(screen.queryByRole("button", { name: "문의 종료" })).toBeNull();
  });
});
