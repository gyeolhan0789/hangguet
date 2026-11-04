import type { Persona } from "@/types/api";

// 오리 면접관 호응 효과음. 기준: API 명세 면접방 메시지(오리 면접에서 화면은 답변 제출이 시작되면 호응 효과음을 한 번 재생한다.
// 채팅은 [답변 완료]로 5.7을 요청할 때, 화상 [답변 완료]는 answer.submit 응답이 accepted: true일 때, 화상 자동 제출은
// answer.state(autoSubmitted)를 받을 때. [다시 시도]로 다시 제출할 때는 재생하지 않는다. 재생에 실패하면 효과음 없이 진행하고,
// 화면에서만 재생하므로 녹화 · 다시보기에 들어가지 않는다) · 효과음 출처 public/interview/duck/CREDITS.txt

export const DUCK_CALL_URL = "/interview/duck/duck-call.mp3";

/** 효과음을 내는 면접관인지 */
export function hasDuckCall(persona: Persona): boolean {
  return persona === "DUCK";
}

let audio: HTMLAudioElement | null = null;

function duckCall(): HTMLAudioElement {
  audio ??= new Audio(DUCK_CALL_URL);
  return audio;
}

/** 효과음을 미리 받아 둔다(처음 제출할 때 늦게 나지 않게) */
export function preloadDuckCall() {
  try {
    duckCall().preload = "auto";
  } catch {
    // 소리를 낼 수 없는 환경이면 효과음 없이 진행한다
  }
}

/** 효과음을 처음부터 한 번 재생한다. 재생하지 못하면(자동 재생 막힘 · 파일 오류) 조용히 넘어간다 */
export function playDuckCall() {
  try {
    const sound = duckCall();
    sound.currentTime = 0;
    void sound.play().catch(() => {});
  } catch {
    // 소리를 낼 수 없는 환경이면 효과음 없이 진행한다
  }
}
