// @vitest-environment node
// 기준: BE Swagger 10.1 그룹 만들기 · 10.3 그룹 참가 · 10.5 준비 · 10.6 나가기 · 10.7 시작 · 10.8 연장 · 10.9 작성 중인 답변 저장
import { describe, expect, it, vi } from "vitest";

import { refresh } from "next/cache";

import { RETRY_LATER } from "@/lib/api/problem-detail";
import { axiosNoResponse, axiosProblem } from "@/test/axios-problem";
import { RedirectError } from "@/test/next-navigation";
import { redirectTo } from "@/test/redirect";
import type { GroupResponse } from "@/types/api";

import {
  createGroup,
  extendTurn,
  joinGroup,
  leaveGroup,
  saveAnswerDraft,
  setGroupReady,
  startGroup,
} from "./actions";

// 경계 mock: HTTP(api)와 Next 런타임(redirect · unstable_rethrow · refresh)
const api = vi.hoisted(() => ({ post: vi.fn(), put: vi.fn(), delete: vi.fn() }));
vi.mock("@/lib/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/client")>()),
  api,
}));
vi.mock("next/navigation", () => import("@/test/next-navigation"));
vi.mock("next/cache", () => import("@/test/next-cache"));

// 예시 데이터: BE Swagger 10.1 201 예시(그룹 7 · 내 면접 55 · 초대 코드 K7Q2ZP)
const KEY = "0f8e2a4c-7b1d-4e3a-9c5f-2d6b8a1e4f70";
const CREATE = {
  mode: "VIDEO",
  persona: "COFFEE_CHAT",
  capacity: 3,
  jobCategory: "DEVELOPMENT",
  applicationId: 12,
} as const;
const JOIN = { inviteCode: "K7Q2ZP", applicationId: 15, jobCategory: "DATA_AI" } as const;
const GROUP = { groupId: 7, mySessionId: 55 } as GroupResponse;
const MOVE_TO_REFRESH = new RedirectError("/api/auth/refresh");

// 예시 데이터: BE Swagger 10장 오류 예시(서버 문구는 FE 고정 문구와 다르게 둔다)
function problem(status: number, code: string, detail: string) {
  return axiosProblem({ title: "Error", status, detail, instance: "/interview-groups", code });
}
const GROUP_NOT_FOUND = problem(404, "GROUP_NOT_FOUND", "그룹을 찾을 수 없어요.");
const ALREADY_IN_GROUP = problem(409, "ALREADY_IN_GROUP", "이미 다른 그룹에 있어요.");

describe("createGroup · 그룹 만들기", () => {
  describe("정상 처리", () => {
    it("그룹을 만들면 그 그룹의 대기실로 이동한다", async () => {
      api.post.mockResolvedValue({ data: GROUP });

      await expect(createGroup(CREATE, KEY)).rejects.toThrow(redirectTo("/groups/7"));
    });
  });

  describe("입력 검증", () => {
    it.each([
      { label: "정원 4명", values: { ...CREATE, capacity: 4 } },
      { label: "없는 직군", values: { ...CREATE, jobCategory: "LAW" } },
    ])("'$label'이면 요청하지 않고 확인 문구를 돌려준다", async ({ values }) => {
      expect(await createGroup(values as typeof CREATE, KEY)).toEqual({
        formError: "그룹 정보를 확인해 주세요.",
      });
      expect(api.post).not.toHaveBeenCalled();
    });
  });

  describe("오류 처리", () => {
    it("그사이 지원서가 없어졌으면(404 APPLICATION_NOT_FOUND) 지원서 선택으로 이동한다", async () => {
      api.post.mockRejectedValue(problem(404, "APPLICATION_NOT_FOUND", "지원서가 없어요."));

      await expect(createGroup(CREATE, KEY)).rejects.toThrow(redirectTo("/practice"));
    });

    it("서버가 실패로 답하면 서버 문구와 새 키가 필요하다는 표시를 돌려준다", async () => {
      api.post.mockRejectedValue(ALREADY_IN_GROUP);

      expect(await createGroup(CREATE, KEY)).toEqual({
        formError: "이미 다른 그룹에 있어요.",
        keySpent: true,
      });
    });

    it("응답을 받지 못했으면 같은 키로 다시 보내도록 새 키 표시 없이 다시 시도 문구를 돌려준다", async () => {
      api.post.mockRejectedValue(axiosNoResponse());

      expect(await createGroup(CREATE, KEY)).toEqual({ formError: RETRY_LATER });
    });
  });

  describe("권한 · 로그인", () => {
    it("이동해야 하면 그 이동을 그대로 던진다", async () => {
      api.post.mockRejectedValue(MOVE_TO_REFRESH);

      await expect(createGroup(CREATE, KEY)).rejects.toBe(MOVE_TO_REFRESH);
    });
  });
});

describe("joinGroup · 그룹 참가", () => {
  describe("정상 처리", () => {
    it("참가하면 그 그룹의 대기실로 이동한다", async () => {
      api.post.mockResolvedValue({ data: GROUP });

      await expect(joinGroup(JOIN, KEY)).rejects.toThrow(redirectTo("/groups/7"));
    });
  });

  describe("입력 검증", () => {
    it("초대 코드가 6자리가 아니면 요청하지 않고 확인 문구를 돌려준다", async () => {
      expect(await joinGroup({ ...JOIN, inviteCode: "k7q2" }, KEY)).toEqual({
        formError: "참가 정보를 확인해 주세요.",
      });
      expect(api.post).not.toHaveBeenCalled();
    });
  });

  describe("오류 처리", () => {
    it("지원서가 없어졌어도(404 APPLICATION_NOT_FOUND) 이동하지 않고 서버 문구를 돌려준다", async () => {
      api.post.mockRejectedValue(problem(404, "APPLICATION_NOT_FOUND", "지원서를 찾을 수 없어요."));

      expect(await joinGroup(JOIN, KEY)).toEqual({
        formError: "지원서를 찾을 수 없어요.",
        keySpent: true,
      });
    });

    it("정원이 찼으면(409 GROUP_FULL) 서버 문구와 새 키가 필요하다는 표시를 돌려준다", async () => {
      api.post.mockRejectedValue(problem(409, "GROUP_FULL", "자리가 다 찼어요."));

      expect(await joinGroup(JOIN, KEY)).toEqual({
        formError: "자리가 다 찼어요.",
        keySpent: true,
      });
    });
  });
});

