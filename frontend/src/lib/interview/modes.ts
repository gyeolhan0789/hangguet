import type { Mode } from "@/types/api";

// 기준: Swagger 5.1 SessionCreateRequest.mode(VIDEO · CHAT) · Figma S05-1 Options(18:2269) · 기획 메모 S05-1(18:1013)

export interface ModeInfo {
  mode: Mode;
  title: string;
  /** 두 줄 설명 */
  description: readonly [string, string];
  /** 카드 아래 칩(아이콘 · 문구) */
  chips: readonly { icon: string; label: string }[];
  /** 아이콘 타일(28px) */
  icon: string;
  /** [다음] 버튼 문구. 화상은 S05 장치 점검, 채팅은 S05를 건너뛰고 바로 면접(기획 메모 S05-1) */
  nextLabel: string;
}

// Record<Mode, …>라서 Mode에 값이 늘거나 줄면 여기서 컴파일 오류가 난다. 적은 순서가 화면 순서(Figma)다.
const MODE_INFO = {
  VIDEO: {
    title: "화상으로 할래요",
    description: ["3D 면접관과 마주 보고", "말로 묻고 답해요"],
    chips: [
      { icon: "/practice/icon-camera.svg", label: "카메라 · 마이크 필요" },
      { icon: "/practice/icon-zap.svg", label: "실전 느낌" },
    ],
    icon: "/practice/icon-video.svg",
    nextLabel: "다음: 장치 점검",
  },
  CHAT: {
    title: "채팅으로 할래요",
    description: ["텍스트로 편하게", "생각을 정리하며 답해요"],
    chips: [
      { icon: "/practice/icon-keyboard.svg", label: "장치 없이 바로" },
      { icon: "/practice/icon-volume-x.svg", label: "조용한 곳 아니어도 OK" },
    ],
    icon: "/practice/icon-message-square.svg",
    nextLabel: "면접 시작",
  },
} satisfies Record<Mode, Omit<ModeInfo, "mode">>;

/** 5.1이 받는 면접 방식 값(Figma 순서). 검증 스키마도 이 목록을 쓴다. */
export const MODE_VALUES = Object.keys(MODE_INFO) as Mode[];

/** S05-1에서 고를 수 있는 면접 방식(Figma 순서) */
export const MODES: readonly ModeInfo[] = MODE_VALUES.map((mode) => ({ mode, ...MODE_INFO[mode] }));

export const modeInfo = (mode: Mode): ModeInfo => ({ mode, ...MODE_INFO[mode] });

/** 주소의 mode 값을 읽는다. 5.1 · 10.1이 받는 값이 아니면 null */
export function parseMode(value: string | string[] | undefined): Mode | null {
  return typeof value === "string" && Object.hasOwn(MODE_INFO, value) ? (value as Mode) : null;
}

/** 칩 · 요약에 쓰는 짧은 이름(Figma [초안] G02 '면접 방식' 칩 · G01 부제목) */
export const MODE_SHORT_LABEL = { VIDEO: "화상", CHAT: "채팅" } as const satisfies Record<
  Mode,
  string
>;
