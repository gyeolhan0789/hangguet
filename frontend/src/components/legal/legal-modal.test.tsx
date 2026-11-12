// 기준: Figma S01-1의 [보기] · 사용자 결정(2026-10-30: 보기는 모달, 모달 틀은 문의 모달(I01-1 · 480)과 같게)
// · WAI-ARIA 대화 상자 패턴(Esc로 닫기 · 닫으면 연 버튼으로 포커스 복귀 · 긴 본문은 키보드로 스크롤)
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { LegalDocument } from "@/lib/legal/documents";

import { LegalModal } from "./legal-modal";

// 경계 mock: 연출(motion)은 건너뛴다
vi.mock("motion/react", async (importOriginal) =>
  (await import("@/test/motion")).reducedMotion(importOriginal),
);

// 예시 데이터: 비회원 문의 동의서 모양의 짧은 본문
const DOC: LegalDocument = {
  title: "개인정보 수집 · 이용 동의",
  blocks: [{ kind: "paragraph", text: "문의 답변을 위해 이메일을 수집합니다." }],
};

/** 모달을 연 버튼이 포커스를 가진 상태에서 모달을 연다 */
function renderOpenedFromButton(onClose = vi.fn()) {
  const view = render(
    <>
      <button type="button">보기</button>
      <LegalModal doc={null} onClose={onClose} />
    </>,
  );
  const opener = screen.getByRole("button", { name: "보기" });
  opener.focus();
  view.rerender(
    <>
      <button type="button">보기</button>
      <LegalModal doc={DOC} onClose={onClose} />
    </>,
  );
  const close = () =>
    view.rerender(
      <>
        <button type="button">보기</button>
        <LegalModal doc={null} onClose={onClose} />
      </>,
    );
  return { opener, close, onClose };
}

describe("LegalModal · 약관 보기 모달", () => {
  describe("화면 표시", () => {
    it("볼 문서가 없으면 모달을 그리지 않는다", () => {
      render(<LegalModal doc={null} onClose={vi.fn()} />);

      expect(screen.queryByRole("dialog")).toBeNull();
    });

    it("열리면 [확인]에 포커스를 준다", () => {
      render(<LegalModal doc={DOC} onClose={vi.fn()} />);

      expect(document.activeElement).toBe(screen.getByRole("button", { name: "확인" }));
    });
  });

  describe("사용자 조작", () => {
    it("[확인]을 누르면 닫기를 요청한다", () => {
      const onClose = vi.fn();
      render(<LegalModal doc={DOC} onClose={onClose} />);

      fireEvent.click(screen.getByRole("button", { name: "확인" }));

      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("Esc를 누르면 닫기를 요청한다", () => {
      const onClose = vi.fn();
      render(<LegalModal doc={DOC} onClose={onClose} />);

      fireEvent.keyDown(window, { key: "Escape" });

      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  describe("상태 변화", () => {
    it("열려 있는 동안 닫기 동작이 바뀌면 Esc는 새 동작을 부른다", () => {
      const before = vi.fn();
      const after = vi.fn();
      const { rerender } = render(<LegalModal doc={DOC} onClose={before} />);
      rerender(<LegalModal doc={DOC} onClose={after} />);

      fireEvent.keyDown(window, { key: "Escape" });

      expect(after).toHaveBeenCalledTimes(1);
      expect(before).not.toHaveBeenCalled();
    });
  });

  describe("정리", () => {
    it("닫히면 모달을 연 버튼으로 포커스를 돌려준다", () => {
      const { opener, close } = renderOpenedFromButton();

      close();

      expect(document.activeElement).toBe(opener);
    });

    it("닫히면 Esc를 더 이상 받지 않는다", () => {
      const { close, onClose } = renderOpenedFromButton();
      close();

      fireEvent.keyDown(window, { key: "Escape" });

      expect(onClose).not.toHaveBeenCalled();
    });
  });
});