describe("setGroupReady · 준비 · 준비 취소", () => {
  describe("정상 처리", () => {
    it("준비를 바꾸면 대기실을 다시 그린다", async () => {
      api.put.mockResolvedValue({ data: GROUP });

      expect(await setGroupReady(7, true)).toEqual({});
      expect(refresh).toHaveBeenCalledTimes(1);
    });
  });

  describe("오류 처리", () => {
    it("그룹이 없으면(404 GROUP_NOT_FOUND) 홈으로 이동한다", async () => {
      api.put.mockRejectedValue(GROUP_NOT_FOUND);

      await expect(setGroupReady(7, true)).rejects.toThrow(redirectTo("/home"));
    });

    it("준비할 수 없는 상태면(409) 대기실을 다시 그리고 서버 문구를 돌려준다", async () => {
      api.put.mockRejectedValue(problem(409, "INVALID_GROUP_STATE", "이미 시작한 그룹이에요."));

      expect(await setGroupReady(7, false)).toEqual({ formError: "이미 시작한 그룹이에요." });
      expect(refresh).toHaveBeenCalledTimes(1);
    });
  });
});

describe("leaveGroup · 그룹 나가기", () => {
  describe("정상 처리", () => {
    it("나가면 홈으로 이동한다", async () => {
      api.delete.mockResolvedValue({ status: 204 });

      await expect(leaveGroup(7)).rejects.toThrow(redirectTo("/home"));
    });
  });

  describe("오류 처리", () => {
    it("이미 없는 그룹이면(404) 나간 것으로 보고 홈으로 이동한다", async () => {
      api.delete.mockRejectedValue(GROUP_NOT_FOUND);

      await expect(leaveGroup(7)).rejects.toThrow(redirectTo("/home"));
    });

    it("진행 중이라 나갈 수 없으면(409) 대기실을 다시 그리고 서버 문구를 돌려준다", async () => {
      api.delete.mockRejectedValue(problem(409, "INVALID_GROUP_STATE", "면접 중이에요."));

      expect(await leaveGroup(7)).toEqual({ formError: "면접 중이에요." });
      expect(refresh).toHaveBeenCalledTimes(1);
    });
  });
});

describe("startGroup · 그룹 면접 시작", () => {
  describe("정상 처리", () => {
    it("시작하면 내 면접 화면으로 이동한다", async () => {
      api.post.mockResolvedValue({ data: GROUP });

      await expect(startGroup(7, KEY)).rejects.toThrow(redirectTo("/interview/55"));
    });
  });

  describe("오류 처리", () => {
    it("아직 시작할 수 없으면(409 GROUP_NOT_READY) 대기실을 다시 그리고 서버 문구와 새 키 표시를 돌려준다", async () => {
      api.post.mockRejectedValue(problem(409, "GROUP_NOT_READY", "준비하지 않은 사람이 있어요."));

      expect(await startGroup(7, KEY)).toEqual({
        formError: "준비하지 않은 사람이 있어요.",
        keySpent: true,
      });
      expect(refresh).toHaveBeenCalledTimes(1);
    });

    it("그룹이 없으면(404 GROUP_NOT_FOUND) 홈으로 이동한다", async () => {
      api.post.mockRejectedValue(GROUP_NOT_FOUND);

      await expect(startGroup(7, KEY)).rejects.toThrow(redirectTo("/home"));
    });
  });
});

describe("extendTurn · 답변 시간 연장", () => {
  describe("정상 처리", () => {
    it("연장하면 ok를 돌려준다", async () => {
      api.post.mockResolvedValue({ data: { deadlineAt: "2026-11-04T14:06:02+09:00" } });

      expect(await extendTurn(7)).toEqual({ ok: true });
    });
  });

  describe("오류 처리", () => {
    it("연장할 수 없으면(409 EXTEND_NOT_ALLOWED) ok가 false인 결과와 서버 문구를 돌려준다", async () => {
      api.post.mockRejectedValue(problem(409, "EXTEND_NOT_ALLOWED", "이미 연장했어요."));

      expect(await extendTurn(7)).toEqual({ ok: false, formError: "이미 연장했어요." });
    });
  });
});

describe("saveAnswerDraft · 작성 중인 답변 저장", () => {
  describe("경계값", () => {
    it.each([
      { label: "1,000자", length: 1000, sent: true },
      { label: "1,001자", length: 1001, sent: false },
    ])("글이 '$label'이면 저장 요청 여부가 $sent다", async ({ length, sent }) => {
      api.put.mockResolvedValue({ status: 204 });

      await saveAnswerDraft(55, 303, "가".repeat(length));

      expect(api.put.mock.calls.length > 0).toBe(sent);
    });
  });

  describe("오류 처리", () => {
    it("지금 답할 질문이 아니면(409 QUESTION_CLOSED) 던지지 않고 끝낸다", async () => {
      api.put.mockRejectedValue(problem(409, "QUESTION_CLOSED", "답할 질문이 아니에요."));

      await expect(saveAnswerDraft(55, 303, "트랜잭션은")).resolves.toBeUndefined();
    });
  });
});
