// @vitest-environment node
import axios, { AxiosError, type AxiosResponse, type InternalAxiosRequestConfig } from "axios";
import { NextRequest } from "next/server";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { proxy as ProxyFn } from "./proxy";

let refreshStatus = 200;
const adapter = vi.fn(async (config: InternalAxiosRequestConfig): Promise<AxiosResponse> => {
  const { refreshToken } = JSON.parse(config.data as string) as { refreshToken: string };
  const response: AxiosResponse = {
    data:
      refreshStatus === 200
        ? { accessToken: `access-from-${refreshToken}`, refreshToken: "refresh-2", expiresIn: 3600 }
        : { status: 401, code: "REFRESH_TOKEN_INVALID" },
    status: refreshStatus,
    statusText: "",
    headers: {},
    config,
  };
  if (refreshStatus >= 400) throw new AxiosError("실패", undefined, config, null, response);
  return response;
});

let proxy: typeof ProxyFn;

beforeAll(async () => {
  axios.defaults.adapter = adapter;
  ({ proxy } = await import("./proxy"));
});

beforeEach(() => {
  adapter.mockClear();
  refreshStatus = 200;
});

function requestWith(cookie: string, path = "/home") {
  return new NextRequest(`http://localhost:3000${path}`, { headers: { cookie } });
}

describe("proxy", () => {
  it("액세스 토큰이 있으면 재발급하지 않는다", async () => {
    await proxy(requestWith("hk_access=a; hk_refresh=r"));

    expect(adapter).not.toHaveBeenCalled();
  });

  it("액세스 토큰이 만료돼 없으면 재발급하고 응답·요청 쿠키를 모두 바꾼다", async () => {
    const response = await proxy(requestWith("hk_refresh=refresh-1"));

    expect(adapter).toHaveBeenCalledTimes(1);
    expect(response.cookies.get("hk_access")?.value).toBe("access-from-refresh-1");
    expect(response.cookies.get("hk_access")?.maxAge).toBe(3570);
    expect(response.cookies.get("hk_access")?.httpOnly).toBe(true);
    expect(response.cookies.get("hk_refresh")?.value).toBe("refresh-2");
    expect(response.headers.get("x-middleware-request-cookie")).toContain(
      "hk_access=access-from-refresh-1",
    );
  });

  it("같은 리프레시 토큰으로 동시에 들어온 요청은 재발급을 한 번만 부른다", async () => {
    await Promise.all([
      proxy(requestWith("hk_refresh=refresh-same")),
      proxy(requestWith("hk_refresh=refresh-same")),
    ]);

    expect(adapter).toHaveBeenCalledTimes(1);
  });

  it("재발급이 실패하면 토큰 쿠키를 지우고 로그인 화면으로 보낸다", async () => {
    refreshStatus = 401;

    const response = await proxy(requestWith("hk_refresh=refresh-bad"));

    expect(response.headers.get("location")).toBe("http://localhost:3000/login");
    expect(response.cookies.get("hk_access")?.value).toBe("");
    expect(response.cookies.get("hk_refresh")?.value).toBe("");
  });
});

describe("proxy 접근 제어", () => {
  it("로그인하지 않았으면 앱 화면에서 로그인 화면으로 보낸다", async () => {
    const response = await proxy(requestWith(""));

    expect(response.headers.get("location")).toBe("http://localhost:3000/login");
  });

  it.each(["/", "/login", "/signup"])("로그인하지 않아도 %s는 그대로 보여 준다", async (path) => {
    const response = await proxy(requestWith("", path));

    expect(response.headers.get("location")).toBeNull();
  });

  it.each(["/login", "/signup"])("로그인했으면 %s에서 홈으로 보낸다", async (path) => {
    const response = await proxy(requestWith("hk_access=a", path));

    expect(response.headers.get("location")).toBe("http://localhost:3000/home");
  });

  it("재발급으로 로그인 상태가 되면 로그인 화면에서 홈으로 보내며 새 쿠키도 저장한다", async () => {
    const response = await proxy(requestWith("hk_refresh=refresh-3", "/login"));

    expect(response.headers.get("location")).toBe("http://localhost:3000/home");
    expect(response.cookies.get("hk_access")?.value).toBe("access-from-refresh-3");
  });
});
