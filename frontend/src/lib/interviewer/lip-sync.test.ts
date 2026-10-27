import { describe, expect, it } from "vitest";

import {
  MOUTH_CLOSE_MS,
  MOUTH_MAX,
  MOUTH_OPEN_MS,
  mouthAt,
  mouthCues,
  mouthEndMs,
  mouthOf,
} from "./lip-sync";

// 기준: 면접관 표현 결정 ②(보간 열림 50ms · 닫힘 120ms, 상한 0.55)
// · 사용자 결정(2026-10-27: 중성으로 모음별 입 모양, 숫자 · 영어는 A를 약하게, 공백 · 문장 부호는 닫음)

describe("립싱크(글자별 발음 시각 → 입 모양)", () => {
  it("한글은 중성 모음으로 입 모양을 정한다", () => {
    const vowels = (text: string) => [...text].map((char) => mouthOf(char)?.vowel);
    expect(vowels("가야과")).toEqual(["A", "A", "A"]);
    expect(vowels("이위의")).toEqual(["I", "I", "I"]);
    expect(vowels("우유으")).toEqual(["U", "U", "U"]);
    expect(vowels("에애예얘외왜웨")).toEqual(["E", "E", "E", "E", "E", "E", "E"]);
    expect(vowels("오요워어여")).toEqual(["O", "O", "O", "O", "O"]);
    // 받침이 있어도 같은 모음이다
    expect(mouthOf("닭")).toEqual({ vowel: "A", weight: MOUTH_MAX });
  });

  it("숫자 · 영어는 A를 약하게 열고, 공백 · 문장 부호 · 낱자 자음은 닫는다", () => {
    expect(mouthOf("4")?.vowel).toBe("A");
    expect(mouthOf("B")!.weight).toBeLessThan(MOUTH_MAX);
    expect([" ", ",", "?", "ㅋ", ""].map(mouthOf)).toEqual([null, null, null, null, null]);
  });

  it("글자가 시작하면 50ms 동안 열고, 끝나면 120ms 동안 닫는다", () => {
    const cues = mouthCues([
      { char: "가", startMs: 100, endMs: 300 },
      { char: " ", startMs: 300, endMs: 350 },
    ]);

    expect(cues).toHaveLength(1);
    expect(mouthAt(cues, 99).A).toBe(0);
    expect(mouthAt(cues, 100 + MOUTH_OPEN_MS / 2).A).toBeCloseTo(MOUTH_MAX / 2);
    expect(mouthAt(cues, 200)).toEqual({ A: MOUTH_MAX, I: 0, U: 0, E: 0, O: 0 });
    expect(mouthAt(cues, 300 + MOUTH_CLOSE_MS / 2).A).toBeCloseTo(MOUTH_MAX / 2);
    expect(mouthAt(cues, 300 + MOUTH_CLOSE_MS).A).toBe(0);
    expect(mouthEndMs(cues)).toBe(300 + MOUTH_CLOSE_MS);
  });

  it("앞 글자를 닫는 동안 다음 글자를 열어 두 모음이 겹친다", () => {
    const cues = mouthCues([
      { char: "아", startMs: 0, endMs: 100 },
      { char: "이", startMs: 100, endMs: 200 },
    ]);

    const between = mouthAt(cues, 100 + MOUTH_OPEN_MS);
    expect(between.A).toBeGreaterThan(0);
    expect(between.I).toBe(MOUTH_MAX);
  });

  it("글자가 없으면 입을 닫은 채로 바로 끝난다", () => {
    expect(mouthEndMs(mouthCues([]))).toBe(0);
    expect(mouthAt([], 10)).toEqual({ A: 0, I: 0, U: 0, E: 0, O: 0 });
  });
});
