// 기준: Figma C/App Header 공지 버튼 · C03 공지 목록 펼침 · 기획 메모 C01 · C03 · Swagger 8.8 NoticesResponse · 8.9 공지 확인
import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { readNotice } from "@/lib/notice/actions";
import { deferred } from "@/test/deferred";
import { flushPromises } from "@/test/flush";
import type { NoticeItem } from "@/types/api";

import { NoticeBell, NoticeRows, useNoticeModal } from "./notice-bell";

// 경계 mock: 서버 액션(8.9)과 연출(motion)
vi.mock("@/lib/notice/actions", () => ({ readNotice: vi.fn() }));
vi.mock("motion/react", async (importOriginal) =>
  (await import("@/test/motion")).reducedMotion(importOriginal),
);

// 예시 데이터: Swagger 8.8 200 예시 '확인 안 함 1개 · 확인함 1개'(최신순)
const UNREAD: NoticeItem = {
  id: 3,
  title: "10월 점검 안내",
  content: "10월 30일 02:00~04:00 서비스 점검이 있어요.",
  startsAt: "2026-10-23T09:00:00+09:00",
  read: false,
};
const READ: NoticeItem = {
  id: 2,
  title: "채팅 면접이 열렸어요",
  content: "이제 글로도 면접을 볼 수 있어요.",
  startsAt: "2026-10-20T09:00:00+09:00",
  read: true,
};

describe("useNoticeModal · 공지 모달 상태", () => {
  describe("정상 처리", () => {
    it("[확인]하면 연 공지의 id로 확인을 요청하고, 끝나면 모달을 닫는다", async () => {
      vi.mocked(readNotice).mockResolvedValue({ ok: true });
      const { result } = renderHook(() => useNoticeModal());
      act(() => result.current.open(UNREAD));

      await act(async () => result.current.confirm());

      expect(readNotice).toHaveBeenCalledWith(3);
      expect(result.current.opened).toBeNull();
    });
  });

  describe("입력 검증", () => {
    it("연 공지가 없으면 [확인]해도 요청하지 않는다", async () => {
      const { result } = renderHook(() => useNoticeModal());

      await act(async () => result.current.confirm());

      expect(readNotice).not.toHaveBeenCalled();
    });
  });

  describe("오류 처리", () => {
    it("확인 요청이 실패해도 모달을 닫는다", async () => {
      vi.mocked(readNotice).mockResolvedValue({ error: "공지를 찾을 수 없어요." });
      const { result } = renderHook(() => useNoticeModal());
      act(() => result.current.open(UNREAD));

      await act(async () => result.current.confirm());

      expect(result.current.opened).toBeNull();
    });
  });

  describe("상태 변화", () => {
    it("확인 응답을 기다리는 동안에는 처리 중이고 모달은 열려 있다", async () => {
      const response = deferred<{ ok: true }>();
      vi.mocked(readNotice).mockReturnValue(response.promise);
      const { result } = renderHook(() => useNoticeModal());
      act(() => result.current.open(UNREAD));

      act(() => result.current.confirm());

      expect(result.current.pending).toBe(true);
      expect(result.current.opened).toEqual(UNREAD);
      await act(async () => response.resolve({ ok: true }));
      expect(result.current.pending).toBe(false);
    });
  });
});

describe("NoticeRows · 공지 줄", () => {
  describe("화면 표시", () => {
    it("공지가 없으면 '공지가 없어요'를 보여 준다", () => {
      render(<NoticeRows notices={[]} onOpen={vi.fn()} />);

      expect(screen.getByText("공지가 없어요")).toBeDefined();
    });

    it("확인 안 한 공지는 제목 아래에 '게시 날짜 · 확인 안 함'을 보여 준다", () => {
      render(<NoticeRows notices={[UNREAD]} onOpen={vi.fn()} />);

      expect(screen.getByRole("button", { name: /10월 점검 안내/ }).textContent).toContain(
        "2026.10.23 · 확인 안 함",
      );
    });

    it("확인한 공지는 제목 아래에 '게시 날짜 · 확인함'을 보여 준다", () => {
      render(<NoticeRows notices={[READ]} onOpen={vi.fn()} />);

      expect(screen.getByRole("button", { name: /채팅 면접이 열렸어요/ }).textContent).toContain(
        "2026.10.20 · 확인함",
      );
    });
  });

  describe("사용자 조작", () => {
    it("줄을 누르면 그 공지를 연다", () => {
      const onOpen = vi.fn();
      render(<NoticeRows notices={[UNREAD, READ]} onOpen={onOpen} />);

      fireEvent.click(screen.getByRole("button", { name: /채팅 면접이 열렸어요/ }));

      expect(onOpen).toHaveBeenCalledWith(READ);
    });
  });
});

