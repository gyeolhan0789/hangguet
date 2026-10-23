// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SESSION_CALENDAR, SESSION_LIST } from "@/test/session-list-examples";

const get = vi.fn();
vi.mock("@/lib/api/client", () => ({ api: { get } }));

const { getSessionCalendar, getSessionList, RECORDS_PAGE_SIZE } = await import("./queries");

// 기준: 웹 Swagger 5.13 연습 면접 목록(GET /interview-sessions?practiceDate&page&size, size 기본 5)
// · 5.15 월별 연습 면접 횟수(GET /interview-sessions/calendar?month)

beforeEach(() => {
  get.mockReset();
});

describe("getSessionList (5.13 연습 면접 목록)", () => {
  it("고른 날 · 페이지를 5개씩 묻고, 응답을 그대로 돌려준다", async () => {
    get.mockResolvedValue({ data: SESSION_LIST.DAILY });

    expect(await getSessionList("2026-10-21", 1)).toBe(SESSION_LIST.DAILY);
    expect(RECORDS_PAGE_SIZE).toBe(5);
    expect(get).toHaveBeenCalledWith("/interview-sessions", {
      params: { practiceDate: "2026-10-21", page: 1, size: 5 },
    });
  });

  it("실패는 그대로 던져 오류 화면에 맡긴다", async () => {
    const error = new Error("network");
    get.mockRejectedValue(error);

    await expect(getSessionList("2026-10-21", 0)).rejects.toBe(error);
  });
});

describe("getSessionCalendar (5.15 월별 연습 면접 횟수)", () => {
  it("그 달(month)을 묻고 응답을 그대로 돌려준다", async () => {
    get.mockResolvedValue({ data: SESSION_CALENDAR });

    expect(await getSessionCalendar("2026-10")).toBe(SESSION_CALENDAR);
    expect(get).toHaveBeenCalledWith("/interview-sessions/calendar", {
      params: { month: "2026-10" },
    });
  });
});
