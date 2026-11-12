// 기준: Figma S01-1 비밀번호 규칙 칩(8자 이상 · 영문 + 숫자)
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PasswordRules } from "./password-rules";

// 경계 mock: 연출(motion)은 건너뛴다. 규칙 판정 자체는 schemas 테스트가 본다
vi.mock("motion/react", async (importOriginal) =>
  (await import("@/test/motion")).reducedMotion(importOriginal),
);

describe("PasswordRules · 비밀번호 규칙 칩", () => {
  describe("화면 표시", () => {
    it("칩마다 규칙 충족 여부를 '충족' · '미충족'으로 알린다", () => {
      render(<PasswordRules password="abcdefgh" />);

      expect(screen.getAllByRole("listitem").map((chip) => chip.textContent)).toEqual([
        "8자 이상 충족",
        "영문 + 숫자 미충족",
      ]);
    });
  });
});