describe("NoticeBell · 헤더 공지 버튼", () => {
  const bell = (name: string | RegExp = /^공지/) => screen.getByRole("button", { name });

  describe("종", () => {
    describe("화면 표시", () => {
      it("확인 안 한 공지가 있으면 종 이름에 알리고 점을 보여 준다", () => {
        render(<NoticeBell notices={[UNREAD, READ]} />);

        expect(bell("공지, 확인 안 한 공지 있음")).toBeDefined();
        expect(screen.queryByTestId("notice-unread-dot")).not.toBeNull();
      });

      it("모든 공지를 확인했으면 종 이름은 '공지'이고 점이 없다", () => {
        render(<NoticeBell notices={[READ]} />);

        expect(bell("공지")).toBeDefined();
        expect(screen.queryByTestId("notice-unread-dot")).toBeNull();
      });
    });
  });

  describe("공지 목록", () => {
    describe("사용자 조작", () => {
      it("종을 누르면 공지 목록을 펼친다", () => {
        render(<NoticeBell notices={[UNREAD]} />);

        fireEvent.click(bell());

        expect(screen.getByRole("menu", { name: "공지" })).toBeDefined();
        expect(bell().getAttribute("aria-expanded")).toBe("true");
      });

      it("펼친 상태에서 종을 다시 누르면 목록을 닫는다", () => {
        render(<NoticeBell notices={[UNREAD]} />);
        fireEvent.click(bell());

        fireEvent.click(bell());

        expect(screen.queryByRole("menu")).toBeNull();
      });

      it("펼친 상태에서 Esc를 누르면 목록을 닫는다", () => {
        render(<NoticeBell notices={[UNREAD]} />);
        fireEvent.click(bell());

        fireEvent.keyDown(document, { key: "Escape" });

        expect(screen.queryByRole("menu")).toBeNull();
      });

      it("펼친 상태에서 Esc가 아닌 키를 누르면 목록을 그대로 둔다", () => {
        render(<NoticeBell notices={[UNREAD]} />);
        fireEvent.click(bell());

        fireEvent.keyDown(document, { key: "Enter" });

        expect(screen.getByRole("menu")).toBeDefined();
      });

      it("펼친 상태에서 바깥을 누르면 목록을 닫는다", () => {
        render(<NoticeBell notices={[UNREAD]} />);
        fireEvent.click(bell());

        fireEvent.mouseDown(document.body);

        expect(screen.queryByRole("menu")).toBeNull();
      });

      it("펼친 상태에서 목록 안을 누르면 목록을 그대로 둔다", () => {
        render(<NoticeBell notices={[UNREAD]} />);
        fireEvent.click(bell());

        fireEvent.mouseDown(screen.getByRole("menu"));

        expect(screen.getByRole("menu")).toBeDefined();
      });
    });
  });

  describe("공지 모달", () => {
    describe("사용자 조작", () => {
      it("목록에서 공지를 누르면 목록을 닫고 그 공지를 모달로 연다", () => {
        render(<NoticeBell notices={[UNREAD, READ]} />);
        fireEvent.click(bell());

        fireEvent.click(screen.getByRole("menuitem", { name: /채팅 면접이 열렸어요/ }));

        expect(screen.queryByRole("menu")).toBeNull();
        expect(screen.getByRole("dialog", { name: "채팅 면접이 열렸어요" })).toBeDefined();
      });

      it("모달에서 [확인]을 누르면 그 공지를 확인 처리하고 모달을 닫는다", async () => {
        vi.mocked(readNotice).mockResolvedValue({ ok: true });
        render(<NoticeBell notices={[UNREAD, READ]} />);
        fireEvent.click(bell());
        fireEvent.click(screen.getByRole("menuitem", { name: /채팅 면접이 열렸어요/ }));

        fireEvent.click(screen.getByRole("button", { name: "확인" }));
        await flushPromises();

        expect(readNotice).toHaveBeenCalledWith(2);
        expect(screen.queryByRole("dialog")).toBeNull();
      });
    });
  });
});
