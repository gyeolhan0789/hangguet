// @vitest-environment node
import { Object3D, Euler } from "three";
import { describe, expect, it } from "vitest";
import { createHeadControl } from "./head";

describe("머리 동작", () => {
  it("로더의 이름 정리를 적용하고 회전이 누적되지 않으며 원래 자세로 복귀한다", () => {
    const root = new Object3D(),
      head = new Object3D();
    head.name = "DEF-spine006";
    root.add(head);
    head.quaternion.setFromEuler(new Euler(0.2, 0.1, 0.3));
    const rest = head.quaternion.clone();
    const move = createHeadControl(root, "DEF-spine.006");
    move(0.03, 0.02);
    const first = head.quaternion.clone();
    expect(first.equals(rest)).toBe(false);
    move(0.03, 0.02);
    expect(head.quaternion.equals(first)).toBe(true);
    move(0, 0);
    expect(head.quaternion.equals(rest)).toBe(true);
  });
  it("설정한 뼈대가 없으면 잘못된 모델로 판단한다", () => {
    expect(() => createHeadControl(new Object3D(), "Head")).toThrow("머리 뼈대");
  });
});
