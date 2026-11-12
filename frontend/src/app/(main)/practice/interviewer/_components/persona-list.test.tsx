// 기준: Figma S04 Persona List(18:2171) · 토스트(18:4421) · 모션 메모 S04(18:2214: 토스트 '곧 만나요!')
// · 기획 메모 S04(마지막 줄 '또 다른 면접관'은 선택 불가)
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PersonaList } from "./persona-list";

// 경계 mock: 연출(motion)은 건너뛴다
vi.mock("motion/react", async (importOriginal) =>
  (await import("@/test/motion")).reducedMotion(importOriginal),
);

// 토스트 시각이 Date.now()라 가짜 타이머 기본값(Date도 함께 진행)으로 센다
beforeEach(() => {
  vi.useFakeTimers();
});

const comingSoon = () => screen.getByRole("button", { name: /또 다른 면접관을 만들고 있어요/ });
const toast = () => screen.getByRole("status").textContent;

describe("PersonaList · 면접관 목록", () => {
  describe("화면 표시", () => {
    it("고른 면접관의 라디오를 고른 상태로 보여 준다", () => {
      render(<PersonaList selected="COFFEE_CHAT" onSelect={vi.fn()} />);

      expect(
        (screen.getByRole("radio", { name: /개발자 커피챗/ }) as HTMLInputElement).checked,
      ).toBe(true);
      expect((screen.getByRole("radio", { name: /악마 면접관/ }) as HTMLInputElement).checked).toBe(
        false,
      );
    });
  });

  describe("사용자 조작", () => {
    it("'준비 중' 줄을 누르면 '곧 만나요!'를 알리고 면접관은 고르지 않는다", () => {
      const onSelect = vi.fn();
      render(<PersonaList selected={null} onSelect={onSelect} />);

      fireEvent.click(comingSoon());

      expect(toast()).toBe("곧 만나요!");
      expect(onSelect).not.toHaveBeenCalled();
    });
  });

  describe("시간 경과", () => {
    it("'곧 만나요!'는 2초 뒤 사라진다", () => {
      render(<PersonaList selected={null} onSelect={vi.fn()} />);
      fireEvent.click(comingSoon());

      act(() => vi.advanceTimersByTime(1999));
      expect(toast()).toBe("곧 만나요!");

      act(() => vi.advanceTimersByTime(1));
      expect(toast()).toBe("");
    });

    it("떠 있는 동안 다시 누르면 2초를 처음부터 다시 센다", () => {
      render(<PersonaList selected={null} onSelect={vi.fn()} />);
      fireEvent.click(comingSoon());
      act(() => vi.advanceTimersByTime(1500));

      fireEvent.click(comingSoon());

      act(() => vi.advanceTimersByTime(1999));
      expect(toast()).toBe("곧 만나요!");
      act(() => vi.advanceTimersByTime(1));
      expect(toast()).toBe("");
    });
  });
});
