import { vi } from "vitest";

import { cookieValues } from "./pact";

// 계약 테스트는 FE 함수를 그대로 부르고, Next 런타임에만 있는 쿠키 · 이동 · 다시 그리기만 바꾼다.
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (name in cookieValues ? { value: cookieValues[name] } : undefined),
    has: (name: string) => name in cookieValues,
    set: vi.fn(),
    delete: vi.fn(),
  }),
  headers: async () => new Headers(),
}));

class RedirectSignal extends Error {}

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new RedirectSignal(`REDIRECT ${url}`);
  },
  unstable_rethrow: (error: unknown) => {
    if (error instanceof RedirectSignal) throw error;
  },
}));

vi.mock("next/cache", () => ({ refresh: vi.fn() }));
