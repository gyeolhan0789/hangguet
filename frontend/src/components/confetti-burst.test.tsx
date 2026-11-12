// 기준: S02-L 레벨업 데모의 종이폭죽 · 모션 메모 S08(18:2843: 배지 등장과 함께 색종이 6~20개 터짐)
import { describe, expect, it } from "vitest";

import { makeConfetti } from "./confetti-burst";

describe("makeConfetti · 종이폭죽 조각", () => {
  describe("정상 처리", () => {
    it("개수만큼 조각을 만들고 받은 색을 차례로 돌려 쓴다", () => {
      const pieces = makeConfetti(["#F00", "#0F0"], 5);

      expect(pieces.map((piece) => piece.color)).toEqual(["#F00", "#0F0", "#F00", "#0F0", "#F00"]);
    });
  });
});
