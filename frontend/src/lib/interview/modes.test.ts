// 기준: Swagger 5.1 SessionCreateRequest.mode(VIDEO · CHAT) · BE Swagger 10.1 GroupCreateRequest.mode
import { describe, expect, it } from "vitest";

import { parseMode } from "./modes";

describe("parseMode · 주소의 면접 방식", () => {
  describe("정상 처리", () => {
    it.each(["VIDEO", "CHAT"] as const)("'%s'는 그대로 읽는다", (mode) => {
      expect(parseMode(mode)).toBe(mode);
    });
  });

  describe("입력 검증", () => {
    it.each([
      { label: "없는 값", value: "PHONE" },
      { label: "소문자", value: "video" },
      { label: "없음", value: undefined },
      { label: "여러 개", value: ["VIDEO", "CHAT"] },
      { label: "Object 속성 이름", value: "toString" },
    ])("$label이면 null이다", ({ value }) => {
      expect(parseMode(value)).toBeNull();
    });
  });
});
