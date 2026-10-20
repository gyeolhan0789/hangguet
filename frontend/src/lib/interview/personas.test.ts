import { describe, expect, it } from "vitest";

import { parsePersona, PERSONAS } from "./personas";

describe("PERSONAS (Figma S04 · Swagger 5.1 persona)", () => {
  // 화면 순서는 키보드 방향키 이동 순서이기도 하다(E2E 키보드 테스트의 전제).
  it("Figma 순서대로 악마 면접관 → 개발자 커피챗이다", () => {
    expect(PERSONAS.map(({ persona }) => persona)).toEqual(["DEVIL", "COFFEE_CHAT"]);
  });
});

describe("parsePersona (주소의 persona)", () => {
  it.each(["DEVIL", "COFFEE_CHAT"] as const)("%s → 그대로", (value) => {
    expect(parsePersona(value)).toBe(value);
  });

  it.each([
    { label: "없음", value: undefined },
    { label: "빈 문자열", value: "" },
    { label: "소문자", value: "devil" },
    { label: "없는 면접관", value: "UNKNOWN" },
    { label: "객체에 원래 있는 이름", value: "toString" },
    { label: "여러 값", value: ["DEVIL"] },
  ])("$label → null", ({ value }) => {
    expect(parsePersona(value)).toBeNull();
  });
});
