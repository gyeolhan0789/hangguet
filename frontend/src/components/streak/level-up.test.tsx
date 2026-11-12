// 기준: S02-L 스트릭 레벨업 데모(이정복/S02-L-레벨업-데모) · Figma "스트릭 뱃지 색상 — 확정"(단계 이름 · 색 이름)
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { LevelUp } from "./level-up";

// 경계 mock: 연출(motion)은 건너뛴다(닫히면 InstantPresence가 onExitComplete를 부른다)
vi.mock("motion/react", async (importOriginal) =>
  (await import("@/test/motion")).reducedMotion(importOriginal),
);

describe("LevelUp · 스트릭 레벨업 축하", () => {
  describe("화면 표시", () => {
    it("다음 단계가 있으면 그 이름과 남은 일수를 보여 준다", () => {
      render(<LevelUp days={8} />);

      expect(screen.getByText("다음 단계 · 전설의 불꽃")).toBeDefined();
      expect(screen.getByText("6일 남음")).toBeDefined();
    });

    it("마지막 단계면 다음 단계 대신 '2주 완주! 모든 단계를 달성했어요'를 보여 준다", () => {
      render(<LevelUp days={14} />);

      expect(screen.getByText("2주 완주! 모든 단계를 달성했어요")).toBeDefined();
      expect(screen.queryByText(/다음 단계/)).toBeNull();
    });
  });

  describe("사용자 조작", () => {
    it("[계속하기]를 누르면 대화상자를 닫고 다음 할 일을 부른다", () => {
      const onContinue = vi.fn();
      render(<LevelUp days={8} onContinue={onContinue} />);

      fireEvent.click(screen.getByRole("button", { name: "계속하기" }));

      expect(screen.queryByRole("dialog")).toBeNull();
      expect(onContinue).toHaveBeenCalledTimes(1);
    });
  });

  describe("정리", () => {
    it("열려 있는 동안 뒤 페이지 스크롤을 잠그고 닫으면 푼다", () => {
      render(<LevelUp days={8} />);
      expect(document.documentElement.style.overflow).toBe("hidden");

      fireEvent.click(screen.getByRole("button", { name: "계속하기" }));

      expect(document.documentElement.style.overflow).toBe("");
    });
  });
});
