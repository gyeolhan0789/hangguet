import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MotionGlobalConfig } from "motion/react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type { InquiryResponse } from "@/types/api";

import { InquiryThread } from "./inquiry-thread";

// 기준: Figma I03 문의 상세 · I03-1 문의 종료 확인 · 기획 메모 I03 · I03-1 · Swagger 9.3 예시(InquiryResponse)
// 쓰기 · 종료(서버 액션)는 부모가 넘긴 함수라 vi.fn으로 바꾼다. 실제 9.4 · 9.5 호출과 다시 그리기는 E2E(inquiry.spec.ts)가 본다.

beforeAll(() => {
  MotionGlobalConfig.skipAnimations = true;
});
afterAll(() => {
  MotionGlobalConfig.skipAnimations = false;
});
afterEach(() => {
  cleanup();
});

const ANSWERED = {
  id: 7,
  title: "비밀번호를 잊어버렸어요",
  status: "ANSWERED",
  createdAt: "2026-10-26T10:00:00+09:00",
  updatedAt: "2026-10-26T11:30:00+09:00",
  messages: [
    { id: 21, authorType: "USER", content: "바꿔 주세요.", createdAt: "2026-10-26T10:00:00+09:00" },
    { id: 22, authorType: "ADMIN", content: "바꿨어요.", createdAt: "2026-10-26T11:30:00+09:00" },
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

    expect(onSend).toHaveBeenCalledWith("또 궁금해요");
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
