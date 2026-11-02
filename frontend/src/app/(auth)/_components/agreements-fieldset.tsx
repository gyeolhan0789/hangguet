"use client";

import { useState } from "react";
import type { UseFormRegisterReturn } from "react-hook-form";

import { Checkbox } from "@/components/form";
import { LegalModal } from "@/components/legal/legal-modal";
import { LegalViewButton } from "@/components/legal/legal-view-button";
import { AGREEMENT_ITEMS } from "@/lib/auth/schemas";
import {
  PRIVACY_CONSENT,
  RECORDING_CONSENT,
  TERMS_OF_SERVICE,
  type LegalDocument,
} from "@/lib/legal/documents";

// 가입 화면의 동의 줄(전체 동의 · 만 14세 확인 · 약관 3개 [보기]). 이메일 가입(S01-1)과 카카오 가입 약관 동의 모달(S01-3)이 같이 쓴다.
// 기준: Figma S01-1 Agreements(18:3816: bg-sub · 둥글기 12 · 패딩 16 · 간격 10 · 전체 동의 15 ExtraBold · 구분선 · 줄 14 Medium · 보기)
// · S01-3 약관 동의 모달(435:2189) · lib/legal/documents.ts · 사용자 결정(2026-10-30: 만 14세 이상 확인 추가, [보기]는 모달)

export type AgreementType = (typeof AGREEMENT_ITEMS)[number]["type"];

/** [보기]로 여는 본문. 만 14세 확인 줄은 본문이 없다 */
const AGREEMENT_DOCUMENTS: Partial<Record<AgreementType, LegalDocument>> = {
  TERMS: TERMS_OF_SERVICE,
  PRIVACY: PRIVACY_CONSENT,
  RECORDING: RECORDING_CONSENT,
};

export function AgreementsFieldset({
  checked,
  register,
  onToggleAll,
}: {
  /** 줄마다 체크했는지 */
  checked: Record<AgreementType, boolean>;
  /** 그 줄의 체크박스를 폼에 연결한다 */
  register: (type: AgreementType) => UseFormRegisterReturn;
  /** 전체 동의를 누르면 모든 줄을 같은 값으로 */
  onToggleAll: (next: boolean) => void;
}) {
  const [viewing, setViewing] = useState<LegalDocument | null>(null);
  const allAgreed = AGREEMENT_ITEMS.every(({ type }) => checked[type]);

  return (
    <>
      <fieldset className="flex flex-col gap-2.5 rounded-xl bg-bg-sub p-4">
        <legend className="sr-only">약관 동의</legend>
        <Checkbox checked={allAgreed} onChange={(e) => onToggleAll(e.target.checked)}>
          <span className="text-[15px] leading-normal font-extrabold text-text-1">전체 동의</span>
        </Checkbox>
        <span className="h-px bg-line" aria-hidden />
        {AGREEMENT_ITEMS.map(({ type, label }, i) => {
          const doc = AGREEMENT_DOCUMENTS[type];
          return (
            <div key={type} className="flex items-center gap-2.5">
              <Checkbox
                checked={checked[type]}
                delay={allAgreed ? i * 0.05 : 0}
                className="flex-1"
                {...register(type)}
              >
                <span className="text-sm leading-normal font-medium text-text-1">{label}</span>
              </Checkbox>
              {doc && <LegalViewButton title={doc.title} onClick={() => setViewing(doc)} />}
            </div>
          );
        })}
      </fieldset>

      <LegalModal doc={viewing} onClose={() => setViewing(null)} />
    </>
  );
}
