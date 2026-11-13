import type { CheckStatus } from "./media";

// 카메라 · 마이크 점검 줄 설명. S05 장치 점검과 G01 대기실이 같이 쓴다.
// 기준: Figma S05 · S05-E 체크 줄 설명('잘 보이고 있어요' · '목소리가 잘 들려요' · '권한이 없어요').
// 확인 중 · 장치 없음 · 사용 중 · 끊김 · 미지원은 Figma에 없어 새로 정함(S05)

/** 확인하는 동안의 설명 */
export const CHECKING_TEXT = "확인하고 있어요";

const OK_TEXT = { camera: "잘 보이고 있어요", mic: "목소리가 잘 들려요" } as const;

const FAILURE_TEXT: Record<Exclude<CheckStatus, "checking" | "ok">, string> = {
  denied: "권한이 없어요",
  missing: "장치를 찾을 수 없어요",
  busy: "다른 앱이 사용 중이에요",
  ended: "연결이 끊겼어요",
  unsupported: "이 브라우저에서는 확인할 수 없어요",
};

/** 카메라 · 마이크 줄 설명 */
export function deviceText(device: keyof typeof OK_TEXT, status: CheckStatus): string {
  if (status === "checking") return CHECKING_TEXT;
  return status === "ok" ? OK_TEXT[device] : FAILURE_TEXT[status];
}
