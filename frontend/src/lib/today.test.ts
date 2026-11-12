// @vitest-environment node
// 기준: Swagger 날짜 문자열(한국 시간 YYYY-MM-DD) · E2E 빌드의 서버 '오늘' 헤더(x-e2e-today)
import { beforeEach, describe, expect, it, vi } from "vitest";

import { headers } from "next/headers";

import { serverToday } from "./today";

// 경계 mock: 요청 헤더(next/headers) · 빌드 종류(E2E_BUILD) · 지금 시각
vi.mock("next/headers", () => import("@/test/next-headers"));

function todayHeader(value?: string) {
  vi.mocked(headers).mockResolvedValue(new Headers(value ? { "x-e2e-today": value } : {}));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-12T03:00:00Z"));
});

describe("serverToday · 서버의 오늘", () => {
  describe("정상 처리", () => {
    it("일반 빌드면 헤더가 있어도 한국 시간 오늘을 돌려준다", async () => {
      vi.stubEnv("E2E_BUILD", "");
      todayHeader("2026-10-21");

      expect(await serverToday()).toBe("2026-11-12");
    });

    it("E2E 빌드에서 오늘 헤더가 오면 그 날짜를 돌려준다", async () => {
      vi.stubEnv("E2E_BUILD", "1");
      todayHeader("2026-10-21");

      expect(await serverToday()).toBe("2026-10-21");
    });
  });

  describe("입력 검증", () => {
    it.each([
      { label: "없음", value: undefined },
      { label: "형식 다름", value: "2026/10/21" },
    ])("E2E 빌드에서 헤더가 '$label'이면 한국 시간 오늘을 돌려준다", async ({ value }) => {
      vi.stubEnv("E2E_BUILD", "1");
      todayHeader(value);

      expect(await serverToday()).toBe("2026-11-12");
    });
  });
});
