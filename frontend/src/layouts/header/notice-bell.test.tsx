import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MotionGlobalConfig } from "motion/react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { flushPromises } from "@/test/flush";
import type { NoticeItem } from "@/types/api";

import { NoticeBell } from "./notice-bell";

// 열림 · 닫힘 애니메이션을 건너뛰어 실제 시간을 기다리지 않는다
beforeAll(() => {
  MotionGlobalConfig.skipAnimations = true;
});
afterAll(() => {
  MotionGlobalConfig.skipAnimations = false;
});

// 서버 액션 경계만 바꾼다. 확인 뒤 다시 그리기는 E2E(notice-streak-freeze.spec.ts)가 본다.
const readNotice = vi.fn();
vi.mock("@/lib/notice/actions", () => ({
  readNotice: (...args: unknown[]) => readNotice(...args),
}));

// 기준: Figma C/App Header 공지 버튼 · C03 공지 목록 펼침 · C02 공지 모달 · 기획 메모 C01 · C02 · C03 · Swagger 8.8 예시 · 8.9

const UNREAD = {
  id: 3,
  title: "10월 점검 안내",
  content: "10월 30일 02:00~04:00 서비스 점검이 있어요.",
  startsAt: "2026-10-23T09:00:00+09:00",
  read: false,
} satisfies NoticeItem;
const READ = {
  id: 2,
  title: "채팅 면접이 열렸어요",
  content: "이제 글로도 면접을 볼 수 있어요.",
  startsAt: "2026-10-20T09:00:00+09:00",
  read: true,
} satisfies NoticeItem;

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

const bell = () => screen.getByRole("button", { name: /^공지/ });

describe("NoticeBell (공지 버튼 · C03 목록)", () => {
  it("확인 안 한 공지가 있으면 종에 점이 있고, 모두 확인했으면 없다", () => {
    const { rerender } = render(<NoticeBell notices={[UNREAD, READ]} />);
    expect(screen.getByTestId("notice-unread-dot")).toBeTruthy();
    expect(bell().getAttribute("aria-label")).toBe("공지, 확인 안 한 공지 있음");

    rerender(<NoticeBell notices={[READ]} />);
    expect(screen.queryByTestId("notice-unread-dot")).toBeNull();
    expect(bell().getAttribute("aria-label")).toBe("공지");
  });

  it("종을 누르면 받은 순서(최신순)대로 제목과 '날짜 · 확인 안 함/확인함'을 펼친다", () => {
    render(<NoticeBell notices={[UNREAD, READ]} />);

    fireEvent.click(bell());

    const [first, second] = screen.getAllByRole("menuitem");
    expect(within(first).getByText("10월 점검 안내")).toBeTruthy();
    expect(within(first).getByText("2026.10.23 · 확인 안 함")).toBeTruthy();
    expect(within(second).getByText("채팅 면접이 열렸어요")).toBeTruthy();
    expect(within(second).getByText("2026.10.20 · 확인함")).toBeTruthy();
  });

  it("공지가 없으면 '공지가 없어요'", () => {
    render(<NoticeBell notices={[]} />);

    fireEvent.click(bell());

    expect(screen.getByText("공지가 없어요")).toBeTruthy();
  });

  it("바깥 클릭 · Esc로 닫힌다", async () => {
    render(<NoticeBell notices={[READ]} />);

    fireEvent.click(bell());
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());

    fireEvent.click(bell());
    fireEvent.mouseDown(document.body);
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
  });

  it("확인 안 한 공지를 누르면 C02로 열고, [확인]하면 8.9로 확인한 뒤 닫는다", async () => {
    readNotice.mockResolvedValue({ ok: true });
    render(<NoticeBell notices={[UNREAD, READ]} />);

    fireEvent.click(bell());
    fireEvent.click(screen.getByRole("menuitem", { name: /10월 점검 안내/ }));
    const dialog = screen.getByRole("dialog", { name: "10월 점검 안내" });
    expect(dialog.textContent).toContain("10월 30일 02:00~04:00 서비스 점검이 있어요.");
    expect(dialog.textContent).toContain("2026.10.23");
    expect(dialog.textContent).not.toMatch(/\d+ \/ \d+/);

    fireEvent.click(screen.getByRole("button", { name: "확인" }));
    await flushPromises();

    expect(readNotice).toHaveBeenCalledWith(3);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("[확인]을 처리하는 동안에는 버튼을 다시 누를 수 없다", async () => {
    let resolve: (value: unknown) => void = () => {};
    readNotice.mockReturnValue(new Promise((r) => (resolve = r)));
    render(<NoticeBell notices={[UNREAD]} />);

    fireEvent.click(bell());
    fireEvent.click(screen.getByRole("menuitem", { name: /10월 점검 안내/ }));
    fireEvent.click(screen.getByRole("button", { name: "확인" }));

    expect(screen.getByRole("button", { name: "확인" }).hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "확인" }));
    expect(readNotice).toHaveBeenCalledTimes(1);
    await act(async () => resolve({ ok: true }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(readNotice).toHaveBeenCalledTimes(1);
  });

  it("이미 확인한 공지도 [확인]하면 8.9를 부르고 닫는다(서버는 이미 확인했어도 204)", async () => {
    readNotice.mockResolvedValue({ ok: true });
    render(<NoticeBell notices={[READ]} />);

    fireEvent.click(bell());
    fireEvent.click(screen.getByRole("menuitem", { name: /채팅 면접이 열렸어요/ }));
    fireEvent.click(screen.getByRole("button", { name: "확인" }));
    await flushPromises();

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(readNotice).toHaveBeenCalledWith(2);
  });
});
