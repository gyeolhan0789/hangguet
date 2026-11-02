// 동의 줄 오른쪽 [보기]. 기준: Figma S01-1 동의 줄의 '보기'(13 SemiBold text-3). 가입 · 비회원 문의 폼이 함께 쓴다.

export function LegalViewButton({ title, onClick }: { title: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={`${title} 보기`}
      onClick={onClick}
      className="cursor-pointer rounded-md text-[13px] leading-normal font-semibold text-text-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
    >
      보기
    </button>
  );
}
