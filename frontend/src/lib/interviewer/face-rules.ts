// 면접관 3D 모델의 표정 규칙. 모델과 함께 내보낸 face-rules.json(Blender 셰이프 키 드라이버를 옮긴 식)을 계산한다.
// 기준: 면접관 3D 모델 웹 미리보기(office_animation/web app.js facialWeights · evaluate) · 모델 파일 face-rules.json
// 감정 · 입 모양 · 눈 깜빡임은 서로 따로 조절하고, 그 값으로 각 셰이프 키 세기를 정한다.

/** 식 노드. ["n", 숫자] · ["v", 변수 이름] · [연산자, ...인자] */
export type FaceExpr = [string, ...unknown[]];

/** 변수의 출처. ["control", 조절 값 이름] · ["key", 메시 이름, 셰이프 키 이름] · 그 밖에는 [종류, 고정 값] */
export type FaceVarSource = ["control", string] | ["key", string, string] | [string, number];

export interface FaceRule {
  expr: FaceExpr;
  vars: Record<string, FaceVarSource>;
}

export interface FaceRules {
  /** 조절 값 기본값(A · I · U · E · O · Blink · Joy …) */
  defaults: Record<string, number>;
  /** 메시 이름 → 셰이프 키 이름 → 규칙 */
  rules: Record<string, Record<string, FaceRule>>;
}

/** 모델이 아는 감정(face-rules.json 조절 값). neutral은 모든 감정 0 */
export const EMOTIONS = ["Joy", "Fun", "Angry", "Sorrow", "Smile", "Surprised"] as const;
export type Emotion = (typeof EMOTIONS)[number] | "neutral";

/** 입 모양(모음) */
export const VOWELS = ["A", "I", "U", "E", "O"] as const;
export type Vowel = (typeof VOWELS)[number];

/** 표정 조절 값. 모두 0~1 */
export interface FaceControls {
  emotion: Emotion;
  emotionWeight: number;
  mouth: Record<Vowel, number>;
  blink: number;
}

export const NEUTRAL_FACE: FaceControls = {
  emotion: "neutral",
  emotionWeight: 0,
  mouth: { A: 0, I: 0, U: 0, E: 0, O: 0 },
  blink: 0,
};

/** 식 하나를 계산한다. 모르는 연산자면 오류를 던진다(모델 파일이 바뀐 것). */
export function evaluate(node: FaceExpr, vars: Record<string, number>): number {
  const [op, ...args] = node;
  if (op === "n") return args[0] as number;
  if (op === "v") return vars[args[0] as string] ?? 0;
  const a = args.map((arg) => evaluate(arg as FaceExpr, vars));
  switch (op) {
    case "+":
      return a[0] + a[1];
    case "-":
      return a[0] - a[1];
    case "*":
      return a[0] * a[1];
    case "/":
      return a[0] / a[1];
    case "pow":
      return a[0] ** a[1];
    case "neg":
      return -a[0];
    case "pos":
      return a[0];
    case "min":
      return Math.min(...a);
    case "max":
      return Math.max(...a);
    case "sin":
      return Math.sin(a[0]);
    case "cos":
      return Math.cos(a[0]);
    case "abs":
      return Math.abs(a[0]);
    case "sum":
      return a.reduce((x, y) => x + y, 0);
    case "average":
      return a.reduce((x, y) => x + y, 0) / a.length;
    default:
      throw new Error(`모르는 표정 식: ${op}`);
  }
}

/** 표정 조절 값을 규칙에 넣을 입력으로 바꾼다. 고른 감정만 세기를 갖고 나머지 감정은 0이다. */
export function faceInputs(rules: FaceRules, face: FaceControls): Record<string, number> {
  const inputs: Record<string, number> = { ...rules.defaults, ...face.mouth, Blink: face.blink };
  for (const emotion of EMOTIONS)
    inputs[emotion] = emotion === face.emotion ? face.emotionWeight : 0;
  return inputs;
}

/**
 * 메시 · 셰이프 키마다 세기를 구하는 함수를 만든다. 한 번 구한 값은 기억해 두고(다른 키가 참조한다),
 * 서로를 참조하며 도는 규칙이나 숫자가 아닌 결과는 오류로 알린다.
 */
export function faceWeights(rules: FaceRules, face: FaceControls) {
  const inputs = faceInputs(rules, face);
  const cache = new Map<string, number>();
  const pending = new Set<string>();

  function weight(mesh: string, key: string): number {
    const id = `${mesh}|${key}`;
    const known = cache.get(id);
    if (known !== undefined) return known;
    if (pending.has(id)) throw new Error(`표정 규칙이 서로를 참조한다: ${id}`);
    const rule = rules.rules[mesh]?.[key];
    if (!rule) {
      cache.set(id, 0);
      return 0;
    }
    pending.add(id);
    const vars: Record<string, number> = {};
    for (const [name, source] of Object.entries(rule.vars)) {
      if (source[0] === "control") vars[name] = inputs[source[1]] ?? 0;
      else if (source[0] === "key") vars[name] = weight(source[1] as string, source[2] as string);
      else vars[name] = source[1] as number;
    }
    const result = evaluate(rule.expr, vars);
    if (!Number.isFinite(result)) throw new Error(`표정 세기가 숫자가 아니다: ${id}`);
    pending.delete(id);
    cache.set(id, result);
    return result;
  }

  return weight;
}
