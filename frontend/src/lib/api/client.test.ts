// @vitest-environment node
import axios, { type AxiosResponse, type InternalAxiosRequestConfig } from "axios";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { api as ApiInstance } from "./client";
import { getProblemDetail } from "./types";

const cookieJar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (cookieJar.has(name) ? { name, value: cookieJar.get(name) } : undefined),
  }),
}));

const adapter = vi.fn(async (config: InternalAxiosRequestConfig): Promise<AxiosResponse> => ({
  data: {},
  status: 200,
  statusText: "",
  headers: {},
  config,
}));

let api: typeof ApiInstance;

beforeAll(async () => {
  // client.ts가 만드는 인스턴스가 이 adapter를 물려받도록 먼저 지정한 뒤 불러온다.
  axios.defaults.adapter = adapter;
  ({ api } = await import("./client"));
});

beforeEach(() => {
  adapter.mockClear();
  cookieJar.clear();
});

describe("api", () => {
  it("쿠키의 액세스 토큰을 Bearer로 붙인다", async () => {
    cookieJar.set("hk_access", "access-1");

    await api.get("/users/me");

    expect(adapter.mock.calls[0][0].headers.Authorization).toBe("Bearer access-1");
  });

  it("토큰 쿠키가 없으면 Authorization을 붙이지 않는다", async () => {
    await api.get("/auth/email-availability");

    expect(adapter.mock.calls[0][0].headers.Authorization).toBeUndefined();
  });
});

describe("getProblemDetail", () => {
  it("axios 오류가 아니면 null", () => {
    expect(getProblemDetail(new Error("x"))).toBeNull();
  });
});
