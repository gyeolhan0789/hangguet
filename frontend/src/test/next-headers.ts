import { vi } from "vitest";

/**
 * `next/headers` 대역. 사용: `vi.mock("next/headers", () => import("@/test/next-headers"))`
 * 쿠키는 테스트마다 비운다(setup.ts). 처음 쿠키는 `setCookie`로 넣고, 결과는 `cookieValue`로 읽는다.
 */
const jar = new Map<string, string>();

export function setCookie(name: string, value: string) {
  jar.set(name, value);
}
export function cookieValue(name: string) {
  return jar.get(name);
}
export function resetCookies() {
  jar.clear();
}

export const cookieStore = {
  get: vi.fn((name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined)),
  has: vi.fn((name: string) => jar.has(name)),
  set: vi.fn((name: string, value: string) => {
    jar.set(name, value);
  }),
  delete: vi.fn((name: string) => {
    jar.delete(name);
  }),
};
export const cookies = vi.fn(async () => cookieStore);
export const headers = vi.fn(async () => new Headers());
