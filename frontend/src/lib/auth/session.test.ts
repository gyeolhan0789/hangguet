// @vitest-environment node
import { AxiosError, type AxiosResponse, type InternalAxiosRequestConfig } from "axios";
import { beforeEach, describe, expect, it, vi } from "vitest";

const get = vi.fn();
vi.mock("@/lib/api/client", () => ({ api: { get } }));

const has = vi.fn();
vi.mock("next/headers", () => ({ cookies: async () => ({ has }) }));

// react의 cache는 서버 컴포넌트 요청 범위에서만 값을 기억해서, 테스트에서는 매번 새로 부른다.
const { getMe } = await import("./session");

const user = {
  id: 1,
  email: "a@ssafy.com",
  nickname: "면접왕",
  profileImageUrl: null,
  createdAt: "2026-09-01T10:00:00+09:00",
  currentStreak: 7,
};

function unauthorized() {
  const config = { headers: {} } as InternalAxiosRequestConfig;
  const data = { status: 401, code: "UNAUTHORIZED", detail: "" };
  const response = { status: 401, data, headers: {}, config } as AxiosResponse;
  return new AxiosError("fail", undefined, config, null, response);
}

beforeEach(() => vi.clearAllMocks());

describe("getMe", () => {
  it("토큰 쿠키가 없으면 API를 부르지 않고 null", async () => {
    has.mockReturnValue(false);

    expect(await getMe()).toBeNull();
    expect(get).not.toHaveBeenCalled();
  });

  it("로그인했으면 내 정보를 돌려준다", async () => {
    has.mockReturnValue(true);
    get.mockResolvedValue({ data: user });

    expect(await getMe()).toEqual(user);
    expect(get).toHaveBeenCalledWith("/users/me");
  });

  it("토큰이 무효(401)면 null", async () => {
    has.mockReturnValue(true);
    get.mockRejectedValue(unauthorized());

    expect(await getMe()).toBeNull();
  });
});
