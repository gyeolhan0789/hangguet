// 기준: Figma S04 면접관 선택(18:2122) · 사용자 결정(2026-10-29: [← 지원서 선택]은 고른 지원서를 골라 둔 S03로)
// · Swagger 4.2(지원서 회사명 · 직무) · 5.1 SessionCreateRequest.persona
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ROUTES } from "@/lib/routes";
import { router } from "@/test/next-navigation";

import { InterviewerForm } from "./interviewer-form";

// 경계 mock: Next 런타임(GET 이동 폼 · 라우터 bfcacheId)과 연출(motion). 면접관 목록(PersonaList)은 진짜로 그린다
vi.mock("next/form", () => import("@/test/next-form"));
vi.mock("next/navigation", () => import("@/test/next-navigation"));
vi.mock("motion/react", async (importOriginal) =>
  (await import("@/test/motion")).reducedMotion(importOriginal),
);

// 예시 데이터: Swagger 4.2 200 예시
const APPLICATION = { id: 12, companyName: "○○전자", jobTitle: "백엔드 개발자" };

const next = () => screen.getByRole("button", { name: "다음: 면접 방식" });
const radio = (name: RegExp) => screen.getByRole("radio", { name }) as HTMLInputElement;

describe("InterviewerForm · S04 면접관 선택", () => {
  describe("화면 표시", () => {
    it("면접관을 고르기 전에는 [다음: 면접 방식]을 누를 수 없다", () => {
      render(<InterviewerForm application={APPLICATION} initialPersona={null} />);

      expect(next().hasAttribute("disabled")).toBe(true);
    });
  });

  describe("사용자 조작", () => {
    it("면접관을 고르면 [다음: 면접 방식]을 누를 수 있다", () => {
      render(<InterviewerForm application={APPLICATION} initialPersona={null} />);

      fireEvent.click(radio(/악마 면접관/));

      expect(next().hasAttribute("disabled")).toBe(false);
    });

    it("면접관을 고르면 지원서 id와 함께 면접 방식 주소로 보낸다", () => {
      render(<InterviewerForm application={APPLICATION} initialPersona={null} />);

      fireEvent.click(radio(/악마 면접관/));

      const form = next().closest("form")!;
      expect(form.getAttribute("action")).toBe(ROUTES.practiceMode);
      const data = new FormData(form);
      expect(data.get("applicationId")).toBe("12");
      expect(data.get("persona")).toBe("DEVIL");
    });
  });

  describe("상태 변화", () => {
    it("같은 주소로 새로 들어오면(bfcacheId가 바뀜) 주소로 받은 면접관부터 다시 시작한다", () => {
      const { rerender } = render(
        <InterviewerForm application={APPLICATION} initialPersona="COFFEE_CHAT" />,
      );
      fireEvent.click(radio(/악마 면접관/));

      router.bfcacheId = "entry-2";
      rerender(<InterviewerForm application={APPLICATION} initialPersona="COFFEE_CHAT" />);

      expect(radio(/개발자 커피챗/).checked).toBe(true);
      expect(radio(/악마 면접관/).checked).toBe(false);
    });
  });
});
