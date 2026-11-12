// @vitest-environment node
// 기준: Swagger 4.1 지원서 작성(201 · 400 VALIDATION_FAILED coverLetterItems) · 4.5 지원서 삭제(204 · 404 APPLICATION_NOT_FOUND)
// · 사용자 결정(2026-10-29: 저장 뒤 들어온 곳으로, 삭제 실패면 모달 안 서버 문구 · 성공이면 목록으로)
import { describe, expect, it, vi } from "vitest";

import { refresh } from "next/cache";
import { redirect, RedirectType } from "next/navigation";

import { RETRY_LATER } from "@/lib/api/problem-detail";
import type { ApplicationResponse } from "@/types/api";
import { axiosNoResponse, axiosProblem } from "@/test/axios-problem";
import { RedirectError } from "@/test/next-navigation";
import { redirectTo } from "@/test/redirect";

import { createApplication, deleteApplication } from "./actions";

// 경계 mock: HTTP(api)와 Next 런타임(redirect · unstable_rethrow · refresh)
const api = vi.hoisted(() => ({ post: vi.fn(), delete: vi.fn() }));
vi.mock("@/lib/api/client", () => ({ api }));
vi.mock("next/navigation", () => import("@/test/next-navigation"));
vi.mock("next/cache", () => import("@/test/next-cache"));

// 예시 데이터: Swagger 4.1 201 · 400 COVER_LETTER_UNUSABLE · 4.5 404 예시
const VALUES = {
  companyName: "○○전자",
  jobTitle: "백엔드 개발자",
  coverLetterItems: [
    {
      question: "지원 동기",
      answer: "저는 대용량 트래픽을 안정적으로 처리하는 서버를 만들고 싶어요.",
    },
  ],
};
const CREATED: ApplicationResponse = {
  id: 13,
  companyName: "○○전자",
  jobTitle: "백엔드 개발자",
  coverLetterItems: [
    {
      itemOrder: 1,
      question: "지원 동기",
      answer: "저는 대용량 트래픽을 안정적으로 처리하는 서버를 만들고 싶어요.",
    },
  ],
  createdAt: "2026-10-29T10:00:00+09:00",
};
const COVER_LETTER_UNUSABLE_REASON =
  "면접 질문을 만들기 어려운 자기소개서예요. 지원 동기나 경험을 조금 더 구체적으로 적어 주세요.";
const COVER_LETTER_UNUSABLE = {
  title: "Bad Request",
  status: 400,
  detail: "입력값을 확인해 주세요.",
  instance: "/api/v1/applications",
  code: "VALIDATION_FAILED",
  errors: [{ field: "coverLetterItems", reason: COVER_LETTER_UNUSABLE_REASON }],
};
const APPLICATION_NOT_FOUND = {
  title: "Not Found",
  status: 404,
  detail: "지원서를 찾을 수 없어요.",
  instance: "/api/v1/applications/0",
  code: "APPLICATION_NOT_FOUND",
};

/** refresh가 redirect보다 먼저 불렸는지(redirect가 던지면 뒤 코드는 돌지 않는다) */
const refreshedBeforeRedirect = () =>
  vi.mocked(refresh).mock.invocationCallOrder[0] < vi.mocked(redirect).mock.invocationCallOrder[0];

describe("createApplication · 지원서 작성", () => {
  describe("정상 처리", () => {
    it("지원 관리에서 열었으면 새 지원서 상세로 기록을 바꿔치기해 간다", async () => {
      api.post.mockResolvedValue({ data: CREATED });

      await expect(createApplication(VALUES, "applications")).rejects.toThrow(
        redirectTo("/applications/13"),
      );
      expect(vi.mocked(redirect).mock.calls[0][1]).toBe(RedirectType.replace);
    });

    it("연습 S03에서 열었으면 막 저장한 표시와 함께 새 지원서를 골라 둔 S03로 간다", async () => {
      api.post.mockResolvedValue({ data: CREATED });

      await expect(createApplication(VALUES, "practice")).rejects.toThrow(
        redirectTo("/practice?applicationId=13&added=1"),
      );
    });

    it("저장에 성공하면 이동하기 전에 화면을 다시 그린다", async () => {
      api.post.mockResolvedValue({ data: CREATED });

      await expect(createApplication(VALUES, "applications")).rejects.toThrow(RedirectError);
      expect(refresh).toHaveBeenCalledTimes(1);
      expect(refreshedBeforeRedirect()).toBe(true);
    });
  });

  describe("입력 검증", () => {
    it("입력이 규칙에 맞지 않으면 보내지 않고 입력 확인 안내를 돌려준다", async () => {
      expect(await createApplication({ ...VALUES, jobTitle: "   " }, "applications")).toEqual({
        formError: "입력값을 확인해 주세요.",
      });
      expect(api.post).not.toHaveBeenCalled();
      expect(refresh).not.toHaveBeenCalled();
    });
  });

  describe("오류 처리", () => {
    it("서버가 자기소개서를 거절하면(400 coverLetterItems) 그 칸 오류로 돌려주고 화면을 다시 그리지 않는다", async () => {
      api.post.mockRejectedValue(axiosProblem(COVER_LETTER_UNUSABLE));

      expect(await createApplication(VALUES, "applications")).toEqual({
        fieldErrors: { coverLetterItems: COVER_LETTER_UNUSABLE_REASON },
      });
      expect(refresh).not.toHaveBeenCalled();
    });
  });

  describe("권한 · 로그인", () => {
    it("토큰 재발급 · 로그아웃으로 이동해야 하면 그 이동을 그대로 던지고 화면을 다시 그리지 않는다", async () => {
      const moveToRefresh = new RedirectError("/api/auth/refresh");
      api.post.mockRejectedValue(moveToRefresh);

      await expect(createApplication(VALUES, "applications")).rejects.toBe(moveToRefresh);
      expect(refresh).not.toHaveBeenCalled();
    });
  });
});

