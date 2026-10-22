import type { Persona } from "@/types/api";

import { interviewerLook } from "./models";

// 면접관 3D 모델 미리 불러오기. 기준: 사용자 요청(2026-10-21: 면접관 로딩 — 이전 화면(S05 장치 점검)부터 불러오기)
// · Figma S05(18:2333: 면접 플랜을 준비하는 동안 머무는 화면)

/**
 * 면접관 모델을 미리 내려받아 해석해 둔다. three.js는 이때 처음 불러온다(S05 첫 화면을 늦추지 않게).
 * 실패해도 면접 화면이 다시 불러오므로 오류는 무시한다.
 */
export function preloadInterviewer(persona: Persona) {
  const look = interviewerLook(persona);
  if (!look) return;
  import("./scene")
    .then(({ preloadInterviewerAssets }) => preloadInterviewerAssets(look.model))
    .catch(() => {});
}
