import { useInterviewerPreloadStore } from "@/stores/interviewer-preload-store";
import type { Persona } from "@/types/api";

import { interviewerLook } from "./models";

// 면접관 3D 모델 미리 받기. 기준: 사용자 요청(2026-10-21: 이전 화면(S05 장치 점검)부터 받기,
// 2026-10-22: 다 받을 때까지 준비 줄을 띄우고 [면접 시작]을 막는다, 실패 상태에 따라 자동 재시도)
// · Figma S05(18:2333: 면접 플랜을 준비하는 동안 머무는 화면)

/** 받은 비율을 저장소에 반영하는 단위(1%). 받는 중에는 진행 소식이 아주 자주 와서 1%가 바뀔 때만 바꾼다 */
const STEP = 0.01;

/**
 * 면접관 모델을 미리 내려받아 해석해 두고, 그 상태를 useInterviewerPreloadStore에 둔다.
 * 같은 면접관을 이미 받는 중이거나 다 받았으면 아무것도 하지 않는다. 실패했으면 처음부터 다시 받는다.
 * 3D 모델이 없는 면접관은 받을 것이 없으므로 바로 다 받은 것으로 둔다.
 */
export function preloadInterviewer(persona: Persona) {
  const store = useInterviewerPreloadStore.getState();
  if (store.persona === persona && (store.status === "loading" || store.status === "ready")) return;
  const look = interviewerLook(persona);
  store.start(persona);
  if (!look) {
    store.finish(persona, "ready");
    return;
  }
  let reported = 0;
  // three.js는 이때 처음 불러온다(S05 첫 화면을 늦추지 않게).
  import("./scene")
    .then(({ preloadInterviewerAssets }) =>
      preloadInterviewerAssets(look.model, (ratio) => {
        if (ratio - reported < STEP && ratio < 1) return;
        reported = ratio;
        useInterviewerPreloadStore.getState().setProgress(persona, ratio);
      }),
    )
    .then(() => useInterviewerPreloadStore.getState().finish(persona, "ready"))
    .catch(() => useInterviewerPreloadStore.getState().finish(persona, "failed"));
}
