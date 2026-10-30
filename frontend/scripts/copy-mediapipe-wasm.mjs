// MediaPipe 얼굴 인식 WASM을 node_modules에서 public/mediapipe/wasm으로 복사한다(면접 시선 측정, use-gaze-tracker).
// 파일 하나가 13MB라 git에 넣지 않고 dev · build 전에 설치된 버전에서 복사한다. 패키지 버전과 WASM 버전이 항상 같다.
// FilesetResolver.forVisionTasks가 브라우저의 SIMD 지원에 따라 둘 중 하나를 받는다.
// 기준: https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker/web_js
import fs from "node:fs";

const FROM = "node_modules/@mediapipe/tasks-vision/wasm";
const TO = "public/mediapipe/wasm";
const FILES = [
  "vision_wasm_internal.js",
  "vision_wasm_internal.wasm",
  "vision_wasm_nosimd_internal.js",
  "vision_wasm_nosimd_internal.wasm",
];

fs.mkdirSync(TO, { recursive: true });
for (const file of FILES) fs.copyFileSync(`${FROM}/${file}`, `${TO}/${file}`);