describe("deleteApplication · 지원서 삭제", () => {
  describe("정상 처리", () => {
    it("지우면 화면을 다시 그린 뒤 지원 관리 목록으로 기록을 바꿔치기해 간다", async () => {
      api.delete.mockResolvedValue({ status: 204 });

      await expect(deleteApplication(12)).rejects.toThrow(redirectTo("/applications"));
      expect(vi.mocked(redirect).mock.calls[0][1]).toBe(RedirectType.replace);
      expect(refresh).toHaveBeenCalledTimes(1);
      expect(refreshedBeforeRedirect()).toBe(true);
    });
  });

  describe("입력 검증", () => {
    it.each([
      { label: "0", id: 0 },
      { label: "음수", id: -1 },
      { label: "소수", id: 1.5 },
      { label: "NaN", id: Number.NaN },
      { label: "안전한 정수 범위 밖", id: Number.MAX_SAFE_INTEGER + 1 },
    ])("지원서 id가 '$label'이면 요청하지 않고 지원 관리 목록으로 간다", async ({ id }) => {
      await expect(deleteApplication(id)).rejects.toThrow(redirectTo("/applications"));
      expect(api.delete).not.toHaveBeenCalled();
    });
  });

  describe("경계값", () => {
    it("지원서 id가 가장 작은 유효값 1이면 요청한다", async () => {
      api.delete.mockResolvedValue({ status: 204 });

      await expect(deleteApplication(1)).rejects.toThrow(redirectTo("/applications"));
      expect(api.delete).toHaveBeenCalledTimes(1);
    });
  });

  describe("오류 처리", () => {
    it("이미 없는 지원서(404 APPLICATION_NOT_FOUND)면 지운 것처럼 목록으로 간다", async () => {
      api.delete.mockRejectedValue(axiosProblem(APPLICATION_NOT_FOUND));

      await expect(deleteApplication(12)).rejects.toThrow(redirectTo("/applications"));
      expect(refresh).toHaveBeenCalledTimes(1);
    });

    it("서버가 문구와 함께 실패하면 이동하지 않고 그 문구를 돌려준다", async () => {
      api.delete.mockRejectedValue(
        axiosProblem({
          title: "Internal Server Error",
          status: 500,
          detail: "서버에 문제가 생겼어요.",
          instance: "/api/v1/applications/12",
          code: "INTERNAL_ERROR",
        }),
      );

      expect(await deleteApplication(12)).toEqual({ error: "서버에 문제가 생겼어요." });
      expect(refresh).not.toHaveBeenCalled();
      expect(redirect).not.toHaveBeenCalled();
    });

    it("서버 문구 없이 실패하면 다시 시도 안내를 돌려준다", async () => {
      api.delete.mockRejectedValue(axiosNoResponse());

      expect(await deleteApplication(12)).toEqual({ error: RETRY_LATER });
    });
  });

  describe("권한 · 로그인", () => {
    it("토큰 재발급 · 로그아웃으로 이동해야 하면 그 이동을 그대로 던진다", async () => {
      const moveToRefresh = new RedirectError("/api/auth/refresh");
      api.delete.mockRejectedValue(moveToRefresh);

      await expect(deleteApplication(12)).rejects.toBe(moveToRefresh);
      expect(refresh).not.toHaveBeenCalled();
    });
  });
});
