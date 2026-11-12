// @vitest-environment node
// 기준: Next 문서 redirect(307) · 운영 standalone 컨테이너의 request.url(https://0.0.0.0:3000) 대응
import { describe, expect, it } from "vitest";

import { redirectToPath } from "./redirect-to-path";

describe("redirectToPath · 사이트 안 경로로 보내기", () => {
  describe("정상 처리", () => {
    it("Location에 경로만 넣어 307로 보낸다", () => {
      const response = redirectToPath("/records?date=2026-11-12");

      expect(response.status).toBe(307);
      expect(response.headers.get("location")).toBe("/records?date=2026-11-12");
    });
  });

  describe("입력 검증", () => {
    it.each([
      { label: "/로 시작 안 함", path: "home" },
      { label: "//evil.com", path: "//evil.com" },
      { label: String.raw`/\evil.com`, path: String.raw`/\evil.com` },
    ])("경로가 '$label'이면 보내지 않고 오류를 던진다", ({ path }) => {
      expect(() => redirectToPath(path)).toThrow();
    });
  });
});
