// 기준: Figma S01-1 Agreements(18:3816) · S01-3 약관 동의 모달(435:2189) · 사용자 결정(2026-10-30: 만 14세 이상 확인 추가, [보기]는 모달)
import { fireEvent, render, screen } from "@testing-library/react";
import type { UseFormRegisterReturn } from "react-hook-form";
import { describe, expect, it, vi } from "vitest";

import { AgreementsFieldset, type AgreementType } from "./agreements-fieldset";

// 경계 mock: 연출(motion)은 건너뛴다
vi.mock("motion/react", async (importOriginal) =>
  (await import("@/test/motion")).reducedMotion(importOriginal),
);

const ALL: Record<AgreementType, boolean> = {
  AGE: true,
  TERMS: true,
  PRIVACY: true,
  RECORDING: true,
};
const NONE: Record<AgreementType, boolean> = {
  AGE: false,
  TERMS: false,
  PRIVACY: false,
  RECORDING: false,
};

/** react-hook-form register 대역: 폼 연결 자체는 라이브러리 동작이라 모양만 맞춘다 */
const register = (type: AgreementType) =>
  ({ name: type, onChange: vi.fn(), onBlur: vi.fn(), ref: vi.fn() }) as UseFormRegisterReturn;

const allAgreed = () => screen.getByRole("checkbox", { name: "전체 동의" }) as HTMLInputElement;

describe("AgreementsFieldset · 가입 동의 줄", () => {
  describe("화면 표시", () => {
    it("모든 줄을 체크했으면 [전체 동의]가 체크된다", () => {
      render(<AgreementsFieldset checked={ALL} register={register} onToggleAll={vi.fn()} />);

      expect(allAgreed().checked).toBe(true);
    });

    it("한 줄이라도 빠지면 [전체 동의]가 체크되지 않는다", () => {
      render(
        <AgreementsFieldset
          checked={{ ...ALL, RECORDING: false }}
          register={register}
          onToggleAll={vi.fn()}
        />,
      );

      expect(allAgreed().checked).toBe(false);
    });
  });

  describe("사용자 조작", () => {
    it.each([
      { label: "모두 안 함", checked: NONE, next: true },
      { label: "모두 함", checked: ALL, next: false },
    ])(
      "[전체 동의]를 누르면 지금('$label')과 반대 값으로 모두 바꾸라고 알린다",
      ({ checked, next }) => {
        const onToggleAll = vi.fn();
        render(
          <AgreementsFieldset checked={checked} register={register} onToggleAll={onToggleAll} />,
        );

        fireEvent.click(allAgreed());

        expect(onToggleAll).toHaveBeenCalledWith(next);
      },
    );

    it("[보기]를 누르면 그 약관 본문을 모달로 연다", () => {
      render(<AgreementsFieldset checked={NONE} register={register} onToggleAll={vi.fn()} />);

      fireEvent.click(screen.getByRole("button", { name: "서비스 이용약관 보기" }));

      expect(screen.getByRole("dialog", { name: "서비스 이용약관" })).toBeDefined();
    });

    it("본문 모달을 닫으면 모달이 사라진다", () => {
      render(<AgreementsFieldset checked={NONE} register={register} onToggleAll={vi.fn()} />);
      fireEvent.click(screen.getByRole("button", { name: "서비스 이용약관 보기" }));

      fireEvent.click(screen.getByRole("button", { name: "확인" }));

      expect(screen.queryByRole("dialog")).toBeNull();
    });
  });
});
