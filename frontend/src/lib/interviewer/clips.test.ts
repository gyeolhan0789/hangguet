// @vitest-environment node
import {
  AnimationClip,
  Euler,
  Group,
  InterpolateDiscrete,
  MathUtils,
  Object3D,
  Quaternion,
  QuaternionKeyframeTrack,
  Vector3,
  VectorKeyframeTrack,
  type KeyframeTrack,
} from "three";
import { describe, expect, it } from "vitest";

import { createHeadLift, scaleClip } from "./clips";

// 고개 들기(위에서 내려다보는 카메라를 올려다보게). 기준: clips.ts createHeadLift · 사용자 결정(2026-11-04)
// 믹서가 머리 회전을 새로 쓰지 않는 프레임(겹쳐 넘기기 시작 · 한 번 동작이 끝난 직후)에도 고개가 더 젖혀지지 않아야 한다.

function scene() {
  const root = new Group();
  const head = new Object3D();
  head.name = "Duck_Head";
  root.add(head);
  return { root, head };
}

const pitch = (head: Object3D) =>
  MathUtils.radToDeg(new Euler().setFromQuaternion(head.quaternion).x);

describe("createHeadLift", () => {
  it("믹서가 머리 회전을 쓰지 않는 프레임이 이어져도 든 각도가 쌓이지 않는다", () => {
    const { root, head } = scene();
    const move = createHeadLift(root, { node: "Duck_Head", degrees: 28 });

    for (let i = 0; i < 10; i++) move(() => {});

    expect(pitch(head)).toBeCloseTo(-28, 5);
  });

  it("믹서가 머리 회전을 쓰면 그 회전 위에 한 번만 더한다", () => {
    const { root, head } = scene();
    const move = createHeadLift(root, { node: "Duck_Head", degrees: 28 });

    move(() => head.quaternion.setFromEuler(new Euler(MathUtils.degToRad(-10), 0, 0)));
    move(() => {});

    expect(pitch(head)).toBeCloseTo(-38, 5);
  });

  it("들 각도가 없으면 믹서만 움직인다", () => {
    const { root, head } = scene();
    let moved = 0;

    createHeadLift(root, undefined)(() => moved++);

    expect(moved).toBe(1);
    expect(pitch(head)).toBeCloseTo(0, 5);
  });

  it("머리가 모델에 없으면 오류를 던진다(장면은 정지 이미지로 바꾼다)", () => {
    expect(() => createHeadLift(new Group(), { node: "Duck_Head", degrees: 28 })).toThrow();
  });
});

// 놀람 동작 줄이기. 기준: clips.ts scaleClip · 사용자 요청(2026-11-04: 놀랄 때 날개를 덜 펴고 고개를 덜 돌리고 덜 올리기)
describe("scaleClip", () => {
  const turn = (degrees: number) =>
    new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), MathUtils.degToRad(degrees)).toArray();
  const clip = () =>
    new AnimationClip("Duck_Surprise", 1, [
      new QuaternionKeyframeTrack(
        "Duck_Wing_L_Upper.quaternion",
        [0, 1],
        [...turn(10), ...turn(90)],
      ),
      new QuaternionKeyframeTrack(
        "Duck_Head.quaternion",
        [0, 1],
        [...turn(0), ...turn(40)],
        InterpolateDiscrete,
      ),
      new QuaternionKeyframeTrack("Duck_Tail.quaternion", [0, 1], [...turn(0), ...turn(60)]),
      new VectorKeyframeTrack("Duck_Wing_L_Upper.position", [0, 1], [0, 0, 0, 1, 1, 1]),
    ]);
  const angleAt = (track: KeyframeTrack, key: number) =>
    MathUtils.radToDeg(new Quaternion().fromArray(track.values, key * 4).angleTo(new Quaternion()));

  it("이름이 맞는 부위의 회전을 시작 자세에서 비율만큼만 움직인다", () => {
    const [wing, head] = scaleClip(clip(), { Duck_Wing: 0.5, Duck_Head: 0.5 }).tracks;

    expect(angleAt(wing, 0)).toBeCloseTo(10, 4);
    expect(angleAt(wing, 1)).toBeCloseTo(50, 4);
    expect(angleAt(head, 1)).toBeCloseTo(20, 4);
  });

  it("보간 방식과 비율이 없는 부위 · 회전이 아닌 트랙은 그대로 둔다", () => {
    const original = clip();
    const scaled = scaleClip(original, { Duck_Wing: 0.5, Duck_Head: 0.5 });

    expect(scaled.tracks[1].getInterpolation()).toBe(InterpolateDiscrete);
    expect(scaled.tracks[2]).toBe(original.tracks[2]);
    expect(scaled.tracks[3]).toBe(original.tracks[3]);
    expect(scaled.duration).toBe(1);
  });

  it("줄일 비율이 없으면 원래 클립을 그대로 쓴다", () => {
    const original = clip();

    expect(scaleClip(original)).toBe(original);
  });
});
