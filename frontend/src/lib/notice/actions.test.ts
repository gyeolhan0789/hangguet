// @vitest-environment node
// 기준: Swagger 8.9 공지 확인(204 · 404 NOTICE_NOT_FOUND) · 기획 메모 C02 · C03
import { describe, expect, it, vi } from "vitest";

import { refresh } from "next/cache";

import { RETRY_LATER } from "@/lib/api/problem-detail";
import { axiosNoResponse, axiosProblem, axiosStatusOnly } from "@/test/axios-problem";
import { RedirectError } from "@/test/next-navigation";

import { readNotice } from "./actions";

// 경계 mock: HTTP(api)와 Next 런타임(refresh · unstable_rethrow)
const api = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock("@/lib/api/client", () => ({ api }));
vi.mock("next/navigation", () => import("@/test/next-navigation"));
vi.mock("next/cache", () => import("@/test/next-cache"));

// 예시 데이터: Swagger 8.9 404 예시
const NOTICE_NOT_FOUND = {
  title: "Not Found",
  status: 404,
  detail: "공지를 찾을 수 없어요.",
  instance: "/api/v1/notices/0/read",
  code: "NOTICE_NOT_FOUND",
};

describe("readNotice · 공지 확인", () => {
  describe("정상 처리", () => {
    it("확인에 성공하면 ok를 돌려주고 목록 · 종 점이 바뀌도록 화면을 다시 그린다", async () => {
      api.post.mockResolvedValue({ status: 204 });

      expect(await readNotice(3)).toEqual({ ok: true });
      expect(refresh).toHaveBeenCalledTimes(1);
    });
  });

  describe("입력 검증", () => {
    it.each([
      { label: "0", id: 0 },
      { label: "음수", id: -1 },
      { label: "소수", id: 1.5 },
      { label: "NaN", id: Number.NaN },
      { label: "안전한 정수 범위 밖", id: Number.MAX_SAFE_INTEGER + 1 },
    ])("공지 id가 '$label'이면 요청하지 않고 다시 시도 안내를 돌려준다", async ({ id }) => {
      expect(await readNotice(id)).toEqual({ error: RETRY_LATER });
      expect(api.post).not.toHaveBeenCalled();
    });
  });

  describe("경계값", () => {
    it("공지 id가 가장 작은 유효값 1이면 요청한다", async () => {
      api.post.mockResolvedValue({ status: 204 });

      expect(await readNotice(1)).toEqual({ ok: true });
      expect(api.post).toHaveBeenCalledTimes(1);
    });
  });

  describe("오류 처리", () => {
    it("서버가 문구와 함께 실패하면(404) 그 문구를 돌려주고 화면을 다시 그리지 않는다", async () => {
      api.post.mockRejectedValue(axiosProblem(NOTICE_NOT_FOUND));

      expect(await readNotice(3)).toEqual({ error: "공지를 찾을 수 없어요." });
      expect(refresh).not.toHaveBeenCalled();
    });

    it.each([
      { label: "문구 없는 502", error: axiosStatusOnly(502) },
      { label: "응답 없음", error: axiosNoResponse() },
    ])("서버 문구가 없는 실패('$label')면 다시 시도 안내를 돌려준다", async ({ error }) => {
      api.post.mockRejectedValue(error);

      expect(await readNotice(3)).toEqual({ error: RETRY_LATER });
    });
  });

  describe("권한 · 로그인", () => {
    it("토큰 재발급 · 로그아웃으로 이동해야 하면 그 이동을 그대로 던진다", async () => {
      const moveToRefresh = new RedirectError("/api/auth/refresh");
      api.post.mockRejectedValue(moveToRefresh);

      await expect(readNotice(3)).rejects.toBe(moveToRefresh);
      expect(refresh).not.toHaveBeenCalled();
    });
  });
});
