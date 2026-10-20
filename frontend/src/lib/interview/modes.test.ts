import { describe, expect, it } from "vitest";

import { MODES } from "./modes";

describe("MODES (Figma S05-1 · Swagger 5.1 mode)", () => {
  // 화면 순서는 키보드 방향키 이동 순서이기도 하다(E2E 키보드 테스트의 전제).
  it("Figma 순서대로 화상 → 채팅이다", () => {
    expect(MODES.map(({ mode }) => mode)).toEqual(["VIDEO", "CHAT"]);
  });
});
