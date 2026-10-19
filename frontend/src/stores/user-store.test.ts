import { beforeEach, describe, expect, it } from "vitest";

import type { UserResponse } from "@/lib/api/types";

import { useUserStore } from "./user-store";

const user: UserResponse = {
  id: 1,
  email: "example@ssafy.com",
  nickname: "면접왕",
  profileImageUrl: null,
  createdAt: "2026-09-01T10:00:00+09:00",
  currentStreak: 7,
};

beforeEach(() => {
  useUserStore.getState().clearUser();
});

describe("useUserStore", () => {
  it("setUser로 회원을 채우고 clearUser로 비운다", () => {
    useUserStore.getState().setUser(user);
    expect(useUserStore.getState().user).toEqual(user);

    useUserStore.getState().clearUser();
    expect(useUserStore.getState().user).toBeNull();
  });

  it("updateUser는 바뀐 값만 덮어쓴다", () => {
    useUserStore.getState().setUser(user);

    useUserStore.getState().updateUser({ nickname: "새닉네임" });

    expect(useUserStore.getState().user).toEqual({ ...user, nickname: "새닉네임" });
  });

  it("로그인 전에는 updateUser가 아무것도 하지 않는다", () => {
    useUserStore.getState().updateUser({ nickname: "새닉네임" });

    expect(useUserStore.getState().user).toBeNull();
  });
});
