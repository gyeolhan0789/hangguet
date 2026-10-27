// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  EMOTIONS,
  evaluate,
  faceInputs,
  faceWeights,
  NEUTRAL_FACE,
  VOWELS,
  type FaceExpr,
  type FaceRules,
} from "./face-rules";

// 기준: 면접관 3D 모델 웹 미리보기(office_animation/web app.js evaluate · facialWeights) · 모델 파일 face-rules.json

const rules = JSON.parse(
  readFileSync(join(process.cwd(), "public/interview/devil/face-rules.json"), "utf-8"),
) as FaceRules;

describe("evaluate (표정 식)", () => {
  it.each<[FaceExpr, number]>([
    [["n", 3], 3],
    [["+", ["n", 1], ["n", 2]], 3],
    [["-", ["n", 1], ["n", 2]], -1],
    [["*", ["n", 2], ["n", 4]], 8],
    [["/", ["n", 1], ["n", 4]], 0.25],
    [["pow", ["n", 2], ["n", 3]], 8],
    [["neg", ["n", 2]], -2],
    [["pos", ["n", 2]], 2],
    [["min", ["n", 2], ["n", 1], ["n", 3]], 1],
    [["max", ["n", 2], ["n", 1], ["n", 3]], 3],
    [["abs", ["n", -2]], 2],
    [["sum", ["n", 1], ["n", 2], ["n", 3]], 6],
    [["average", ["n", 1], ["n", 2], ["n", 3]], 2],
    [["sin", ["n", 0]], 0],
    [["cos", ["n", 0]], 1],
  ])("%j → %d", (expr, result) => {
    expect(evaluate(expr, {})).toBeCloseTo(result);
  });

  it("변수는 값을 읽고, 없는 변수는 0이다", () => {
    expect(evaluate(["+", ["v", "a"], ["v", "없음"]], { a: 0.5 })).toBe(0.5);
  });

  it("모르는 연산자면 오류를 던진다(모델 파일이 바뀐 것)", () => {
    expect(() => evaluate(["log", ["n", 1]], {})).toThrow("모르는 표정 식: log");
  });
});

describe("faceInputs", () => {
  it("고른 감정만 세기를 갖고 나머지 감정은 0이다. 입 모양 · 눈 깜빡임도 넣는다", () => {
    const inputs = faceInputs(rules, {
      emotion: "Angry",
      emotionWeight: 0.7,
      mouth: { A: 0.8, I: 0, U: 0, E: 0, O: 0 },
      blink: 1,
    });
    expect(inputs.Angry).toBe(0.7);
    for (const other of EMOTIONS.filter((emotion) => emotion !== "Angry"))
      expect(inputs[other]).toBe(0);
    expect(inputs.A).toBe(0.8);
    expect(inputs.Blink).toBe(1);
    // 조절하지 않는 값은 모델 기본값 그대로
    expect(inputs.SurfaceStability).toBe(rules.defaults.SurfaceStability);
  });
});

describe("faceWeights (셰이프 키 세기)", () => {
  const tiny: FaceRules = {
    defaults: { A: 0 },
    rules: {
      Head: {
        Open: { expr: ["*", ["v", "a"], ["n", 2]], vars: { a: ["control", "A"] } },
        Follow: { expr: ["v", "o"], vars: { o: ["key", "Head", "Open"] } },
        LoopA: { expr: ["v", "b"], vars: { b: ["key", "Head", "LoopB"] } },
        LoopB: { expr: ["v", "a"], vars: { a: ["key", "Head", "LoopA"] } },
        Bad: { expr: ["/", ["n", 1], ["n", 0]], vars: {} },
      },
    },
  };
  const open = { ...NEUTRAL_FACE, mouth: { ...NEUTRAL_FACE.mouth, A: 0.25 } };

  it("조절 값으로 식을 계산하고, 다른 셰이프 키를 참조할 수 있다", () => {
    const weight = faceWeights(tiny, open);
    expect(weight("Head", "Open")).toBe(0.5);
    expect(weight("Head", "Follow")).toBe(0.5);
  });

  it("규칙이 없는 셰이프 키는 0이다", () => {
    expect(faceWeights(tiny, open)("Head", "없음")).toBe(0);
  });

  it("서로를 참조하며 도는 규칙 · 숫자가 아닌 결과는 오류를 던진다", () => {
    expect(() => faceWeights(tiny, open)("Head", "LoopA")).toThrow("서로를 참조한다");
    expect(() => faceWeights(tiny, open)("Head", "Bad")).toThrow("숫자가 아니다");
  });
});

describe("면접관 모델 face-rules.json", () => {
  const every = (face: typeof NEUTRAL_FACE) => {
    const weight = faceWeights(rules, face);
    return Object.entries(rules.rules).flatMap(([mesh, keys]) =>
      Object.keys(keys).map((key) => weight(mesh, key)),
    );
  };

  it("모든 감정 × 모든 입 모양 × 눈 깜빡임에서 모든 셰이프 키가 숫자로 계산된다", () => {
    for (const emotion of [...EMOTIONS, "neutral"] as const) {
      for (const vowel of VOWELS) {
        for (const blink of [0, 1]) {
          const weights = every({
            emotion,
            emotionWeight: 1,
            mouth: { ...NEUTRAL_FACE.mouth, [vowel]: 1 },
            blink,
          });
          expect(weights.every(Number.isFinite)).toBe(true);
        }
      }
    }
  });

  it("입 모양 · 눈 깜빡임을 바꾸면 셰이프 키 세기가 바뀐다", () => {
    const neutral = every(NEUTRAL_FACE);
    expect(every({ ...NEUTRAL_FACE, mouth: { ...NEUTRAL_FACE.mouth, A: 1 } })).not.toEqual(neutral);
    expect(every({ ...NEUTRAL_FACE, blink: 1 })).not.toEqual(neutral);
  });
});
