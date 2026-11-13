// @vitest-environment node
// 기준: BE Swagger 10.2 초대 확인 · 10.4 그룹 조회(404 GROUP_NOT_FOUND)
import { describe, expect, it, vi } from "vitest";

import { axiosProblem } from "@/test/axios-problem";
import type { GroupResponse, InviteResponse } from "@/types/api";

import { getGroup, getInvite } from "./queries";

// 경계 mock: HTTP(api.get)
const api = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@/lib/api/client", () => ({ api }));

const NOT_FOUND = axiosProblem({ status: 404, code: "GROUP_NOT_FOUND", detail: "없는 그룹" });
const SERVER_ERROR = axiosProblem({ status: 500, code: "INTERNAL_ERROR", detail: "서버 오류" });

describe("getGroup · 그룹 조회", () => {
  describe("정상 처리", () => {
    it("그룹을 받으면 그대로 돌려준다", async () => {
      const group = { groupId: 7 } as GroupResponse;
      api.get.mockResolvedValue({ data: group });

      expect(await getGroup(7)).toBe(group);
    });
  });

  describe("오류 처리", () => {
    it("없거나 참가자가 아니면(404 GROUP_NOT_FOUND) null을 돌려준다", async () => {
      api.get.mockRejectedValue(NOT_FOUND);

      expect(await getGroup(7)).toBeNull();
    });

    it("그 밖의 실패는 그대로 던진다", async () => {
      api.get.mockRejectedValue(SERVER_ERROR);

      await expect(getGroup(7)).rejects.toBe(SERVER_ERROR);
    });
  });
});

describe("getInvite · 초대 확인", () => {
  describe("정상 처리", () => {
    it("들어갈 수 있는 코드면 초대 정보를 돌려준다", async () => {
      const invite = { groupId: 7, hostNickname: "면접왕" } as InviteResponse;
      api.get.mockResolvedValue({ data: invite });

      expect(await getInvite("K7Q2ZP")).toBe(invite);
    });
  });

  describe("입력 검증", () => {
    it.each([
      { label: "5자리", code: "K7Q2Z" },
      { label: "7자리", code: "K7Q2ZPX" },
    ])("코드가 '$label'이면 조회하지 않고 null을 돌려준다", async ({ code }) => {
      expect(await getInvite(code)).toBeNull();
      expect(api.get).not.toHaveBeenCalled();
    });
  });

  describe("오류 처리", () => {
    it("없거나 시작 · 취소된 그룹이면(404) null을 돌려준다", async () => {
      api.get.mockRejectedValue(NOT_FOUND);

      expect(await getInvite("K7Q2ZP")).toBeNull();
    });
  });
});
