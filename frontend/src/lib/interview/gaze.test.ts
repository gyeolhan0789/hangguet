// @vitest-environment node
// 기준: API 명세 5.8 gazeRatio(면접 동안 면접관을 바라본 시간 비율, %, 0~100, 재지 못했으면 보내지 않음)
// · MediaPipe Face Landmarker 결과(faceBlendshapes · facialTransformationMatrixes, 행렬은 열 우선 4×4)
import type { FaceLandmarkerResult } from "@mediapipe/tasks-vision";
import { describe, expect, it } from "vitest";

import { blinkScore, gazeRatio, gazeSample, type GazeFrame, type GazeSample } from "./gaze";

// 예시 데이터: Face Landmarker 결과 모양(블렌드셰이프 점수 · 얼굴 앞 방향이 (x, y, z)인 열 우선 4×4 행렬)
function landmarks(
  blendshapes: Record<string, number>,
  forward: [number, number, number] = [0, 0, 1],
  matrixSize = 16,
): FaceLandmarkerResult {
  const data = Array<number>(16).fill(0);
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
    facialTransformationMatrixes: [{ rows: 4, columns: 4, data: data.slice(0, matrixSize) }],
  };
}
const NO_FACE: FaceLandmarkerResult = {
  faceLandmarks: [],
  faceBlendshapes: [],
  facialTransformationMatrixes: [],
};

// 예시 데이터: 시선 표본(정면 = 모두 0)
const FRONT: GazeSample = { headYaw: 0, headPitch: 0, eyeYaw: 0, eyePitch: 0, blinking: false };
const frames = (count: number, sample: Partial<GazeSample> = {}): GazeFrame[] =>
  Array.from({ length: count }, () => ({ ...FRONT, ...sample }));
const degrees = (value: number) => (value * Math.PI) / 180;

describe("blinkScore · 눈 감은 정도", () => {
  describe("정상 처리", () => {
    it("두 눈 eyeBlink 점수의 평균을 돌려준다", () => {
      expect(blinkScore(landmarks({ eyeBlinkLeft: 0.3, eyeBlinkRight: 0.5 }))).toBeCloseTo(0.4);
    });
  });

  describe("오류 처리", () => {
    it("얼굴이 없으면 null을 돌려준다", () => {
      expect(blinkScore(NO_FACE)).toBeNull();
    });
  });
});

describe("gazeSample · 한 프레임 시선", () => {
  describe("정상 처리", () => {
    it("고개 좌우 · 위아래는 얼굴 앞 방향(행렬 세 번째 열)의 각도(도)로 구한다", () => {
      // 오른쪽으로 30°, 위로 20° 돌린 얼굴의 앞 방향
      const forward: [number, number, number] = [
        Math.cos(degrees(20)) * Math.sin(degrees(30)),
        -Math.sin(degrees(20)),
        Math.cos(degrees(20)) * Math.cos(degrees(30)),
      ];

      const sample = gazeSample(landmarks({}, forward));

      expect(sample?.headYaw).toBeCloseTo(30);
      expect(sample?.headPitch).toBeCloseTo(20);
    });

    it("눈 좌우는 같은 쪽을 보는 eyeLook 짝의 차로, 위아래는 위 · 아래 점수 차로 구한다", () => {
      const sample = gazeSample(
        landmarks({
          eyeLookOutLeft: 0.6,
          eyeLookInRight: 0.4,
          eyeLookInLeft: 0.1,
          eyeLookOutRight: 0.1,
          eyeLookUpLeft: 0.1,
          eyeLookUpRight: 0.1,
          eyeLookDownLeft: 0.5,
          eyeLookDownRight: 0.3,
        }),
      );

      expect(sample?.eyeYaw).toBeCloseTo(0.4);
      expect(sample?.eyePitch).toBeCloseTo(-0.3);
    });
  });

  describe("경계값", () => {
    it.each([
      { average: "0.5", left: 0.5, right: 0.5, shown: "뜬", blinking: false },
      { average: "0.51", left: 0.52, right: 0.5, shown: "감은", blinking: true },
    ])(
      "두 눈 감은 정도 평균이 '$average'면 $shown 것으로 표시한다",
      ({ left, right, blinking }) => {
        expect(gazeSample(landmarks({ eyeBlinkLeft: left, eyeBlinkRight: right }))?.blinking).toBe(
          blinking,
        );
      },
    );
  });

  describe("오류 처리", () => {
    it.each([
      { label: "얼굴 없음", result: NO_FACE },
      {
        label: "변환 행렬 없음",
        result: { ...landmarks({}), facialTransformationMatrixes: [] },
      },
      { label: "행렬이 16칸 미만", result: landmarks({}, [0, 0, 1], 15) },
    ])("'$label'이면 null을 돌려준다", ({ result }) => {
      expect(gazeSample(result)).toBeNull();
    });
  });
});

