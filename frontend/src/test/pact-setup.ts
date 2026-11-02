import { vi } from "vitest";

import { cookieValues } from "./pact";

// 계약 테스트는 FE 함수를 그대로 부르고, Next 런타임에만 있는 쿠키 · 이동 · 다시 그리기만 바꾼다.
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (name in cookieValues ? { value: cookieValues[name] } : undefined),
    has: (name: string) => name in cookieValues,
    // 서버 액션이 남긴 쿠키(예: 실패 문구)를 단언할 수 있게 담아 둔다. maxAge 0은 지우기다.
    set: (name: string, value: string, options?: { maxAge?: number }) => {
      if (options?.maxAge === 0) delete cookieValues[name];
      else cookieValues[name] = value;
    },
    delete: (name: string) => {
      delete cookieValues[name];
    },
  }),
  headers: async () => new Headers(),
}));

class RedirectSignal extends Error {}

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new RedirectSignal(`REDIRECT ${url}`);
  },
  RedirectType: { push: "push", replace: "replace" },
  unstable_rethrow: (error: unknown) => {
    if (error instanceof RedirectSignal) throw error;
  },
}));

vi.mock("next/cache", () => ({ refresh: vi.fn() }));
