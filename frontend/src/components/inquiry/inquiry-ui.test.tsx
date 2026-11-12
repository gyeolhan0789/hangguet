// 기준: Figma 화이트모드 I01 ~ I04 머리('‹ 돌아갈 곳' · 제목) · 기획 메모 I03(회원 '‹ 내 문의' → I02, 비회원 I03 → I04)
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ROUTES } from "@/lib/routes";

import { InquiryHead } from "./inquiry-ui";

describe("InquiryHead · 문의 화면 머리", () => {
  describe("화면 표시", () => {
    it("돌아갈 곳에 주소가 있으면 그 주소로 가는 링크를 보여 준다", () => {
      render(<InquiryHead back={{ label: "내 문의", href: ROUTES.inquiries }} title="문의 상세" />);

      expect(screen.getByRole("link", { name: "내 문의" }).getAttribute("href")).toBe(
        ROUTES.inquiries,
      );
      expect(screen.queryByRole("button", { name: "내 문의" })).toBeNull();
    });

    it("돌아갈 곳에 동작이 있으면 같은 화면에서 돌아가는 버튼을 보여 준다", () => {
      render(<InquiryHead back={{ label: "내 문의", onClick: vi.fn() }} title="문의 상세" />);

      expect(screen.getByRole("button", { name: "내 문의" })).toBeDefined();
      expect(screen.queryByRole("link", { name: "내 문의" })).toBeNull();
    });
  });
});
