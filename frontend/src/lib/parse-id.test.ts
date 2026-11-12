// @vitest-environment node
// 기준: Swagger 경로 값 applicationId · sessionId(양의 정수) · Next 문서 searchParams(string | string[] | undefined)
import { describe, expect, it } from "vitest";

import { parsePositiveId } from "./parse-id";

describe("parsePositiveId · 주소 id 읽기", () => {
  describe("정상 처리", () => {
    it("양의 정수 문자열이면 숫자로 바꾼다", () => {
      expect(parsePositiveId("12")).toBe(12);
    });
  });

  describe("입력 검증", () => {
    it.each([
      { label: "undefined", value: undefined },
      { label: "배열", value: ["1", "2"] },
      { label: "빈 문자열", value: "" },
      { label: "0", value: "0" },
      { label: "01", value: "01" },
      { label: "-1", value: "-1" },
      { label: "1.5", value: "1.5" },
      { label: "1e3", value: "1e3" },
      { label: " 1", value: " 1" },
      { label: "abc", value: "abc" },
    ])("값이 '$label'이면 null을 돌려준다", ({ value }) => {
      expect(parsePositiveId(value)).toBeNull();
    });
  });

  describe("경계값", () => {
    it.each([
      {
        label: "가장 큰 안전한 정수",
        value: String(Number.MAX_SAFE_INTEGER),
        expected: Number.MAX_SAFE_INTEGER,
      },
      { label: "그보다 1 큼", value: "9007199254740992", expected: null },
    ])("값이 '$label'이면 '$expected'를 돌려준다", ({ value, expected }) => {
      expect(parsePositiveId(value)).toBe(expected);
    });
  });
});
