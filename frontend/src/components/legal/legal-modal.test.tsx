import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { LegalDocument } from "@/lib/legal/documents";

import { LegalModal } from "./legal-modal";

// [보기] 모달: 닫힘 · 열림, [확인] · Esc로 닫기, 닫으면 연 버튼으로 포커스 복귀. 기준: legal-modal.tsx 주석(WAI-ARIA 대화 상자 패턴)
const doc: LegalDocument = {
  title: "개인정보 수집 · 이용 동의",
  blocks: [{ kind: "paragraph", text: "동의 본문" }],
};

afterEach(() => {
  cleanup();
});

describe("LegalModal", () => {
  it("doc이 없으면 아무것도 그리지 않는다", () => {
    render(<LegalModal doc={null} onClose={vi.fn()} />);

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("doc이 있으면 제목을 이름으로 한 대화 상자와 키보드로 스크롤할 본문 영역을 보여 준다", () => {
    render(<LegalModal doc={doc} onClose={vi.fn()} />);

    expect(screen.getByRole("dialog", { name: doc.title })).toBeTruthy();
    const body = screen.getByRole("region", { name: doc.title });
    expect(body.tabIndex).toBe(0);
    expect(screen.getByText("동의 본문")).toBeTruthy();
  });

  it("[확인]과 Esc로 닫기를 요청한다", () => {
    const onClose = vi.fn();
    render(<LegalModal doc={doc} onClose={onClose} />);

    fireEvent.click(screen.getByRole("button", { name: "확인" }));
    fireEvent.keyDown(window, { key: "Escape" });

    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("닫히면 모달을 연 버튼으로 포커스를 돌려준다", () => {
    const { rerender } = render(
      <>
        <button type="button">보기</button>
        <LegalModal doc={null} onClose={vi.fn()} />
      </>,
    );
    const opener = screen.getByRole("button", { name: "보기" });
    opener.focus();

    rerender(
      <>
        <button type="button">보기</button>
        <LegalModal doc={doc} onClose={vi.fn()} />
      </>,
    );
    rerender(
      <>
        <button type="button">보기</button>
        <LegalModal doc={null} onClose={vi.fn()} />
      </>,
    );

    expect(document.activeElement).toBe(opener);
  });
});