describe("gazeRatio · 시선 비율", () => {
  describe("정상 처리", () => {
    it("그 면접의 중앙값을 정면으로 보고 정면 범위 안 프레임 비율(%)을 소수 둘째 자리까지 돌려준다", () => {
      // 카메라가 옆에 있어 늘 10° 돌린 채 본 사람: 10°가 정면이고, 30°로 돌린 3프레임만 안 본 것이다
      const ratio = gazeRatio([...frames(100, { headYaw: 10 }), ...frames(3, { headYaw: 30 })]);

      expect(ratio).toBe(97.09);
    });

    it("좌우는 고개와 눈을 합친 방향으로 본다(같은 쪽으로 조금씩 돌리면 넘고 반대로 돌리면 상쇄된다)", () => {
      // 고개 4° + 눈 0.16(= 4°)
      const sameSide = gazeRatio([...frames(100), ...frames(1, { headYaw: 4, eyeYaw: 0.16 })]);
      const opposite = gazeRatio([...frames(100), ...frames(1, { headYaw: 4, eyeYaw: -0.16 })]);

      expect(sameSide).toBe(99.01);
      expect(opposite).toBe(100);
    });

    it("얼굴이 잡히지 않은 프레임은 분모에 넣어 안 본 것으로 센다", () => {
      expect(gazeRatio([...frames(100), null, null, null, null])).toBe(96.15);
    });

    it("눈을 감은 프레임은 분자 · 분모에서 모두 뺀다", () => {
      expect(gazeRatio([...frames(100), ...frames(5, { headYaw: 30, blinking: true })])).toBe(100);
    });
  });

  describe("경계값", () => {
    it("얼굴이 잡힌 프레임이 99개면 null을 돌려준다", () => {
      expect(gazeRatio([...frames(99), null])).toBeNull();
    });

    it("얼굴이 잡힌 프레임이 100개면 비율을 낸다", () => {
      expect(gazeRatio(frames(100))).toBe(100);
    });

    it.each([
      { label: "좌우 7°", atLimit: { headYaw: 7 }, over: { headYaw: 7.01 } },
      { label: "고개 위아래 5°", atLimit: { headPitch: 5 }, over: { headPitch: 5.01 } },
      { label: "눈 위아래 0.35", atLimit: { eyePitch: 0.35 }, over: { eyePitch: 0.36 } },
    ])("'$label'는 기준과 같으면 본 것, 넘으면 안 본 것으로 센다", ({ atLimit, over }) => {
      expect(gazeRatio([...frames(100), ...frames(1, atLimit)])).toBe(100);
      expect(gazeRatio([...frames(100), ...frames(1, over)])).toBe(99.01);
    });

    it("프레임 수가 짝수면 가운데 두 값의 평균을 정면으로 본다", () => {
      // 0°와 10°가 50개씩이면 정면은 5°라 모두 범위(7°) 안이다
      expect(gazeRatio([...frames(50), ...frames(50, { headYaw: 10 })])).toBe(100);
    });
  });
});
