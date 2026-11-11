"use client";

import { useEffect, useRef } from "react";

import { InquiryButton, InquiryModal } from "@/components/inquiry/inquiry-ui";
import type { LegalDocument } from "@/lib/legal/documents";

import { LegalDocumentView } from "./legal-document";

// 동의 항목의 [보기]로 여는 본문 모달. 기준: Figma S01-1의 [보기](본문 화면은 Figma에 없다)
// · 사용자 결정(2026-10-30: 빈칸은 알아서 — 보기는 모달, 모달 틀은 문의 모달(I01-1 · 480)과 같게)
// · WAI-ARIA 대화 상자 패턴: Esc로 닫고, 닫으면 연 버튼으로 포커스를 돌려준다. 긴 본문은 키보드로도 스크롤한다.

export function LegalModal({
  doc,
  onClose,
}: Readonly<{
  /** 보여 줄 본문. null이면 닫혀 있다 */
  doc: LegalDocument | null;
  onClose: () => void;
}>) {
  const open = doc !== null;
  const opener = useRef<HTMLElement | null>(null);
  const confirm = useRef<HTMLButtonElement>(null);
  // 부모가 매번 새 함수를 넘겨도 열려 있는 동안 효과를 다시 걸지 않게(다시 걸면 닫힐 때의 포커스 복귀가 먼저 돈다) 최신 값만 담아 둔다.
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });

  useEffect(() => {
    if (!open) return;
    // autoFocus는 이 효과보다 먼저 포커스를 옮겨 연 버튼을 잃으므로, 연 버튼을 기억한 뒤 [확인]으로 옮긴다.
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    confirm.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close.current();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      opener.current?.focus();
    };
  }, [open]);

  return (
    <InquiryModal open={open} labelledBy="legal-modal-title" width="w-[480px]">
      {doc && (
        <>
          <h2 id="legal-modal-title" className="text-2xl leading-normal font-bold text-text-1">
            {doc.title}
          </h2>
          <section
            aria-labelledby="legal-modal-title"
            tabIndex={0}
            className="mt-2 max-h-[60vh] overflow-y-auto rounded-md pr-1 focus-visible:outline-2 focus-visible:outline-brand"
          >
            <LegalDocumentView doc={doc} headingLevel={3} />
          </section>
          <InquiryButton ref={confirm} kind="primary" className="mt-6 w-full" onClick={onClose}>
            확인
          </InquiryButton>
        </>
      )}
    </InquiryModal>
  );
}
