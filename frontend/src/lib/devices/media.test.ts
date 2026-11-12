// @vitest-environment node
// 기준: MDN getUserMedia Exceptions · Figma S05(18:2333) 체크 줄 · S05-E(18:4013) 권한 거부 · 모션 메모 S05(18:2492) 마이크 레벨
import { describe, expect, it } from "vitest";

import { mediaFailure, micLevel } from "./media";

/** RMS가 db(dB)인 표본 한 묶음(값 하나면 RMS = 그 값) */
const samplesAt = (db: number) => [10 ** (db / 20)];

describe("mediaFailure · 장치 오류 분류", () => {
  describe("정상 처리", () => {
    it.each([
      { name: "NotAllowedError", status: "denied" },
      { name: "SecurityError", status: "denied" },
      { name: "NotFoundError", status: "missing" },
      { name: "OverconstrainedError", status: "missing" },
      { name: "NotReadableError", status: "busy" },
      { name: "AbortError", status: "busy" },
    ])("getUserMedia 오류가 '$name'이면 '$status'로 바꾼다", ({ name, status }) => {
      expect(mediaFailure(new DOMException("실패", name))).toBe(status);
    });
  });

  describe("오류 처리", () => {
    it.each([
      { label: "TypeError", error: new TypeError("getUserMedia를 쓸 수 없어요") },
      { label: "null", error: null },
      { label: "문자열", error: "실패" },
    ])("알 수 없는 오류 · 이름 없는 값('$label')이면 unsupported로 본다", ({ error }) => {
      expect(mediaFailure(error)).toBe("unsupported");
    });
  });
});

describe("micLevel · 마이크 소리 크기", () => {
  describe("정상 처리", () => {
    it("-60dB와 -10dB 사이의 소리는 dB에 비례해 바꾼다(-35dB면 0.5다)", () => {
      expect(micLevel(samplesAt(-35))).toBeCloseTo(0.5, 10);
    });
  });

  describe("경계값", () => {
    it("입력이 비었으면 0이다", () => {
      expect(micLevel([])).toBe(0);
    });

    it.each([
      { db: -70, level: 0 },
      { db: -60, level: 0 },
      { db: -10, level: 1 },
      { db: 0, level: 1 },
    ])("'$db'dB면 '$level'로 자른다", ({ db, level }) => {
      expect(micLevel(samplesAt(db))).toBeCloseTo(level, 10);
    });
  });
});
