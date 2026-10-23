import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MotionGlobalConfig } from "motion/react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type { NoticeItem } from "@/types/api";

import { NoticePopup } from "./notice-popup";

// 열림 · 닫힘 애니메이션을 건너뛰어 실제 시간을 기다리지 않는다
beforeAll(() => {
  MotionGlobalConfig.skipAnimations = true;
});
afterAll(() => {
  MotionGlobalConfig.skipAnimations = false;
});

const readNotice = vi.fn();
vi.mock("@/lib/notice/actions", () => ({
  readNotice: (...args: unknown[]) => readNotice(...args),
}));

// 기준: 기획 메모 C02(앱에 들어오면 확인 안 한 공지를 최신순으로 한 장씩, [확인] → 8.9 → 다음, 마지막이면 닫힘, 확인한 공지는 다시
// 뜨지 않는다) · Swagger 8.8(최신순) · 8.9

const notice = (id: number, title: string, read: boolean): NoticeItem => ({
  id,
  title,
  content: `${title} 본문`,
  startsAt: "2026-10-23T09:00:00+09:00",
  read,
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

async function confirm() {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "확인" }));
  });
}

describe("NoticePopup (C02 · 앱에 들어올 때)", () => {
  it("확인 안 한 공지만 받은 순서(최신순)대로 한 장씩 띄우고, 마지막을 확인하면 닫힌다", async () => {
    readNotice.mockResolvedValue({ ok: true });
    render(
      <NoticePopup
        notices={[
          notice(5, "새 공지", false),
          notice(4, "읽은 공지", true),
          notice(3, "옛 공지", false),
        ]}
      />,
    );

    expect(screen.getByRole("dialog", { name: "새 공지" })).toBeTruthy();
    await confirm();
    expect(readNotice).toHaveBeenLastCalledWith(5);

    expect(await screen.findByRole("dialog", { name: "옛 공지" })).toBeTruthy();
    await confirm();
    expect(readNotice).toHaveBeenLastCalledWith(3);

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(readNotice).toHaveBeenCalledTimes(2);
  });

  it("모두 확인한 공지면 띄우지 않는다", () => {
    render(<NoticePopup notices={[notice(4, "읽은 공지", true)]} />);

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("확인 뒤 다시 그려져(read가 바뀌어) 목록이 달라져도 띄울 차례는 처음 목록대로다", async () => {
    readNotice.mockResolvedValue({ ok: true });
    const { rerender } = render(
      <NoticePopup notices={[notice(5, "새 공지", false), notice(3, "옛 공지", false)]} />,
    );

    await confirm();
    rerender(<NoticePopup notices={[notice(5, "새 공지", true), notice(3, "옛 공지", false)]} />);

    expect(await screen.findByRole("dialog", { name: "옛 공지" })).toBeTruthy();
  });
});
