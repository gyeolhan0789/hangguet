// @vitest-environment node
// 기준: 면접관 3D 모델 웹 미리보기(office_animation/web face-surface.js) · WEB_FACE_RESTORE_REPORT.json(법선 오차 0)
import { BufferAttribute, BufferGeometry, Mesh } from "three";
import { describe, expect, it } from "vitest";

import { createFaceSurface } from "./face-surface";

// 예시 데이터: XY 평면의 삼각형 하나(앞쪽 +Z). 표정(모프)은 세 번째 점을 +Z로 1만큼 들어 올린다
const TRIANGLE = [0, 0, 0, 1, 0, 0, 0, 1, 0];
const FACING = [0, 0, 1, 0, 0, 1, 0, 0, 1];
const LIFTED_DELTA = [0, 0, 0, 0, 0, 0, 0, 0, 1];
const LIFTED_ABSOLUTE = [0, 0, 0, 1, 0, 0, 0, 1, 1];
/** 세 번째 점을 들어 올린 삼각형의 법선(0, -1, 1)/√2 */
const TILTED = [0, -Math.SQRT1_2, Math.SQRT1_2];

function mesh({
  positions = TRIANGLE,
  normals = FACING,
  index,
  morph,
  relative = true,
}: {
  positions?: number[];
  normals?: number[];
  index?: number[];
  morph?: number[];
  relative?: boolean;
} = {}) {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute("normal", new BufferAttribute(new Float32Array(normals), 3));
  if (index) geometry.setIndex(index);
  if (morph) {
    geometry.morphAttributes.position = [new BufferAttribute(new Float32Array(morph), 3)];
    geometry.morphTargetsRelative = relative;
  }
  const face = new Mesh(geometry);
  face.morphTargetInfluences = morph ? [0] : [];
  return face;
}

/** 정점 하나의 법선 */
function normalAt(face: Mesh, vertex: number) {
  const normal = face.geometry.attributes.normal;
  return [normal.getX(vertex), normal.getY(vertex), normal.getZ(vertex)];
}

function expectNormal(actual: number[], expected: number[]) {
  expect(actual[0]).toBeCloseTo(expected[0]);
  expect(actual[1]).toBeCloseTo(expected[1]);
  expect(actual[2]).toBeCloseTo(expected[2]);
}

// 예시 데이터: 모서리 형상. 두 삼각형이 (0,0,0)을 겹친 정점(0번 · 3번)으로 나눠 갖고 서로 수직으로 꺾인다
function fold(secondNormal: number[]) {
  return mesh({
    positions: [...TRIANGLE, 0, 0, 0, 0, 0, 1, 1, 0, 0],
    normals: [...FACING, ...secondNormal, ...secondNormal, ...secondNormal],
  });
}

describe("createFaceSurface · 얼굴 법선 다시 구하기", () => {
  describe("정상 처리", () => {
    it("표정(모프)을 섞은 최종 모양으로 법선을 다시 구한다", () => {
      const face = mesh({ index: [0, 1, 2], morph: LIFTED_DELTA });
      const update = createFaceSurface([face]);

      face.morphTargetInfluences = [1];
      update();

      expectNormal(normalAt(face, 0), TILTED);
    });

    it("같은 위치 · 같은 원래 법선의 정점은 같은 법선을 갖고, 원래 법선이 다르면 따로 구한다", () => {
      const joined = fold([0, 0, 1]);
      const split = fold([0, 1, 0]);

      createFaceSurface([joined])();
      createFaceSurface([split])();

      expectNormal(normalAt(joined, 0), [0, Math.SQRT1_2, Math.SQRT1_2]);
      expectNormal(normalAt(joined, 3), [0, Math.SQRT1_2, Math.SQRT1_2]);
      expectNormal(normalAt(split, 0), [0, 0, 1]);
      expectNormal(normalAt(split, 3), [0, 1, 0]);
    });

    it.each([
      { label: "상대 모프", morph: LIFTED_DELTA, relative: true },
      { label: "절대 모프", morph: LIFTED_ABSOLUTE, relative: false },
    ])("'$label'를 맞게 섞는다", ({ morph, relative }) => {
      const face = mesh({ morph, relative });
      const update = createFaceSurface([face]);

      face.morphTargetInfluences = [1];
      update();

      expectNormal(normalAt(face, 2), TILTED);
    });

    it("인덱스가 없는 메시도 세 점씩 면으로 구한다", () => {
      const face = mesh({ normals: [1, 0, 0, 1, 0, 0, 1, 0, 0] });

      createFaceSurface([face])();

      expectNormal(normalAt(face, 1), [0, 0, 1]);
    });
  });

  describe("상태 변화", () => {
    it("표정이 바뀌지 않은 프레임은 다시 구하지 않는다", () => {
      const face = mesh({ index: [0, 1, 2], morph: LIFTED_DELTA });
      const update = createFaceSurface([face]);
      update();
      // 다시 구하면 덮어써질 표시 값
      (face.geometry.attributes.normal.array as Float32Array).fill(9);

      update();
      expect(normalAt(face, 0)).toEqual([9, 9, 9]);

      face.morphTargetInfluences = [1];
      update();
      expectNormal(normalAt(face, 0), TILTED);
    });

    it("같은 형상으로 다시 만들어도 처음 원래 법선을 기준으로 삼는다", () => {
      // 세 점이 한 줄이라 면 법선이 0이고, 원래 법선을 그대로 쓰게 되는 형상
      const face = mesh({
        positions: [0, 0, 0, 1, 0, 0, 2, 0, 0],
        normals: [0, 1, 0, 0, 1, 0, 0, 1, 0],
      });
      createFaceSurface([face]);

      createFaceSurface([face])();

      expect(normalAt(face, 0)).toEqual([0, 1, 0]);
    });
  });

  describe("경계값", () => {
    it("면이 겹쳐 법선 합이 0이면 원래 법선을 쓴다", () => {
      const face = mesh({
        positions: [0, 0, 0, 1, 0, 0, 2, 0, 0],
        normals: [0, 1, 0, 0, 1, 0, 0, 1, 0],
      });

      createFaceSurface([face])();

      expect(normalAt(face, 1)).toEqual([0, 1, 0]);
    });
  });
});
