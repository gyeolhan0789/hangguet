import type { Page } from "@playwright/test";

// 면접관 3D 모델(public/interview/<면접관>/interviewer.glb, 악마는 32MB) 대역. test가 실제 모델을 받지 않게 한다.

/** 모든 면접관의 3D 모델 주소(lib/interviewer/models.ts의 glb) */
const MODEL = "**/interview/*/interviewer.glb";

/** 노드 없는 장면 하나뿐인 가장 작은 glTF. 받기 · 해석이 바로 끝나고 화면에는 아무것도 그리지 않는다 */
const EMPTY_GLTF = JSON.stringify({ asset: { version: "2.0" }, scenes: [{ nodes: [] }], scene: 0 });

/**
 * 면접관 3D 모델 요청에 답하는 방식을 정한다. page.goto 전에 부른다.
 * - "empty": 빈 glTF로 바로 받는다. 받기가 끝나야 다음으로 가는 화면(S05 [면접 시작] · 채팅 대기 화면)에서 쓴다.
 * - "missing": 404. 404는 다시 받지 않아(retry.ts) 바로 정지 이미지가 나온다. 3D를 보지 않는 그 밖의 화면에서 쓴다.
 */
export async function routeInterviewerModel(page: Page, mode: "empty" | "missing") {
  await page.route(MODEL, (route) =>
    mode === "empty"
      ? route.fulfill({ status: 200, contentType: "model/gltf+json", body: EMPTY_GLTF })
      : route.fulfill({ status: 404 }),
  );
}
