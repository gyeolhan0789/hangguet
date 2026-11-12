// 기준: Figma S03 Stepper(18:2052, 진행 중인 단계) · S04 Stepper(18:2141, 끝난 단계: 체크 + 주황 연결선)
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PracticeSteps } from "./practice-steps";

const steps = () => screen.getAllByRole("listitem");

describe("PracticeSteps · 연습 준비 단계 표시", () => {
  describe("화면 표시", () => {
    it("지금 단계에 현재 단계 표시를 단다", () => {
      render(<PracticeSteps current={3} />);

      const current = steps().filter((step) => step.getAttribute("aria-current") === "step");
      expect(current).toHaveLength(1);
      expect(current[0].textContent).toBe("3면접 방식");
    });

    it("지금보다 앞 단계는 완료로 읽힌다", () => {
      render(<PracticeSteps current={3} />);

      expect(steps()[0].textContent).toBe("지원서 완료");
      expect(steps()[1].textContent).toBe("면접관 선택 완료");
    });

    it("지금보다 뒤 단계는 번호를 보여 주고 완료로 읽히지 않는다", () => {
      render(<PracticeSteps current={3} />);

      expect(steps()[3].textContent).toBe("4장치 점검");
      expect(steps()[4].textContent).toBe("5면접");
    });
  });
});
