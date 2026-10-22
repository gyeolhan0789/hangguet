// three.js r152 examples/jsm/geometries/LightningStrike.js(MIT)의 쓰는 부분 타입.
// three 0.186에는 이 예제가 없어 면접 데모(interview_prototype)가 쓰던 r152 파일을 그대로 가져왔다.
import type { BufferGeometry, Vector3 } from "three";

export interface LightningStrikeParameters {
  sourceOffset: Vector3;
  destOffset: Vector3;
  radius0: number;
  radius1: number;
  minRadius: number;
  maxIterations: number;
  isEternal: boolean;
  birthTime: number;
  deathTime: number;
  timeScale: number;
  propagationTimeFactor: number;
  vanishingTimeFactor: number;
  subrayPeriod: number;
  subrayDutyCycle: number;
  maxSubrayRecursion: number;
  ramification: number;
  recursionProbability: number;
  roughness: number;
  straightness: number;
}

export class LightningStrike extends BufferGeometry {
  constructor(parameters?: Partial<LightningStrikeParameters>);
  update(time: number): void;
}
