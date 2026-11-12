// @vitest-environment node
// 기준: Swagger 5.1 SessionCreateRequest.persona(DEVIL · COFFEE_CHAT · DUCK)
import { describe, expect, it } from "vitest";

import { parsePersona } from "./personas";

describe("parsePersona · 주소의 면접관 값", () => {
  describe("정상 처리", () => {
    it("'DEVIL'이면 그 값을 돌려준다", () => {
      expect(parsePersona("DEVIL")).toBe("DEVIL");
    });
  });

  describe("입력 검증", () => {
    it.each([
      { label: "소문자 devil", value: "devil" },
      { label: "모르는 값", value: "ANGEL" },
      { label: "배열", value: ["DEVIL"] },
      { label: "없음", value: undefined },
      { label: "객체 기본 속성 constructor", value: "constructor" },
    ])("'$label'이면 null을 돌려준다", ({ value }) => {
      expect(parsePersona(value)).toBeNull();
    });
  });
});
