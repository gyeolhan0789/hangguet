import type { FaceLandmarkerResult } from "@mediapipe/tasks-vision";

// 화상 면접 동안 면접관을 바라본 시간 비율(시선 비율) 계산. 측정은 use-gaze-tracker가 브라우저에서 한다.
// 기준: API 명세 5.8 gazeRatio(면접 동안 면접관을 바라본 시간 비율, %, 0~100, 재지 못했으면 보내지 않음)
// · MediaPipe Face Landmarker(블렌드셰이프 eyeLook* · eyeBlink* · 얼굴 변환 행렬, https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker)
// · 이해준 feedback/detection.md 3-1 시선 회피(눈 블렌드셰이프 + 고개 각도, 정면은 화면 속 면접관을 볼 때의 값)
//
// 면접관은 화면 속 아바타라 "정면"은 카메라가 아니라 면접관을 볼 때의 값이다. 카메라 위치 · 자세가 사람마다 달라
// 고정 값 대신 그 면접에서 잰 값의 중앙값을 정면으로 본다(면접 동안 대부분 면접관을 본다는 전제).

/** 얼굴이 잡힌 한 프레임의 시선. 고개는 도(°), 눈은 블렌드셰이프 점수 차(-1~1). 부호는 정면값과의 차이만 쓰므로 방향 약속은 없다 */
export interface GazeSample {
  headYaw: number;
  headPitch: number;
  eyeYaw: number;
  eyePitch: number;
  /** 눈을 감은 프레임. 눈 방향 점수가 튀므로 비율 계산에서 뺀다 */
  blinking: boolean;
}

/** 잰 프레임. 영상은 있는데 얼굴이 잡히지 않았으면 null(고개를 크게 돌렸거나 화면을 벗어남 → 안 본 것으로 센다) */
export type GazeFrame = GazeSample | null;

// 정면값에서 이만큼 벗어나면 면접관을 보지 않은 것으로 본다(2026-10-29 실측 2회로 정함).
// 화면 끝을 볼 때 눈만 돌리기도, 고개를 돌리기도 해서 좌우는 둘을 합친 시선 방향으로 가른다. 질문 말풍선 · 답변 자막을
// 읽을 때도 정면으로 치도록 GAZE_YAW_LIMIT_DEG를 잡았다. 위는 고개 위아래로 갈리고, 눈 위아래는 느슨하게 둔다.
/** 눈 좌우 점수 1을 몇 도로 볼지 */
export const EYE_YAW_DEG = 25;
export const GAZE_YAW_LIMIT_DEG = 7;
export const HEAD_PITCH_LIMIT_DEG = 5;
export const EYE_PITCH_LIMIT = 0.35;
/** 두 눈 eyeBlink 평균이 이 값을 넘으면 눈을 감은 것으로 본다(가설값) */
export const BLINK_LIMIT = 0.5;
/** 얼굴이 잡힌 프레임이 이보다 적으면(초당 10번 기준 10초) 비율을 내지 않는다 */
export const MIN_GAZE_SAMPLES = 100;

function score(categories: { categoryName: string; score: number }[], name: string) {
  return categories.find((category) => category.categoryName === name)?.score ?? 0;
}

/** 두 눈 eyeBlink 평균(0 뜸 ~ 1 감음). 얼굴이 없으면 null. 인상 판단 사진은 1초 동안 이 값이 가장 작은 프레임이다(AI 명세 6.3) */
export function blinkScore(result: FaceLandmarkerResult): number | null {
  const blendshapes = result.faceBlendshapes[0]?.categories;
  if (!blendshapes) return null;
  return (score(blendshapes, "eyeBlinkLeft") + score(blendshapes, "eyeBlinkRight")) / 2;
}

/** Face Landmarker 결과에서 시선 하나를 꺼낸다. 얼굴이 없거나 블렌드셰이프 · 변환 행렬이 없으면 null */
export function gazeSample(result: FaceLandmarkerResult): GazeFrame {
  const blendshapes = result.faceBlendshapes[0]?.categories;
  const matrix = result.facialTransformationMatrixes[0]?.data;
  if (!blendshapes || !matrix || matrix.length < 16) return null;
  // 변환 행렬은 열 우선 4×4다(MatrixData 기본 배치). 얼굴 앞 방향(z축)은 회전 부분의 세 번째 열이다.
  const [x, y, z] = [matrix[8], matrix[9], matrix[10]];
  const toDegrees = 180 / Math.PI;
  // 같은 쪽을 보는 짝: 왼쪽 눈 바깥(Out) · 오른쪽 눈 안쪽(In), 왼쪽 눈 안쪽(In) · 오른쪽 눈 바깥(Out)
  const one = score(blendshapes, "eyeLookOutLeft") + score(blendshapes, "eyeLookInRight");
  const other = score(blendshapes, "eyeLookInLeft") + score(blendshapes, "eyeLookOutRight");
  const up = score(blendshapes, "eyeLookUpLeft") + score(blendshapes, "eyeLookUpRight");
  const down = score(blendshapes, "eyeLookDownLeft") + score(blendshapes, "eyeLookDownRight");
  const blink = blinkScore(result) ?? 0;
  return {
    headYaw: Math.atan2(x, z) * toDegrees,
    headPitch: Math.atan2(-y, Math.hypot(x, z)) * toDegrees,
    eyeYaw: (one - other) / 2,
    eyePitch: (up - down) / 2,
    blinking: blink > BLINK_LIMIT,
  };
}

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * 시선 비율(%, 소수 둘째 자리) = 면접관을 본 프레임 ÷ 잰 프레임. 얼굴이 잡히지 않은 프레임은 안 본 것으로 세고,
 * 눈을 감은 프레임은 양쪽에서 뺀다. 얼굴이 잡힌 프레임이 MIN_GAZE_SAMPLES보다 적으면 null(5.8에 보내지 않는다).
 */
export function gazeRatio(frames: readonly GazeFrame[]): number | null {
  const faces = frames.filter((frame): frame is GazeSample => frame !== null && !frame.blinking);
  if (faces.length < MIN_GAZE_SAMPLES) return null;
  const front = {
    headYaw: median(faces.map((sample) => sample.headYaw)),
    headPitch: median(faces.map((sample) => sample.headPitch)),
    eyeYaw: median(faces.map((sample) => sample.eyeYaw)),
    eyePitch: median(faces.map((sample) => sample.eyePitch)),
  };
  const looking = faces.filter(
    (sample) =>
      Math.abs(sample.headYaw - front.headYaw + (sample.eyeYaw - front.eyeYaw) * EYE_YAW_DEG) <=
        GAZE_YAW_LIMIT_DEG &&
      Math.abs(sample.headPitch - front.headPitch) <= HEAD_PITCH_LIMIT_DEG &&
      Math.abs(sample.eyePitch - front.eyePitch) <= EYE_PITCH_LIMIT,
  ).length;
  const counted = frames.filter((frame) => !frame?.blinking).length;
  return Math.round((looking / counted) * 10_000) / 100;
}
