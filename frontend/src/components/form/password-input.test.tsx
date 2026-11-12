// 기준: Figma S01 로그인 비밀번호 칸(Icon eye-off로 보이기 · 숨기기)
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PasswordInput } from "./password-input";

describe("PasswordInput · 비밀번호 입력칸", () => {
  describe("화면 표시", () => {
    it("처음에는 비밀번호를 가린다", () => {
      render(<PasswordInput aria-label="비밀번호" />);

      expect(screen.getByLabelText("비밀번호").getAttribute("type")).toBe("password");
    });
  });

  describe("사용자 조작", () => {
    it("[비밀번호 보기]를 누르면 글자를 보여 주고 버튼이 [비밀번호 숨기기]로 바뀐다", () => {
      render(<PasswordInput aria-label="비밀번호" />);

      fireEvent.click(screen.getByRole("button", { name: "비밀번호 보기" }));

      expect(screen.getByLabelText("비밀번호").getAttribute("type")).toBe("text");
      expect(
        screen.getByRole("button", { name: "비밀번호 숨기기" }).getAttribute("aria-pressed"),
      ).toBe("true");
    });
  });
});
