// @vitest-environment node
// 기준: 면접관 3D 모델 웹 미리보기(office_animation/web app.js evaluate · facialWeights) · 모델 파일 face-rules.json 형식
import { describe, expect, it } from "vitest";

import {
  evaluate,
  faceInputs,
  faceWeights,
  NEUTRAL_FACE,
  type FaceExpr,
  type FaceRules,
} from "./face-rules";

// 예시 데이터: face-rules.json과 같은 모양의 작은 규칙(조절 값 · 고정 값 · 다른 셰이프 키 참조)
const RULES: FaceRules = {
  defaults: { A: 0, Blink: 0, SurfaceStability: 0.3 },
  rules: {
    Head: {
      Open: { expr: ["*", ["v", "a"], ["n", 2]], vars: { a: ["control", "A"] } },
      Mixed: {
        expr: ["sum", ["v", "a"], ["v", "fixed"], ["v", "open"]],
        vars: { a: ["control", "A"], fixed: ["const", 0.1], open: ["key", "Head", "Open"] },
      },
      LoopA: { expr: ["v", "b"], vars: { b: ["key", "Head", "LoopB"] } },
      LoopB: { expr: ["v", "a"], vars: { a: ["key", "Head", "LoopA"] } },
      Infinite: { expr: ["/", ["n", 1], ["n", 0]], vars: {} },
    },
  },
};
const MOUTH_A = { ...NEUTRAL_FACE, mouth: { ...NEUTRAL_FACE.mouth, A: 0.25 } };

describe("evaluate · 표정 식 계산", () => {
  describe("정상 처리", () => {
    it.each<{ op: string; expr: FaceExpr; result: number }>([
      { op: "+", expr: ["+", ["n", 1], ["n", 2]], result: 3 },
      { op: "-", expr: ["-", ["n", 1], ["n", 2]], result: -1 },
      { op: "*", expr: ["*", ["n", 2], ["n", 4]], result: 8 },
      { op: "/", expr: ["/", ["n", 1], ["n", 4]], result: 0.25 },
      { op: "pow", expr: ["pow", ["n", 2], ["n", 3]], result: 8 },
      { op: "neg", expr: ["neg", ["n", 2]], result: -2 },
      { op: "pos", expr: ["pos", ["n", 2]], result: 2 },
      { op: "min", expr: ["min", ["n", 2], ["n", 1], ["n", 3]], result: 1 },
      { op: "max", expr: ["max", ["n", 2], ["n", 1], ["n", 3]], result: 3 },
      { op: "sin", expr: ["sin", ["n", Math.PI / 2]], result: 1 },
      { op: "cos", expr: ["cos", ["n", Math.PI]], result: -1 },
      { op: "abs", expr: ["abs", ["n", -2]], result: 2 },
      { op: "sum", expr: ["sum", ["n", 1], ["n", 2], ["n", 3]], result: 6 },
      { op: "average", expr: ["average", ["n", 1], ["n", 2], ["n", 3]], result: 2 },
    ])("연산자 '$op'를 계산한다", ({ expr, result }) => {
      expect(evaluate(expr, {})).toBeCloseTo(result);
    });

    it("숫자 · 변수 노드를 읽어 중첩 식을 계산한다", () => {
      expect(evaluate(["*", ["+", ["v", "a"], ["n", 1]], ["v", "b"]], { a: 0.5, b: 2 })).toBe(3);
    });
  });

  describe("경계값", () => {
    it("없는 변수는 0으로 읽는다", () => {
      expect(evaluate(["+", ["v", "a"], ["v", "없음"]], { a: 0.5 })).toBe(0.5);
    });
  });

  describe("오류 처리", () => {
    it("모르는 연산자면 오류를 던진다", () => {
      expect(() => evaluate(["log", ["n", 1]], {})).toThrow("모르는 표정 식: log");
    });
  });
});

describe("faceInputs · 표정 입력 값", () => {
  describe("정상 처리", () => {
    it("고른 감정만 세기를 갖고 나머지 감정은 0이다", () => {
      const inputs = faceInputs(RULES, { ...NEUTRAL_FACE, emotion: "Angry", emotionWeight: 0.7 });

      expect(inputs).toMatchObject({
        Joy: 0,
        Fun: 0,
        Angry: 0.7,
        Sorrow: 0,
        Smile: 0,
        Surprised: 0,
      });
    });

    it("입 모양 · 깜빡임은 기본값을 덮어쓴다", () => {
      const inputs = faceInputs(RULES, { ...MOUTH_A, blink: 1 });

      expect(inputs).toMatchObject({ A: 0.25, Blink: 1, SurfaceStability: 0.3 });
    });
  });
});

describe("faceWeights · 셰이프 키 세기", () => {
  describe("정상 처리", () => {
    it("조절 값 · 고정 값 · 다른 셰이프 키를 변수로 읽어 식을 계산한다", () => {
      // A 0.25 + 고정 0.1 + Open(0.25 × 2)
      expect(faceWeights(RULES, MOUTH_A)("Head", "Mixed")).toBeCloseTo(0.85);
    });
  });

  describe("경계값", () => {
    it("규칙이 없는 셰이프 키는 0이다", () => {
      expect(faceWeights(RULES, MOUTH_A)("Head", "없음")).toBe(0);
      expect(faceWeights(RULES, MOUTH_A)("없는 메시", "Open")).toBe(0);
    });
  });

  describe("오류 처리", () => {
    it("서로를 참조하며 도는 규칙이면 오류를 던진다", () => {
      expect(() => faceWeights(RULES, MOUTH_A)("Head", "LoopA")).toThrow("서로를 참조한다");
    });

    it("결과가 유한한 숫자가 아니면 오류를 던진다", () => {
      expect(() => faceWeights(RULES, MOUTH_A)("Head", "Infinite")).toThrow("숫자가 아니다");
    });
  });
});
