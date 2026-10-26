// 기준: Figma 화이트모드 I01 ~ I04 버튼(기본 높이 54 · 둥글기 14 · 17 Bold / 작은 버튼 높이 44 · 둥글기 12 · 15 Bold,
// 주 버튼 brand-strong · 보조 버튼 bg-sub + line 테두리 text-2)
// 서버 컴포넌트(I02 · 비회원 레이아웃)의 링크에도 쓰므로 클라이언트 모듈(inquiry-ui)과 나눠 둔다.

const buttonBase =
  "flex shrink-0 cursor-pointer items-center justify-center font-bold leading-normal focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-40";
const SIZE = {
  md: "h-[54px] rounded-[14px] px-6 text-[17px]",
  sm: "h-11 rounded-xl px-[18px] text-[15px]",
};
const KIND = {
  primary: "bg-brand-strong text-white",
  secondary: "border border-line bg-bg-sub text-text-2",
};

export function inquiryButtonClass(kind: keyof typeof KIND, size: keyof typeof SIZE = "md") {
  return `${buttonBase} ${SIZE[size]} ${KIND[kind]}`;
}

export type InquiryButtonKind = keyof typeof KIND;
export type InquiryButtonSize = keyof typeof SIZE;
