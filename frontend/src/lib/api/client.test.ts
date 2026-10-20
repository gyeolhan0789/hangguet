// @vitest-environment node
import axios, { type AxiosResponse, type InternalAxiosRequestConfig } from "axios";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { api as ApiInstance, idempotencyHeaders as IdempotencyHeadersFn } from "./client";
import { getProblemDetail } from "./problem-detail";

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
let idempotencyHeaders: typeof IdempotencyHeadersFn;

beforeAll(async () => {
  // client.ts가 만드는 인스턴스가 이 adapter를 물려받도록 먼저 지정한 뒤 불러온다.
  axios.defaults.adapter = adapter;
  ({ api, idempotencyHeaders } = await import("./client"));
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

// 기준: Swagger 5.1 · 5.4 · 5.7 · 5.8 Idempotency-Key 헤더(UUID)
describe("idempotencyHeaders", () => {
  it("넘긴 키를 Idempotency-Key 헤더로 만든다(다시 보낼 때 같은 키)", () => {
    expect(idempotencyHeaders("0f8e2a4c-7b1d-4e3a-9c5f-2d6b8a1e4f70")).toEqual({
      "Idempotency-Key": "0f8e2a4c-7b1d-4e3a-9c5f-2d6b8a1e4f70",
    });
  });

  it("키를 넘기지 않으면 매번 새 UUID를 만든다", () => {
    const first = idempotencyHeaders()["Idempotency-Key"];
    const second = idempotencyHeaders()["Idempotency-Key"];

    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(second).not.toBe(first);
  });
});

describe("getProblemDetail", () => {
  it("axios 오류가 아니면 null", () => {
    expect(getProblemDetail(new Error("x"))).toBeNull();
  });
});
