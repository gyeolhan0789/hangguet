import { describe, expect, it } from "vitest";

import { parsePositiveId } from "./parse-id";

// parseApplicationId · parseSessionId는 이 함수를 그대로 쓴다.
describe("parsePositiveId (주소의 applicationId · sessionId)", () => {
  it.each([
    { value: "10", expected: 10 },
    { value: "1", expected: 1 },
  ])("$value → $expected", ({ value, expected }) => {
    expect(parsePositiveId(value)).toBe(expected);
  });

  it.each([
    { label: "없음", value: undefined },
    { label: "빈 문자열", value: "" },
    { label: "0", value: "0" },
    { label: "음수", value: "-1" },
    { label: "앞자리 0", value: "01" },
    { label: "소수", value: "1.5" },
    { label: "숫자 아님", value: "abc" },
    { label: "안전한 정수 범위 밖", value: "99999999999999999999" },
    { label: "여러 값", value: ["10", "11"] },
  ])("$label → null", ({ value }) => {
    expect(parsePositiveId(value)).toBeNull();
  });
});
