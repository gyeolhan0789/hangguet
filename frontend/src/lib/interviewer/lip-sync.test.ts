// @vitest-environment node
// 기준: AI 명세 6.3 interview.question alignment.chars · 면접관 표현 결정 ②(보간 열림 50ms · 닫힘 120ms, 상한 0.55)
// · 사용자 결정(2026-10-27: 중성으로 모음별 입 모양, 숫자 · 영어는 A를 약하게, 공백 · 문장 부호는 닫음)
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

const CLOSED = { A: 0, I: 0, U: 0, E: 0, O: 0 };

describe("mouthOf · 글자 입 모양", () => {
  describe("정상 처리", () => {
    it("한글은 받침과 상관없이 중성 모음의 입 모양을 최대 세기로 연다", () => {
      expect(mouthOf("강")).toEqual({ vowel: "A", weight: MOUTH_MAX });
      expect(mouthOf("권")).toEqual({ vowel: "O", weight: MOUTH_MAX });
    });

    it("숫자 · 영어는 A를 0.3만 연다", () => {
      expect(mouthOf("4")).toEqual({ vowel: "A", weight: 0.3 });
      expect(mouthOf("B")).toEqual({ vowel: "A", weight: 0.3 });
    });

    it("공백 · 문장 부호처럼 한글 · 숫자 · 영어가 아니면 null을 돌려준다", () => {
      expect(mouthOf(" ")).toBeNull();
      expect(mouthOf("?")).toBeNull();
    });
  });

  describe("입력 검증", () => {
    it("빈 글이면 null을 돌려준다", () => {
      expect(mouthOf("")).toBeNull();
    });
  });

  describe("경계값", () => {
    it("한글 음절 범위의 처음 '가'와 끝 '힣'은 입 모양을 정한다", () => {
      expect(mouthOf("가")).toEqual({ vowel: "A", weight: MOUTH_MAX });
      expect(mouthOf("힣")).toEqual({ vowel: "I", weight: MOUTH_MAX });
    });

    it.each([
      { label: "바로 앞", char: String.fromCodePoint(0xac00 - 1) },
      { label: "바로 뒤", char: String.fromCodePoint(0xd7a3 + 1) },
    ])("한글 음절 범위 '$label' 글자는 null을 돌려준다", ({ char }) => {
      expect(mouthOf(char)).toBeNull();
    });
  });
});

describe("mouthCues · 발음 시각표", () => {
  describe("정상 처리", () => {
    it("입 모양이 없는 글자는 빼고 시각표를 만든다", () => {
      expect(
        mouthCues([
          { char: "가", startMs: 0, endMs: 100 },
          { char: " ", startMs: 100, endMs: 150 },
          { char: "이", startMs: 150, endMs: 250 },
        ]),
      ).toEqual([
        { vowel: "A", weight: MOUTH_MAX, startMs: 0, endMs: 100 },
        { vowel: "I", weight: MOUTH_MAX, startMs: 150, endMs: 250 },
      ]);
    });
  });

  describe("입력 검증", () => {
    it("끝 시각이 시작보다 앞서면 시작 시각으로 맞춘다", () => {
      expect(mouthCues([{ char: "가", startMs: 200, endMs: 150 }])).toEqual([
        { vowel: "A", weight: MOUTH_MAX, startMs: 200, endMs: 200 },
      ]);
    });
  });
});

describe("mouthEndMs · 입을 다 닫는 시각", () => {
  describe("정상 처리", () => {
    it("가장 늦게 끝나는 글자에 닫는 시간 120ms를 더한다", () => {
      const cues = mouthCues([
        { char: "가", startMs: 0, endMs: 300 },
        { char: "이", startMs: 100, endMs: 200 },
      ]);

      expect(mouthEndMs(cues)).toBe(300 + MOUTH_CLOSE_MS);
    });
  });

  describe("경계값", () => {
    it("글자가 없으면 0을 돌려준다", () => {
      expect(mouthEndMs([])).toBe(0);
    });
  });
});

describe("mouthAt · 시각별 입 모양", () => {
  const cues = mouthCues([{ char: "가", startMs: 100, endMs: 300 }]);

  describe("정상 처리", () => {
    it("글자가 시작하면 50ms 동안 열어 최대 세기에 이른다", () => {
      expect(mouthAt(cues, 100 + MOUTH_OPEN_MS / 2).A).toBeCloseTo(MOUTH_MAX / 2);
      expect(mouthAt(cues, 100 + MOUTH_OPEN_MS)).toEqual({ ...CLOSED, A: MOUTH_MAX });
    });

    it("글자가 끝나면 120ms 동안 닫는다", () => {
      expect(mouthAt(cues, 300)).toEqual({ ...CLOSED, A: MOUTH_MAX });
      expect(mouthAt(cues, 300 + MOUTH_CLOSE_MS / 2).A).toBeCloseTo(MOUTH_MAX / 2);
    });

    it("같은 모음이 겹치면 더 큰 세기를 쓴다", () => {
      const overlap = mouthCues([
        { char: "아", startMs: 0, endMs: 100 },
        { char: "가", startMs: 100, endMs: 200 },
      ]);

      // 110ms: 앞 글자는 닫는 중(0.55 × 110/120), 뒤 글자는 여는 중(0.55 × 10/50) — 큰 쪽이 앞 글자다
      expect(mouthAt(overlap, 110).A).toBeCloseTo((MOUTH_MAX * 110) / 120);
    });
  });

  describe("경계값", () => {
    it.each([
      { label: "글자 시작 전", at: 99 },
      { label: "닫기가 끝난 시각", at: 300 + MOUTH_CLOSE_MS },
    ])("'$label'에는 입을 닫는다", ({ at }) => {
      expect(mouthAt(cues, at)).toEqual(CLOSED);
    });
  });
});
