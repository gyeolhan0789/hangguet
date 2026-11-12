// @vitest-environment node
// 기준: 면접관 고개 동작(기본 자세 위에 작은 pitch · roll 회전) · three PropertyBinding 노드 이름 정리 규칙
import { Euler, Object3D, Quaternion } from "three";
import { describe, expect, it } from "vitest";

import { createHeadControl } from "./head";

// 예시 데이터: 기본 자세가 조금 돌아가 있는 머리 뼈대(로더가 '.'을 지운 이름)
function headModel() {
  const root = new Object3D();
  const head = new Object3D();
  head.name = "DEF-spine006";
  head.quaternion.setFromEuler(new Euler(0.2, 0.1, 0.3));
  root.add(head);
  return { root, head, rest: head.quaternion.clone() };
}

describe("createHeadControl · 면접관 고개", () => {
  describe("정상 처리", () => {
    it("기본 자세 위에 pitch · roll 회전을 더한다", () => {
      const { root, head, rest } = headModel();
      const move = createHeadControl(root, "DEF-spine006");

      move(0.03, 0.02);

      const expected = rest
        .clone()
        .multiply(new Quaternion().setFromEuler(new Euler(0.03, 0, 0.02)));
      expect(head.quaternion.angleTo(expected)).toBeCloseTo(0, 6);
    });

    it("노드 이름이 로더 규칙으로 정리돼 있어도 머리 뼈대를 찾는다", () => {
      const { root, head, rest } = headModel();
      const move = createHeadControl(root, "DEF-spine.006");

      move(0.03, 0.02);

      const expected = rest
        .clone()
        .multiply(new Quaternion().setFromEuler(new Euler(0.03, 0, 0.02)));
      expect(head.quaternion.angleTo(expected)).toBeCloseTo(0, 6);
    });
  });

  describe("상태 변화", () => {
    it("여러 번 돌려도 회전이 쌓이지 않고 (0, 0)이면 기본 자세로 돌아간다", () => {
      const { root, head, rest } = headModel();
      const move = createHeadControl(root, "DEF-spine006");
      move(0.03, 0.02);
      const first = head.quaternion.clone();

      move(0.03, 0.02);
      expect(head.quaternion.equals(first)).toBe(true);
      move(0, 0);
      expect(head.quaternion.equals(rest)).toBe(true);
    });
  });

  describe("입력 검증", () => {
    it("뼈대 이름이 없으면 아무것도 돌리지 않는다", () => {
      const { root, head, rest } = headModel();
      const move = createHeadControl(root);

      move(0.03, 0.02);

      expect(head.quaternion.equals(rest)).toBe(true);
    });
  });

  describe("오류 처리", () => {
    it("이름을 준 뼈대가 모델에 없으면 오류를 던진다", () => {
      expect(() => createHeadControl(new Object3D(), "Head")).toThrow("머리 뼈대");
    });
  });
});
