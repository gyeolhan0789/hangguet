// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import type { NoticesResponse } from "@/types/api";

const get = vi.fn();
vi.mock("@/lib/api/client", () => ({ api: { get } }));

const { getNotices } = await import("./queries");

describe("getNotices (8.8 공지 목록)", () => {
  it("게시 중인 공지 목록을 그대로 돌려준다", async () => {
    // Swagger 8.8 200 예시 '확인 안 함 1개 · 확인함 1개'
    const notices = {
      content: [
        {
          id: 3,
          title: "10월 점검 안내",
          content: "10월 30일 02:00~04:00 서비스 점검이 있어요.",
          startsAt: "2026-10-23T09:00:00+09:00",
          read: false,
        },
        {
          id: 2,
          title: "채팅 면접이 열렸어요",
          content: "이제 글로도 면접을 볼 수 있어요.",
          startsAt: "2026-10-20T09:00:00+09:00",
          read: true,
        },
      ],
    } satisfies NoticesResponse;
    get.mockResolvedValue({ data: notices });

    expect(await getNotices()).toEqual(notices);
    expect(get).toHaveBeenCalledWith("/notices");
  });
});
