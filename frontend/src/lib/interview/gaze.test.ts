import type { FaceLandmarkerResult } from "@mediapipe/tasks-vision";
import { describe, expect, it } from "vitest";

import {
  EYE_PITCH_LIMIT,
  EYE_YAW_DEG,
  GAZE_YAW_LIMIT_DEG,
  gazeRatio,
  gazeSample,
  HEAD_PITCH_LIMIT_DEG,
  MIN_GAZE_SAMPLES,
  type GazeFrame,
  type GazeSample,
} from "./gaze";

// 기준: API 명세 5.8 gazeRatio(면접 동안 면접관을 바라본 시간 비율, %, 0~100, 재지 못했으면 보내지 않음)
// · MediaPipe Face Landmarker 결과(faceBlendshapes · facialTransformationMatrixes, 행렬은 열 우선 4×4)

const FRONT: GazeSample = { headYaw: 0, headPitch: 0, eyeYaw: 0, eyePitch: 0, blinking: false };

/** 얼굴 앞 방향이 (x, y, z)인 회전 행렬(열 우선)과 블렌드셰이프로 결과를 만든다 */
function result(
  blendshapes: Record<string, number>,
  forward: [number, number, number] = [0, 0, 1],
  size = 16,
): FaceLandmarkerResult {
  const data = Array<number>(size).fill(0);
  [data[8], data[9], data[10]] = forward;
  return {
    faceLandmarks: [[]],
    faceBlendshapes: [
      {
        categories: Object.entries(blendshapes).map(([categoryName, score], index) => ({
          index,
          score,
          categoryName,
          displayName: "",
        })),
        headIndex: 0,
        headName: "",
      },
    ],
    facialTransformationMatrixes: [{ rows: 4, columns: 4, data: data.slice(0, size) }],
  };
}

describe("gazeSample", () => {
  it("고개 좌우는 얼굴 앞 방향(행렬 세 번째 열)에서, 눈 좌우는 같은 쪽을 보는 eyeLook* 짝의 차에서 구한다", () => {
    const sample = gazeSample(
      result({ eyeLookOutLeft: 0.6, eyeLookInRight: 0.4 }, [
        Math.sin(Math.PI / 6),
        0,
        Math.cos(Math.PI / 6),
      ]),
    );

    expect(sample?.headYaw).toBeCloseTo(30);
    expect(sample?.headPitch).toBeCloseTo(0);
    expect(sample?.eyeYaw).toBeCloseTo(0.5);
    expect(sample?.blinking).toBe(false);
  });

  it("고개 위아래는 앞 방향의 y에서, 눈 위아래는 eyeLookUp − eyeLookDown에서 구한다", () => {
    const sample = gazeSample(
      result(
        { eyeLookUpLeft: 0.1, eyeLookUpRight: 0.1, eyeLookDownLeft: 0.5, eyeLookDownRight: 0.3 },
        [0, -Math.sin(Math.PI / 9), Math.cos(Math.PI / 9)],
      ),
    );

    expect(sample?.headPitch).toBeCloseTo(20);
    expect(sample?.eyePitch).toBeCloseTo(-0.3);
  });

  it("두 눈을 감으면 blinking", () => {
    expect(gazeSample(result({ eyeBlinkLeft: 0.9, eyeBlinkRight: 0.8 }))?.blinking).toBe(true);
  });

  it("얼굴이 없거나 변환 행렬이 모자라면 null", () => {
    expect(
      gazeSample({ faceLandmarks: [], faceBlendshapes: [], facialTransformationMatrixes: [] }),
    ).toBeNull();
    expect(gazeSample(result({}, [0, 0, 1], 12))).toBeNull();
  });
});

describe("gazeRatio", () => {
  it("얼굴이 잡힌 프레임이 너무 적으면 null(5.8에 보내지 않는다)", () => {
    expect(
      gazeRatio([...Array(MIN_GAZE_SAMPLES - 1).fill(FRONT), ...Array(50).fill(null)]),
    ).toBeNull();
  });

  it("그 면접의 중앙값을 정면으로 보고, 정면에서 기준보다 벗어난 프레임은 보지 않은 것으로 센다", () => {
    // 카메라가 모니터 위에 있어 면접관을 볼 때도 고개 · 눈이 아래를 향한다. 그 값이 정면이 된다
    const front = { ...FRONT, headYaw: 5, headPitch: -10, eyeYaw: 0.1, eyePitch: -0.3 };
    const away = [
      { ...front, headYaw: front.headYaw + GAZE_YAW_LIMIT_DEG + 1 },
      { ...front, headPitch: front.headPitch - HEAD_PITCH_LIMIT_DEG - 1 },
      { ...front, eyeYaw: front.eyeYaw - (GAZE_YAW_LIMIT_DEG + 1) / EYE_YAW_DEG },
      { ...front, eyePitch: front.eyePitch - EYE_PITCH_LIMIT - 0.01 },
    ];
    // 기준과 같은 만큼 벗어난 것은 본 것이다
    const edge = { ...front, headYaw: front.headYaw - GAZE_YAW_LIMIT_DEG };
    const frames = [...Array(195).fill(front), edge, ...Array(4).fill(away).flat()];

    // 212프레임(정면 195 · 경계 1 · 벗어남 16) 중 196프레임을 봤다 → 92.45%
    expect(frames).toHaveLength(212);
    expect(gazeRatio(frames)).toBe(92.45);
  });

  it("좌우는 고개와 눈을 합친 시선 방향으로 본다: 고개와 눈을 조금씩 같은 쪽으로 돌리면 안 본 것이다", () => {
    // 고개만, 눈만으로는 한계 안이지만 합치면 넘는다(실측: 화면 끝을 고개 5.7° + 눈 0.22로 봄)
    const half = GAZE_YAW_LIMIT_DEG * 0.6;
    const turned = { ...FRONT, headYaw: half, eyeYaw: half / EYE_YAW_DEG };
    // 고개를 돌리며 눈은 면접관에 둔 것(반대쪽)은 본 것이다
    const compensated = { ...FRONT, headYaw: half, eyeYaw: -half / EYE_YAW_DEG };

    expect(gazeRatio([...Array(150).fill(FRONT), ...Array(50).fill(turned)])).toBe(75);
    expect(gazeRatio([...Array(150).fill(FRONT), ...Array(50).fill(compensated)])).toBe(100);
  });

  it("얼굴이 잡히지 않은 프레임은 안 본 것으로 세고, 눈을 감은 프레임은 빼고 센다", () => {
    const frames: GazeFrame[] = [
      ...Array(150).fill(FRONT),
      ...Array(50).fill(null),
      // 깜빡이는 동안 눈 방향 점수가 튀어도 세지 않는다
      ...Array(30).fill({ ...FRONT, eyePitch: -0.9, blinking: true }),
    ];

    expect(gazeRatio(frames)).toBe(75);
  });
});
