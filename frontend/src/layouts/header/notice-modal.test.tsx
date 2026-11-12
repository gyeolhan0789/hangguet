// 기준: Figma C02 공지 모달 · 기획 메모 C02([확인] → 8.9 → 닫힘) · Swagger 8.8 NoticeItem
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { NoticeItem } from "@/types/api";

import { NoticeModal, noticeDate } from "./notice-modal";

// 경계 mock: 연출(motion)은 건너뛴다
vi.mock("motion/react", async (importOriginal) =>
  (await import("@/test/motion")).reducedMotion(importOriginal),
);

// 예시 데이터: Swagger 8.8 200 예시의 첫 공지
const NOTICE: NoticeItem = {
  id: 3,
  title: "10월 점검 안내",
  content: "10월 30일 02:00~04:00 서비스 점검이 있어요.",
  startsAt: "2026-10-23T09:00:00+09:00",
  read: false,
};

describe("noticeDate · 공지 게시 날짜", () => {
  describe("정상 처리", () => {
    it("게시 시각을 'YYYY.MM.DD'로 바꾼다", () => {
      expect(noticeDate("2026-10-23T09:00:00+09:00")).toBe("2026.10.23");
    });
  });
});

describe("NoticeModal · 공지 모달", () => {
  describe("화면 표시", () => {
    it("띄울 공지가 없으면 모달을 그리지 않는다", () => {
      render(<NoticeModal notice={null} onConfirm={vi.fn()} />);

      expect(screen.queryByRole("dialog")).toBeNull();
    });

    it("확인을 처리하는 중이면 [확인]을 누를 수 없다", () => {
      render(<NoticeModal notice={NOTICE} pending onConfirm={vi.fn()} />);

      expect(screen.getByRole("button", { name: "확인" }).hasAttribute("disabled")).toBe(true);
    });
  });
});
