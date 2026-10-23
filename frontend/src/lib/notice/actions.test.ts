// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

import { axiosNoResponse, axiosProblem } from "@/test/axios-problem";

// HTTP 경계(api)와 Next 서버 함수(refresh · unstable_rethrow)만 바꾼다.
const api = { post: vi.fn() };
vi.mock("@/lib/api/client", () => ({ api }));

class RedirectSignal extends Error {}
vi.mock("next/navigation", () => ({
  unstable_rethrow: (error: unknown) => {
    if (error instanceof RedirectSignal) throw error;
  },
}));

const refresh = vi.fn();
vi.mock("next/cache", () => ({ refresh: () => refresh() }));

const { readNotice } = await import("./actions");

// Swagger 8.9 404 예시
const NOTICE_NOT_FOUND = {
  title: "Not Found",
  status: 404,
  detail: "공지를 찾을 수 없어요.",
  instance: "/api/v1/notices/0/read",
  code: "NOTICE_NOT_FOUND",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("readNotice (8.9 공지 확인)", () => {
  it("그 공지를 확인하고, 목록 · 종 점이 바뀌도록 다시 그린다", async () => {
    api.post.mockResolvedValue({ status: 204 });

    expect(await readNotice(3)).toEqual({ ok: true });
    expect(api.post).toHaveBeenCalledWith("/notices/3/read");
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("없는 공지(404)면 서버 문구를 돌려주고 다시 그리지 않는다", async () => {
    api.post.mockRejectedValue(axiosProblem(NOTICE_NOT_FOUND));

    expect(await readNotice(3)).toEqual({ error: "공지를 찾을 수 없어요." });
    expect(refresh).not.toHaveBeenCalled();
  });

  it("서버에 닿지 못하면 다시 시도 안내를 돌려준다", async () => {
    api.post.mockRejectedValue(axiosNoResponse());

    expect(await readNotice(3)).toEqual({ error: "잠시 후 다시 시도해 주세요." });
  });

  it("공지 id가 1 이상의 정수가 아니면 보내지 않는다", async () => {
    for (const id of [0, -1, 1.5, Number.NaN]) {
      expect(await readNotice(id)).toEqual({ error: "잠시 후 다시 시도해 주세요." });
    }
    expect(api.post).not.toHaveBeenCalled();
  });

  it("api가 재발급 · 로그아웃 화면으로 보내면(redirect) 그대로 이동한다", async () => {
    api.post.mockRejectedValue(new RedirectSignal("REDIRECT /login"));

    await expect(readNotice(3)).rejects.toBeInstanceOf(RedirectSignal);
  });
});
