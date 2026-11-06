// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { EMOTIONS, faceWeights, NEUTRAL_FACE, VOWELS, type FaceRules } from "./face-rules";
import { interviewerLook } from "./models";

// 면접관마다 모델과 함께 내보낸 자산(animation.json · face-rules.json)이 장면(scene.ts)이 읽는 형식을 따르는지 본다.
// 기준: scene.ts PoseSegments(poses · segments · poseEndpoints) · face-rules.ts
// · 사용자 결정(2026-10-26: 커피챗 면접관도 악마와 같은 코드 · 같은 자산 형식으로 그린다)
// · 오리 모델 안내(public/interview/duck/manifest.json: 자세 구간 대신 동작 클립을 이름으로 재생, 머리는 클립이 움직인다)

const PERSONAS = ["DEVIL", "COFFEE_CHAT", "DUCK"] as const;

/** GLB 안의 glTF JSON(노드 · 동작 이름) */
function gltfJson(glb: string) {
  const bytes = readFileSync(join(process.cwd(), "public", glb));
  const length = bytes.readUInt32LE(12);
  return JSON.parse(bytes.subarray(20, 20 + length).toString("utf-8")) as {
    nodes: { name?: string }[];
    animations?: { name?: string }[];
    meshes?: { extras?: { targetNames?: string[] } }[];
    images?: { mimeType?: string }[];
    extensionsRequired?: string[];
  };
}

const read = <T>(file: string) =>
  JSON.parse(readFileSync(join(process.cwd(), "public", file), "utf-8")) as T;

/** scene.ts의 PoseSegments와 같은 모양(그쪽은 내보내지 않는다) */
interface PoseSegments {
  poses: string[];
  segments: Record<string, { start: number; end: number }>;
  poseEndpoints: Record<string, [string, number]>;
}

describe.each(PERSONAS)("%s 면접관 자산", (persona) => {
  const { model, headBone } = interviewerLook(persona)!;
  const { animation, clips, staticPose } = model;

  it.runIf(staticPose)("고정 자세 모델은 전환 동작 · 옷 자세 모프 없이 WebP 텍스처를 쓴다", () => {
    const json = gltfJson(model.glb);
    expect(json.animations ?? []).toHaveLength(0);
    expect(
      json.meshes
        ?.flatMap((mesh) => mesh.extras?.targetNames ?? [])
        .some((name) => name.startsWith("BodyPose_")),
    ).toBe(false);
    expect(json.images?.length).toBeGreaterThan(0);
    expect(json.images?.every((image) => image.mimeType === "image/webp")).toBe(true);
    expect(json.extensionsRequired).toEqual(
      expect.arrayContaining(["EXT_texture_webp", "EXT_meshopt_compression"]),
    );
  });

  it.runIf(headBone)("리액션이 조절하는 머리 뼈대가 실제 모델에 존재한다", () => {
    expect(gltfJson(model.glb).nodes.some((node) => node.name === headBone)).toBe(true);
  });

  it.runIf(clips)("재생하는 동작 클립(대기 · 끄덕임 · 말하기 · 놀람)이 모두 모델에 있다", () => {
    const names = gltfJson(model.glb).animations?.map((clip) => clip.name) ?? [];
    expect(names).toEqual(
      expect.arrayContaining([clips!.idle, clips!.nod, clips!.talk, clips!.surprise]),
    );
  });

  it.runIf(animation)(
    "자세 구간은 read · rest · tilt 자세가 모두 어느 구간의 어디인지 가리킨다",
    () => {
      // scene.ts는 poseEndpoints.read가 가리키는 구간 · 진행도로 읽는 자세를 잡는다.
      const pose = read<PoseSegments>(animation!);
      expect([...pose.poses].sort()).toEqual(["read", "rest", "tilt"]);
      for (const segment of Object.values(pose.segments)) {
        expect(segment.start).toBeLessThanOrEqual(segment.end);
      }
      for (const name of pose.poses) {
        const [route, progress] = pose.poseEndpoints[name];
        expect(pose.segments[route], `${name} → ${route}`).toBeDefined();
        expect(progress).toBeGreaterThanOrEqual(0);
        expect(progress).toBeLessThanOrEqual(1);
      }
    },
  );

  it("표정 규칙은 모든 감정 · 입 모양 · 깜빡임에서 셰이프 키마다 숫자 세기를 낸다", () => {
    const rules = read<FaceRules>(model.faceRules);
    const faces = [
      NEUTRAL_FACE,
      { ...NEUTRAL_FACE, blink: 1 },
      ...EMOTIONS.map((emotion) => ({ ...NEUTRAL_FACE, emotion, emotionWeight: 1 })),
      ...VOWELS.map((vowel) => ({ ...NEUTRAL_FACE, mouth: { ...NEUTRAL_FACE.mouth, [vowel]: 1 } })),
    ];
    expect(Object.keys(rules.rules).length).toBeGreaterThan(0);
    for (const face of faces) {
      const weight = faceWeights(rules, face);
      for (const [mesh, keys] of Object.entries(rules.rules)) {
        for (const key of Object.keys(keys)) expect(Number.isFinite(weight(mesh, key))).toBe(true);
      }
    }
  });
});
