// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PracticeLogsResponse, StatsResponse } from "@/types/api";

const get = vi.fn();
vi.mock("@/lib/api/client", () => ({ api: { get } }));

const { getPracticeLogs, getStats } = await import("./queries");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getStats (3.2 통계)", () => {
  it("통계를 돌려준다", async () => {
    // Swagger 3.2 200 예시
    const stats = {
      currentStreak: 7,
      bestStreak: 12,
      totalInterviewCount: 23,
      totalPracticeMinutes: 400,
      latestJobTitle: "백엔드 개발자",
    } satisfies StatsResponse;
    get.mockResolvedValue({ data: stats });

    expect(await getStats()).toEqual(stats);
    expect(get).toHaveBeenCalledWith("/users/me/stats");
  });
});

describe("getPracticeLogs (3.3 연습 달력)", () => {
  it("month(YYYY-MM)를 쿼리로 보낸다", async () => {
    // 웹 Swagger 3.3 200 예시 '한국 시간 시작일 기준'
    const logs = {
      content: [
        { practiceDate: "2026-10-20", createdAt: "2026-10-20T20:10:00+09:00" },
        { practiceDate: "2026-10-21", createdAt: "2026-10-21T19:42:00+09:00" },
      ],
    } satisfies PracticeLogsResponse;
    get.mockResolvedValue({ data: logs });

    expect(await getPracticeLogs("2026-10")).toEqual(logs);
    expect(get).toHaveBeenCalledWith("/practice-logs", { params: { month: "2026-10" } });
  });
});
