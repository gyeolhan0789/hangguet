// 기준: Figma S03 지원서 선택 · 기획 메모 S03 지원서 선택(지원서를 라디오로 고름, 고른 지원서 id로 S04)
// · Swagger 4.3 ApplicationListItem · 사용자 결정(2026-10-29: 빈 목록이면 '저장된 지원서가 없어요')
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ROUTES } from "@/lib/routes";
import { router } from "@/test/next-navigation";
import type { ApplicationListItem } from "@/types/api";

import { ApplicationSelect } from "./application-select";

// 경계 mock: Next 런타임(GET 이동 폼 · 라우터 bfcacheId)과 연출(motion)
vi.mock("next/form", () => import("@/test/next-form"));
vi.mock("next/navigation", () => import("@/test/next-navigation"));
vi.mock("motion/react", async (importOriginal) =>
  (await import("@/test/motion")).reducedMotion(importOriginal),
);

// 예시 데이터: Swagger 4.3 200 예시(최근 작성순)
const LIST = [
  {
    id: 12,
    companyName: "○○전자",
    jobTitle: "백엔드 개발자",
    createdAt: "2026-10-15T11:55:00+09:00",
  },
  {
    id: 9,
    companyName: "△△소프트",
    jobTitle: "서버 개발자",
    createdAt: "2026-10-11T20:10:00+09:00",
  },
] satisfies ApplicationListItem[];

const next = () => screen.getByRole("button", { name: "다음: 면접관 선택" });
const radio = (name: RegExp) => screen.getByRole("radio", { name }) as HTMLInputElement;

describe("ApplicationSelect · S03 지원서 선택", () => {
  describe("화면 표시", () => {
    it("저장된 지원서가 없으면 '저장된 지원서가 없어요'를 보여 준다", () => {
      render(<ApplicationSelect applications={[]} initialSelected={null} added={false} />);

      expect(screen.getByText("저장된 지원서가 없어요")).toBeDefined();
      expect(screen.queryAllByRole("radio")).toHaveLength(0);
    });

    it("아무것도 고르지 않았으면 [다음]을 누를 수 없다", () => {
      render(<ApplicationSelect applications={LIST} initialSelected={null} added={false} />);

      expect(next().hasAttribute("disabled")).toBe(true);
    });
  });

  describe("사용자 조작", () => {
    it("지원서를 고르면 [다음]을 누를 수 있다", () => {
      render(<ApplicationSelect applications={LIST} initialSelected={null} added={false} />);

      fireEvent.click(radio(/△△소프트/));

      expect(next().hasAttribute("disabled")).toBe(false);
    });

    it("지원서를 고르면 그 id를 면접관 선택 주소로 보낸다", () => {
      render(<ApplicationSelect applications={LIST} initialSelected={null} added={false} />);

      fireEvent.click(radio(/△△소프트/));

      const form = next().closest("form")!;
      expect(form.getAttribute("action")).toBe(ROUTES.practiceInterviewer);
      expect(new FormData(form).get("applicationId")).toBe("9");
    });
  });

  describe("상태 변화", () => {
    it("고른 지원서가 목록에서 빠지면 고르지 않은 것으로 보고 [다음]을 끈다", () => {
      const { rerender } = render(
        <ApplicationSelect applications={LIST} initialSelected={9} added={false} />,
      );

      rerender(<ApplicationSelect applications={[LIST[0]]} initialSelected={9} added={false} />);

      expect(radio(/○○전자/).checked).toBe(false);
      expect(next().hasAttribute("disabled")).toBe(true);
    });

    it("같은 주소로 새로 들어오면(bfcacheId가 바뀜) 골라 둔 지원서부터 다시 시작한다", () => {
      const { rerender } = render(
        <ApplicationSelect applications={LIST} initialSelected={9} added={false} />,
      );
      expect(radio(/△△소프트/).checked).toBe(true);
      fireEvent.click(radio(/○○전자/));

      router.bfcacheId = "entry-2";
      rerender(<ApplicationSelect applications={LIST} initialSelected={9} added={false} />);

      expect(radio(/△△소프트/).checked).toBe(true);
      expect(radio(/○○전자/).checked).toBe(false);
    });
  });
});
